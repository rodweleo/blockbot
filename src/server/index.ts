import express, { type Request, type Response } from "express";
import cors from "cors";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient, RoutesConfig } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { runAgent } from "../core/agentRunner.js";
import type { AgentConfig } from "../core/types.js";

// ─── Agent HTTP Server (x402-Compliant) ───────────────────────────────────────

export function createAgentServer(opts: {
  config: AgentConfig;
  secretKey: string;
  network: "testnet" | "mainnet";
}): express.Application {
  const { config, secretKey, network } = opts;
  const app = express();

  app.use(cors());
  app.use(express.json());

  // ─── x402 Configuration ───────────────────────────────────────────────────────
  // Set up x402 middleware for payment enforcement
  const stellarNetwork =
    network === "testnet" ? "stellar:testnet" : "stellar:public";
  const facilitatorUrl = "https://www.x402.org/facilitator";

  // Configure x402 middleware for the /agent endpoint
  const x402config: RoutesConfig = {
    ["POST /agent"]: {
      accepts: {
        scheme: "exact",
        price: `$${config.price}`, // x402 format: $amount
        network: stellarNetwork,
        payTo: config.owner!,
      },
    },
  };

  // Apply x402 middleware
  app.use(
    paymentMiddlewareFromConfig(
      x402config,
      new HTTPFacilitatorClient({ url: facilitatorUrl }),
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
    });
  });

  // ── Main agent endpoint (payment protected by x402 middleware) ────────────────
  app.post("/agent", async (req: Request, res: Response) => {
    const { task } = req.body;

    if (!task) {
      res.status(400).json({ error: "Missing 'task' in request body" });
      return;
    }

    // At this point, x402 middleware has verified payment
    // Extract payment info from headers set by middleware
    const paymentFrom = req.headers["x-payment-from"] as string;
    const paymentTxHash = req.headers["x-payment-txhash"] as string;

    console.log(
      `\n  [${new Date().toISOString()}] Task received from ${paymentFrom?.slice(0, 20)}`,
    );
    console.log(`  Task: "${task.slice(0, 100)}"`);
    console.log(`  Payment verified: ${paymentTxHash?.slice(0, 20)}...`);

    try {
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

      console.log(`  ✓ Task complete\n`);

      res.json({
        success: true,
        agent: config.name,
        result: result.answer,
        toolCalls: result.toolCalls,
        steps,
        payment: {
          txHash: paymentTxHash,
          from: paymentFrom,
          amount: config.price,
          asset: config.asset,
        },
      });
    } catch (e: any) {
      console.error(`  ✗ Task failed: ${e.message}`);
      res.status(500).json({ error: `Agent execution failed: ${e.message}` });
    }
  });

  return app;
}
