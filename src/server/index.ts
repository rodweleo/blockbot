import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient, RoutesConfig } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { runAgent } from "../core/agentRunner.js";
import {
  generatex402FacilitatorApiKey,
  sendPayment,
} from "../utils/stellar.js";
import {
  PLATFORM_FEE_PERCENT,
  PLATFORM_FEE_WALLET,
} from "../core/constants.js";
import axios from "axios";
import type { AgentConfig } from "../core/types.js";

/** Minimal interface for any LangChain-compatible vector store */
interface VectorStoreSearchable {
  similaritySearch(
    query: string,
    k?: number,
  ): Promise<Array<{ pageContent: string; metadata: Record<string, any> }>>;
}

// ─── Simple in-memory rate limiter ────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.BLOCKBOT_RATE_LIMIT || "30", 10);

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res
      .status(429)
      .json({ error: "Too many requests. Please try again later." });
    return;
  }

  next();
}

// ─── Platform fee transfer (fire-and-forget, non-blocking) ───────────────────
async function transferPlatformFee(opts: {
  agentSecretKey: string;
  amount: string;
  asset: "XLM" | "USDC";
  network: "testnet" | "mainnet";
}): Promise<string | null> {
  const feePercent = PLATFORM_FEE_PERCENT;
  const platformWallet = PLATFORM_FEE_WALLET[opts.network];

  if (!platformWallet || feePercent <= 0) return null;

  const feeAmount = ((parseFloat(opts.amount) * feePercent) / 100).toFixed(7);
  if (parseFloat(feeAmount) <= 0) return null;

  try {
    const txHash = await sendPayment({
      secretKey: opts.agentSecretKey,
      to: platformWallet,
      amount: feeAmount,
      asset: opts.asset,
      network: opts.network,
      memo: "blockbot-fee",
    });
    console.log(
      `  Platform fee: ${feeAmount} ${opts.asset} → ${platformWallet.slice(0, 12)}... (tx: ${txHash.slice(0, 16)}...)`,
    );
    return txHash;
  } catch (e: any) {
    console.error(`  Platform fee transfer failed: ${e.message}`);
    return null;
  }
}

// ─── Proxy handler ────────────────────────────────────────────────────────────

async function handleProxyRequest(
  reqBody: any,
  config: AgentConfig,
): Promise<{ data: any; status: number }> {
  const { method, path: reqPath, body, headers } = reqBody;

  if (!config.proxy?.targetUrl) {
    const err: any = new Error("Proxy target URL not configured");
    err.statusCode = 500;
    throw err;
  }

  const targetUrl = config.proxy.targetUrl + (reqPath || "");
  const allowedMethods = config.proxy.allowedMethods || [
    "GET",
    "POST",
    "PUT",
    "DELETE",
  ];
  const httpMethod = (method || "GET").toUpperCase();

  if (!allowedMethods.includes(httpMethod)) {
    const err: any = new Error(
      `Method ${httpMethod} not allowed. Allowed: ${allowedMethods.join(", ")}`,
    );
    err.statusCode = 400;
    throw err;
  }

  console.log(`Proxying ${httpMethod} → ${targetUrl}`);

  const response = await axios({
    method: httpMethod.toLowerCase() as any,
    url: targetUrl,
    data: body,
    headers: { ...(config.proxy.headers || {}), ...(headers || {}) },
    timeout: 30_000,
    validateStatus: () => true,
  });

  console.log(`  ✓ Proxy response: ${response.status}`);
  return { data: response.data, status: response.status };
}

// ─── Data / RAG handler (LangChain vector store) ────────────────────────────

async function handleDataRequest(
  reqBody: any,
  vectorStore: VectorStoreSearchable,
): Promise<{ answer?: string; results?: any[]; sources?: any[] }> {
  const { query } = reqBody;

  if (!query || typeof query !== "string") {
    const err: any = new Error(
      "Missing or invalid 'query' in request body (must be a non-empty string)",
    );
    err.statusCode = 400;
    throw err;
  }

  if (query.length > 10_000) {
    const err: any = new Error("Query too long (max 10,000 characters)");
    err.statusCode = 400;
    throw err;
  }

  console.log(`  Query: "${query.slice(0, 100)}"`);

  // LangChain handles embedding the query + cosine search internally
  const results = await vectorStore.similaritySearch(query, 5);

  console.log(`  Found ${results.length} relevant chunks`);

  // If GROQ_API_KEY is available, synthesize a natural-language answer
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const context = results
      .map((r) => `[${r.metadata?.source || "unknown"}]\n${r.pageContent}`)
      .join("\n\n---\n\n");
    const { ChatGroq } = await import("@langchain/groq");
    const llm = new ChatGroq({
      apiKey: groqKey,
      model: "llama-3.3-70b-versatile",
    });
    const response = await llm.invoke([
      {
        role: "system",
        content:
          "Answer the user's question based ONLY on the provided context. " +
          "If the context doesn't contain the answer, say so. Be concise and cite sources.",
      },
      { role: "user", content: `Context:\n${context}\n\nQuestion: ${query}` },
    ]);

    console.log(`  ✓ Answer synthesized with LLM`);
    return {
      answer: response.content as string,
      sources: results.map((r) => ({
        source: r.metadata?.source || "unknown",
        snippet: r.pageContent.slice(0, 200),
      })),
    };
  }

  // No LLM available — return raw relevant chunks
  return {
    results: results.map((r) => ({
      text: r.pageContent,
      source: r.metadata?.source || "unknown",
    })),
  };
}

