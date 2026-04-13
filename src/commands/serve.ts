import path from "path";
import fs from "fs";
import chalk from "chalk";
import localtunnel from "localtunnel";
import { loadAgentConfig, loadAgentEnv, getNetwork } from "../utils/config.js";
import { uploadMetadata } from "../utils/pinata.js";
import { createAgentServer } from "../server/index.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_PORT, PLATFORM_FEE_PERCENT } from "../core/constants.js";
import { loadVectorStoreFromDisk } from "./index.js";
import type { AgentMetadata } from "../core/types.js";
import { agentRegistry } from "../core/registry.js";

// ─── serve command ────────────────────────────────────────────────────────────

export async function serveCommand(options: {
  port?: string;
  tunnel?: boolean;
  network?: string;
}): Promise<void> {
  logger.banner();

  const port = parseInt(options.port || String(DEFAULT_PORT));
  const network = (options.network || getNetwork()) as "testnet" | "mainnet";
  const dir = process.cwd();

  // Load config + env
  let config: any;
  let env: Record<string, string>;

  try {
    config = loadAgentConfig(dir);
    env = loadAgentEnv(dir);
  } catch (e: any) {
    console.error(chalk.red(`  ✗ ${e.message}`));
    process.exit(1);
  }

  const agentType = config.type || "agent";
  const secretKey = env.STELLAR_SECRET_KEY || process.env.STELLAR_SECRET_KEY;
  const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
  const pinataJwt = env.PINATA_JWT || process.env.PINATA_JWT;

  if (!secretKey) {
    console.error(chalk.red("  ✗ STELLAR_SECRET_KEY not found in .env"));
    process.exit(1);
  }
  if (!groqKey && agentType === "agent") {
    console.error(chalk.red("  ✗ GROQ_API_KEY not found in .env"));
    process.exit(1);
  }

  // Set env vars for tools
  process.env.GROQ_API_KEY = groqKey;
  process.env.STELLAR_NETWORK = network;
  if (pinataJwt) process.env.PINATA_JWT = pinataJwt;
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;

  // ── Data type: load LangChain vector store from indexed embeddings ──────
  let vectorStore: any; // MemoryVectorStore

  if (agentType === "data") {
    const geminiApiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      console.error(chalk.red("  ✗ GEMINI_API_KEY not found in .env"));
      console.error(
        chalk.gray("    Required for data-type agents to embed queries"),
      );
      process.exit(1);
    }

    vectorStore = await loadVectorStoreFromDisk(dir, geminiApiKey);
    if (!vectorStore) {
      console.error(chalk.red("  ✗ No embedding store found"));
      console.error(chalk.gray("    Run: blockbot index <data-path>"));
      process.exit(1);
    }
  }

  // ── Step 1: Start Express server ─────────────────────────────────────────────
  async function bindServer(
    app: any,
    startPort: number,
  ): Promise<{ server: any; port: number }> {
    const MAX_RETRIES = 10;

    for (let i = 0; i < MAX_RETRIES; i++) {
      const tryPort = startPort + i;
      try {
        const server = await new Promise<any>((resolve, reject) => {
          const s = app.listen(tryPort, () => {
            logger.success(`Gateway listening on http://localhost:${tryPort}`);
            logger.success(
              `x402 payment gating active — price: ${config.price} ${config.asset}`,
            );
            if (PLATFORM_FEE_PERCENT > 0) {
              logger.success(`Platform fee: ${PLATFORM_FEE_PERCENT}% per call`);
            }
            resolve(s);
          });

          s.on("error", reject);
        });
        return { server, port: tryPort };
      } catch (err: any) {
        if (err.code === "EADDRINUSE") {
          logger.warn(`Port ${tryPort} in use, trying ${tryPort + 1}...`);
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Could not find an available port after ${MAX_RETRIES} attempts`,
    );
  }

  console.log(chalk.cyan(`  [1/5] Starting agent server...`));

  const { Keypair } = await import("@stellar/stellar-sdk");
  const keypair = Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  config.owner = publicKey;

  const app = createAgentServer({
    config,
    secretKey,
    network,
    vectorStore,
  });

  const { port: actualPort } = await bindServer(app, port);

  // await new Promise<void>((resolve, reject) => {
  //   const server = app.listen(port, () => {
  //     logger.success(`Gateway listening on http://localhost:${actualPort}`);
  //     logger.success(
  //       `x402 payment gating active — price: ${config.price} ${config.asset}`,
  //     );
  //     if (PLATFORM_FEE_PERCENT > 0) {
  //       logger.success(`Platform fee: ${PLATFORM_FEE_PERCENT}% per call`);
  //     }
  //     resolve();
  //   });
  //   server.on("error", (err: NodeJS.ErrnoException) => {
  //     reject(err);
  //   });
  // });

  // ── Step 2: Open ngrok tunnel ─────────────────────────────────────────────────
  let publicUrl = `http://localhost:${actualPort}`;

  if (options.tunnel !== false) {
    console.log(chalk.cyan(`  [2/5] Opening tunnel (localtunnel)...`));
    try {
      const tunnel = await localtunnel({ port: actualPort });
      publicUrl = tunnel.url;
      logger.success("Tunnel established", publicUrl);
      logger.info("Note: localtunnel may show a visitor page on first visit");

      tunnel.on("error", (err: any) => {
        logger.warn("Tunnel error", err.message);
      });

      // Re-register cleanup
      process.on("SIGINT", async () => {
        tunnel.close();
      });
    } catch (e: any) {
      logger.warn("Tunnel failed — using localhost", e.message);
      logger.info(
        "For a stable public URL, set NGROK_AUTHTOKEN and install ngrok manually",
      );
      publicUrl = `http://localhost:${actualPort}`;
    }
  } else {
    console.log(chalk.gray(`  [2/5] Skipping tunnel (--no-tunnel)`));
  }

  config.endpoint = `${publicUrl}/agent`;

  // Persist last serve runtime so `blockbot start` can resume quickly
  try {
    const stateDir = path.join(dir, ".blockbot");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "runtime.json"),
      JSON.stringify(
        {
          name: config.name,
          type: agentType,
          network,
          tunnel: options.tunnel !== false,
          port: String(actualPort),
          endpoint: config.endpoint,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (e: any) {
    logger.warn("Could not persist runtime state", e.message);
  }

  // ── Step 3: Build metadata ────────────────────────────────────────────────────
  console.log(chalk.cyan(`  [3/5] Building agent metadata...`));

  const metadata: AgentMetadata = {
    ...config,
    owner: publicKey,
    endpoint: config.endpoint,
    registered_at: new Date().toISOString(),
    ipfs_cid: "",
  };

  logger.arrow(`name:     ${metadata.name}`);
  logger.arrow(`endpoint: ${metadata.endpoint}`);
  logger.arrow(`price:    ${metadata.price} ${metadata.asset}`);
  logger.arrow(`model:    ${metadata.model}`);

  // ── Step 4: Upload to Pinata ──────────────────────────────────────────────────
  console.log(chalk.cyan(`  [4/5] Uploading metadata to Pinata...`));

  let cid = "local";
  if (pinataJwt) {
    try {
      cid = await uploadMetadata(metadata);
      metadata.ipfs_cid = cid;
      logger.success("IPFS CID", cid);
    } catch (e: any) {
      logger.warn("Pinata upload failed — running without IPFS", e.message);
    }
  } else {
    logger.warn("PINATA_JWT not set — skipping IPFS upload");
    logger.info("Agent discoverable by wallet address only");
  }

  // ── Step 5: Register on Stellar ──────────────────────────────────────────────
  console.log(chalk.cyan(`  [5/5] Registering on Stellar (${network})...`));

  try {
    const { txHash } = await agentRegistry.registerAgent({
      name: config.name,
      metadata,
      agentSecret: secretKey,
      network,
    });
    logger.success(
      "Registered on Stellar",
      txHash !== "self-registered"
        ? `tx: ${txHash.slice(0, 20)}...`
        : "by wallet address",
    );
  } catch (e: any) {
    logger.warn("Stellar registration failed", e.message);
    logger.info("Agent still reachable via endpoint directly");
  }

  // ── Live ──────────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log(chalk.green.bold(`  Agent "${config.name}" is LIVE 🚀`));
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log(chalk.gray("  Endpoint:  ") + chalk.white(config.endpoint));
  console.log(
    chalk.gray("  Price:     ") +
      chalk.magenta(`${config.price} ${config.asset} per call`),
  );
  console.log(chalk.gray("  Network:   ") + chalk.white(network));
  console.log(
    chalk.gray("  Wallet:    ") + chalk.white(publicKey.slice(0, 20) + "..."),
  );
  console.log(chalk.gray("  Type:      ") + chalk.white(agentType));
  if (agentType !== "proxy") {
    console.log(chalk.gray("  Model:     ") + chalk.white(config.model));
  }
  if (cid !== "local") {
    console.log(chalk.gray("  IPFS CID:  ") + chalk.white(cid));
  }
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log();
  console.log(chalk.gray("  Waiting for requests... (Ctrl+C to stop)\n"));

  // Keep alive — handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n  Shutting down..."));
    process.exit(0);
  });

  // Block forever
  await new Promise(() => {});
}
