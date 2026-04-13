#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import path from "path";
import fs from "fs";
import chalk from "chalk";
import { generateKeypair, fundTestnetAccount } from "./utils/stellar.js";
import { uploadMetadata } from "./utils/pinata.js";
import { agentRegistry } from "./core/registry.js";
import { logger } from "./utils/logger.js";
import { injectGlobalConfig, loadGlobalConfig } from "./utils/config.js";
import { validateAgentName, validatePrice } from "./core/constants.js";

injectGlobalConfig();
import type { AgentMetadata } from "./core/types.js";

const program = new Command();

program
  .name("create-blockbot")
  .description("Scaffold a new AI agent on the Stellar blockchain")
  .argument("<name>", "Agent name (e.g. my-researcher)")
  .option("-m, --model <model>", "Groq model to use", "llama-3.3-70b-versatile")
  .option("-p, --price <price>", "Price per call in USDC", "0.10")
  .option("-a, --asset <asset>", "Payment asset XLM|USDC", "XLM")
  .option(
    "-d, --desc <description>",
    "Agent description",
    "A helpful AI agent on Stellar",
  )
  .option("-t, --tools <tools>", "Comma-separated tools", "web_search,read_url")
  .option("--type <type>", "Agent type: agent, proxy, or data", "agent")
  .option("--target-url <url>", "Target URL for proxy type agents")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .option("--no-register", "Skip Stellar registration")
  .action(async (name, opts) => {
    await createAgent(name, opts);
  });

program.parse();

// ─── createAgent ──────────────────────────────────────────────────────────────