// ─── Agent HTTP Server (x402-Compliant) ───────────────────────────────────────

export async function createAgentServer(opts: {
  config: AgentConfig;
  secretKey: string;
  network: "testnet" | "mainnet";
  vectorStore?: VectorStoreSearchable;
}): Promise<express.Application> {
  const { config, secretKey, network, vectorStore } = opts;
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(rateLimiter);

  // ─── x402 Configuration ───────────────────────────────────────────────────────
  // Set up x402 middleware for payment enforcement
  const stellarNetwork =
    network === "testnet" ? "stellar:testnet" : "stellar:public";
  const facilitatorUrl =
    network === "mainnet"
      ? "https://channels.openzeppelin.com/x402" // mainnet
      : "https://channels.openzeppelin.com/x402/testnet";

  const facilitatorApiKey = await generatex402FacilitatorApiKey(network);

  // Configure x402 middleware for the /agent endpoint
  const x402config: RoutesConfig = {
    ["POST /agent"]: {
      accepts: {
        scheme: "exact",
        price: `$${config.price} ${config.asset}`, // x402 format: $amount
        network: stellarNetwork,
        payTo: config.owner!,
      },
    },
  };

  // Apply x402 middleware
  app.use(
    paymentMiddlewareFromConfig(
      x402config,
      new HTTPFacilitatorClient({
        url: facilitatorUrl,
        createAuthHeaders: async () => {
          const headers = {
            Authorization: `Bearer ${facilitatorApiKey}`,
          };
          return {
            verify: headers,
            settle: headers,
            supported: headers,
          };
        },
      }),
      [
        {
          network: stellarNetwork,
          server: new ExactStellarScheme(),
        },
      ],
    ),
  );

  // ── Health check (no payment required) ──────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      agent: config.name,
      version: config.version,
      model: config.model,
      x402: true,
      platformFeePercent: PLATFORM_FEE_PERCENT,
    });
  });

  // ── Agent metadata (no payment required) ────────────────────────────────────
  app.get("/agent", (_req: Request, res: Response) => {
    res.json({
      name: config.name,
      description: config.description,
      price: config.price,
      asset: config.asset,
      model: config.model,
      tools: config.tools,
      version: config.version,
      network: network,
      owner: config.owner,
      platformFeePercent: PLATFORM_FEE_PERCENT,
    });
  });

  // ── Main endpoint (payment protected by x402 middleware) ────────────────────
  app.post("/agent", async (req: Request, res: Response) => {
    const agentType = config.type || "agent";

    // Extract payment info from headers set by x402 middleware
    const paymentFrom = req.headers["x-payment-from"] as string;
    const paymentTxHash = req.headers["x-payment-txhash"] as string;

    console.log(
      `\n  [${new Date().toISOString()}] ${agentType.toUpperCase()} request from ${paymentFrom?.slice(0, 20) || "unknown"}`,
    );
    console.log(
      `  Payment verified: ${paymentTxHash?.slice(0, 20) || "N/A"}...`,
    );

    try {
      // ── Platform fee split (runs for all agent types) ────────────────────────
      const feePromise = transferPlatformFee({
        agentSecretKey: secretKey,
        amount: config.price,
        asset: config.asset,
        network,
      });

      let responseData: Record<string, any>;

      if (agentType === "proxy") {
        // ── Proxy mode: forward request to target URL ─────────────────────────
        responseData = await handleProxyRequest(req.body, config);
      } else if (agentType === "data") {
        // ── Data mode: RAG query via LangChain vector store ────────────────
        if (!vectorStore) {
          res.status(500).json({
            error:
              "Data agent not properly configured. Run 'blockbot index' first.",
          });
          return;
        }
        responseData = await handleDataRequest(req.body, vectorStore);
      } else {
        // ── Agent mode: run LangChain AI agent (original behavior) ────────────
        const { task } = req.body;

        if (!task || typeof task !== "string") {
          res.status(400).json({
            error:
              "Missing or invalid 'task' in request body (must be a non-empty string)",
          });
          return;
        }

        if (task.length > 10_000) {
          res
            .status(400)
            .json({ error: "Task too long (max 10,000 characters)" });
          return;
        }

        console.log(`  Task: "${task.slice(0, 100)}"`);

        const steps: string[] = [];
        const result = await runAgent({
          config,
          secretKey,
          task,
          network,
          onStep: (step) => {
            console.log(`    → ${step}`);
            steps.push(step);
          },
        });

        responseData = {
          result: result.answer,
          toolCalls: result.toolCalls,
          steps,
        };
      }

      // Await the fee transfer (don't block the response if it fails)
      const feeTxHash = await feePromise.catch(() => null);

      console.log(`  ✓ Request complete\n`);

      res.json({
        success: true,
        agent: config.name,
        type: agentType,
        ...responseData,
        payment: {
          txHash: paymentTxHash,
          from: paymentFrom,
          amount: config.price,
          asset: config.asset,
          platformFee: {
            percent: PLATFORM_FEE_PERCENT,
            txHash: feeTxHash,
          },
        },
      });
    } catch (e: any) {
      const statusCode = (e as any).statusCode || 500;
      console.error(`  ✗ Request failed: ${e.message}`);
      res.status(statusCode).json({ error: e.message });
    }
  });

  // ── Global error handler ────────────────────────────────────────────────────
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // Handle JSON parse errors (malformed request bodies)
    if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
      console.error(`  Bad request: ${err.message}`);
      res.status(400).json({ error: "Malformed JSON in request body" });
      return;
    }
    console.error(`  Unhandled error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