async function createAgent(name: string, opts: any) {
  logger.banner();

  // ── Validate inputs ────────────────────────────────────────────────────────
  const nameError = validateAgentName(name);
  if (nameError) {
    console.error(chalk.red(`  ✗ Invalid agent name: ${nameError}`));
    process.exit(1);
  }

  const priceError = validatePrice(opts.price);
  if (priceError) {
    console.error(chalk.red(`  ✗ Invalid price: ${priceError}`));
    process.exit(1);
  }

  const network = opts.network as "testnet" | "mainnet";
  const tools = opts.tools
    .split(",")
    .map((t: string) => t.trim())
    .filter(Boolean);
  const agentDir = path.resolve(process.cwd(), name);

  console.log(chalk.cyan(`  Creating agent "${name}"...\n`));

  // ── Step 1: Create directory ───────────────────────────────────────────────
  console.log(chalk.cyan("  [1/6] Creating project directory..."));
  if (fs.existsSync(agentDir)) {
    console.error(chalk.red(`  ✗ Directory "${name}" already exists`));
    process.exit(1);
  }
  fs.mkdirSync(agentDir, { recursive: true });
  logger.success(`Created ./${name}/`);

  // ── Step 2: Generate keypair ───────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [2/6] Generating Stellar keypair for agent..."));
  const { publicKey, secretKey } = generateKeypair();
  logger.success("Keypair generated");
  logger.arrow(`Public key: ${publicKey}`);
  logger.arrow(`Secret key: stored in .env (never displayed again)`);

  // ── Step 3: Fund on testnet ────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [3/6] Funding agent account on testnet..."));
  if (network === "testnet") {
    const funded = await fundTestnetAccount(publicKey);
    if (funded) {
      logger.success("Agent account funded with 10,000 XLM via Friendbot");
    } else {
      logger.warn("Friendbot funding failed — fund manually before serving");
    }
  } else {
    logger.info("Fund the agent account with XLM before serving on mainnet");
  }

  // ── Step 4: Write project files ────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [4/6] Writing project files..."));

  const config = {
    name,
    version: "1",
    description: opts.desc,
    model: opts.model,
    price: opts.price,
    asset: opts.asset as "XLM" | "USDC",
    tools,
    system_prompt:
      `You are ${name}, an AI agent deployed on the Stellar blockchain. ` +
      `You have tools to search the web, check balances, send payments, and call other agents. ` +
      `Be concise, accurate, and always explain what tools you used.`,
    max_tool_iterations: 10,
    owner: publicKey,
    type: (opts.type || "agent") as "agent" | "proxy" | "data",
  };

  // Apply type-specific configuration
  if (config.type === "proxy") {
    if (!opts.targetUrl) {
      console.error(
        chalk.red("  ✗ --target-url is required for proxy type agents"),
      );
      process.exit(1);
    }
    config.tools = [];
    config.model = "none";
    config.system_prompt = "";
    (config as any).proxy = {
      targetUrl: opts.targetUrl,
      allowedMethods: ["GET", "POST", "PUT", "DELETE"],
    };
  } else if (config.type === "data") {
    config.tools = [];
    config.system_prompt = "";
  }

  // agent.config.json
  fs.writeFileSync(
    path.join(agentDir, "agent.config.json"),
    JSON.stringify(config, null, 2),
  );
  logger.success("agent.config.json");

  // .env
  // API keys auto-loaded from ~/.blockbot/config.json (set by blockbot init)
  // Only agent-specific Stellar keys live here.
  const envContent = [
    `# Agent wallet — NEVER commit this file`,
    `STELLAR_SECRET_KEY=${secretKey}`,
    `STELLAR_PUBLIC_KEY=${publicKey}`,
    `STELLAR_NETWORK=${network}`,
    ``,
    `# API keys are auto-loaded from ~/.blockbot/config.json`,
    `# Override here only if you need agent-specific keys:`,
    `# GROQ_API_KEY=`,
    `# PINATA_JWT=`,
    `# NGROK_AUTHTOKEN=`,
    `# TAVILY_API_KEY=`,
    `# GEMINI_API_KEY=`,
  ].join("\n");

  fs.writeFileSync(path.join(agentDir, ".env"), envContent, { mode: 0o600 });
  logger.success(".env (with generated keys)");

  // .gitignore
  fs.writeFileSync(
    path.join(agentDir, ".gitignore"),
    [".env", "node_modules/", "dist/", ".blockbot/", "*.log"].join("\n"),
  );
  logger.success(".gitignore");

  // package.json for the agent project
  const agentPackageJson = {
    name,
    version: "0.1.0",
    description: opts.desc,
    type: "module",
    scripts: {
      serve: "blockbot serve",
      start: "blockbot start",
      chat: "blockbot chat",
      "serve:local": "blockbot serve --no-tunnel",
    },
    dependencies: {
      blockbot: "^0.1.0",
      dotenv: "^16.4.7",
    },
  };
  fs.writeFileSync(
    path.join(agentDir, "package.json"),
    JSON.stringify(agentPackageJson, null, 2),
  );
  logger.success("package.json");

  // README.md
  const readme = buildReadme(name, publicKey, config, network);
  fs.writeFileSync(path.join(agentDir, "README.md"), readme);
  logger.success("README.md");

  // ── Step 5: Upload to IPFS ─────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [5/6] Uploading initial metadata to IPFS..."));

  const pinataJwt = process.env.PINATA_JWT;
  let cid = "pending";

  if (pinataJwt) {
    try {
      const metadata: AgentMetadata = {
        ...config,
        endpoint: "pending — run blockbot serve to register",
        ipfs_cid: "",
        registered_at: new Date().toISOString(),
      };
      cid = await uploadMetadata(metadata);
      logger.success("Uploaded to IPFS", `CID: ${cid}`);
    } catch (e: any) {
      logger.warn("IPFS upload failed", e.message);
      logger.info("Will upload when you run blockbot serve");
    }
  } else {
    logger.warn("PINATA_JWT not set — skipping IPFS upload");
    logger.info("Add PINATA_JWT to .env and run blockbot serve");
  }

  // ── Step 6: Register on Stellar ────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [6/6] Registering on Stellar..."));

  if (opts.register === false) {
    logger.info("Skipping registration (--no-register)");
  } else if (cid === "pending") {
    logger.warn("Skipping Stellar registration — no IPFS CID yet");
    logger.info("Will register automatically when you run blockbot serve");
  } else {
    try {
      const metadata: AgentMetadata = {
        ...config,
        endpoint: "pending",
        ipfs_cid: cid,
        registered_at: new Date().toISOString(),
      };
      await agentRegistry.registerAgent({
        name,
        metadata,
        agentSecret: secretKey,
        network,
      });
      logger.success("Registered on Stellar");
    } catch (e: any) {
      logger.warn("Registration skipped", e.message);
      logger.info("Will register when you run blockbot serve");
    }
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log(chalk.green.bold(`  Agent "${name}" created ✓`));
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log();
  console.log(chalk.white("  Next steps:"));
  console.log();
  console.log(
    `    ${chalk.cyan("1.")} ${chalk.gray("cd")} ${chalk.white(name)}`,
  );
  if (config.type === "data") {
    console.log(
      `    ${chalk.cyan("2.")} Edit ${chalk.yellow(".env")} — add GEMINI_API_KEY ${chalk.gray("(+ optionally GROQ_API_KEY for LLM answers)")}`,
    );
    console.log(`    ${chalk.cyan("3.")} ${chalk.gray("npm install")}`);
    console.log(
      `    ${chalk.cyan("4.")} ${chalk.gray("blockbot index ./data/")} ${chalk.gray("# index your files with Gemini embeddings")}`,
    );
    console.log(
      `    ${chalk.cyan("5.")} ${chalk.gray("blockbot serve")} ${chalk.gray("# starts server + tunnel + registers")}`,
    );
  } else if (config.type === "proxy") {
    console.log(
      `    ${chalk.cyan("2.")} Edit ${chalk.yellow(".env")} — add PINATA_JWT ${chalk.gray("(optional, for IPFS metadata)")}`,
    );
    console.log(`    ${chalk.cyan("3.")} ${chalk.gray("npm install")}`);
    console.log(
      `    ${chalk.cyan("4.")} ${chalk.gray("blockbot serve")} ${chalk.gray("# starts server + tunnel + registers")}`,
    );
  } else {
    console.log(
      `    ${chalk.cyan("2.")} Edit ${chalk.yellow(".env")} — add your GROQ_API_KEY and PINATA_JWT`,
    );
    console.log(`    ${chalk.cyan("3.")} ${chalk.gray("npm install")}`);
    console.log(
      `    ${chalk.cyan("4.")} ${chalk.gray("blockbot serve")} ${chalk.gray("# starts server + tunnel + registers")}`,
    );
  }
  console.log();
  console.log(chalk.gray("  Your agent wallet:"));
  console.log(chalk.gray("    Public key: ") + chalk.white(publicKey));
  console.log(
    chalk.red("    ⚠ Secret key is in .env — never share or commit it"),
  );
  console.log();
}

// ─── README template ──────────────────────────────────────────────────────────
function buildReadme(
  name: string,
  publicKey: string,
  config: any,
  network: string,
): string {
  return `# ${name}

${config.description}

## Agent Details

| Field | Value |
|-------|-------|
| Model | ${config.model} |
| Price | ${config.price} ${config.asset} per call |
| Network | ${network} |
| Wallet | \`${publicKey}\` |
| Tools | ${config.tools.join(", ")} |

## Setup

1. Edit \`.env\` and fill in your API keys:
   - \`GROQ_API_KEY\` — from [console.groq.com](https://console.groq.com)
   - \`PINATA_JWT\` — from [pinata.cloud](https://pinata.cloud)
   - \`NGROK_AUTHTOKEN\` — from [ngrok.com](https://ngrok.com)
   - \`STELLAR_REGISTRY_ADDRESS\` + \`STELLAR_REGISTRY_SECRET\` — your registry account

2. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

3. Start serving:
   \`\`\`bash
   blockbot serve
   \`\`\`

## Calling This Agent

\`\`\`bash
blockbot call "${name}" "your task here"
\`\`\`

Or by wallet address:
\`\`\`bash
blockbot call ${publicKey} "your task here"
\`\`\`

## How It Works

1. \`blockbot serve\` starts an Express server on port 3000
2. Opens an ngrok tunnel to get a public HTTPS URL
3. Uploads agent metadata to IPFS via Pinata
4. Registers the agent on Stellar (account data field pointing to IPFS CID)
5. Callers resolve your agent name → IPFS CID → endpoint → pay → call

## Tools Available

${config.tools.map((t: string) => `- \`${t}\``).join("\n")}

Plus core Stellar tools (always included):
- \`get_stellar_balance\` — check any account balance
- \`send_stellar_payment\` — send XLM or USDC
- \`resolve_agent\` — look up other agents
- \`call_agent\` — hire other agents for sub-tasks
- \`list_agents\` — discover all registered agents

## Explorer

[View on Stellar Expert](https://stellar.expert/explorer/${network}/account/${publicKey})
`;
}
