#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { injectGlobalConfig } from "./utils/config.js";
import { ensureBlockbotHome, getDefaultRegistryPath } from "./core/paths.js";
import { initCommand } from "./commands/init.js";
import { serveCommand } from "./commands/serve.js";
import { startCommand } from "./commands/start.js";
import { chatCommand } from "./commands/chat.js";
import { callCommand } from "./commands/call.js";
import { listCommand, inspectCommand } from "./commands/list.js";
import {
  walletCreateCommand,
  walletBalanceCommand,
  walletInfoCommand,
} from "./commands/wallet.js";

// Auto-inject API keys from blockbot global config on every run
injectGlobalConfig();

// Bootstrap machine-global blockbot storage and shared local registry path
ensureBlockbotHome();
if (!process.env.BLOCKBOT_LOCAL_REGISTRY_PATH) {
  process.env.BLOCKBOT_LOCAL_REGISTRY_PATH = getDefaultRegistryPath();
}

const program = new Command();

program
  .name("blockbot")
  .description("Deploy and interact with AI agents on the Stellar blockchain")
  .version("0.1.0");

// ── stellar-agent init ────────────────────────────────────────────────────────
program
  .command("init")
  .description(
    "First-time setup — creates wallet, saves API keys, ready in 2 min",
  )
  .action(async () => {
    await initCommand();
  });

// ── stellar-agent serve ───────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start agent server, open tunnel, and register on Stellar")
  // .option("-p, --port <port>", "Port to listen on", "3000")
  .option("--no-tunnel", "Disable tunnel (local only)")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (opts) => {
    await serveCommand(opts);
  });

// ── stellar-agent start ──────────────────────────────────────────────────────
program
  .command("start")
  .description("Resume serving using the last saved runtime settings")
  .option("-p, --port <port>", "Port to listen on")
  .option("--no-tunnel", "Disable tunnel (local only)")
  .option("-n, --network <network>", "testnet or mainnet")
  .action(async (opts) => {
    await startCommand(opts);
  });

// ── stellar-agent chat ───────────────────────────────────────────────────────
program
  .command("chat")
  .description("Chat with your local agent directly (no x402 payment required)")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .option("--clear", "Clear saved chat history before starting")
  .action(async (opts) => {
    await chatCommand(opts);
  });

// ── stellar-agent call ────────────────────────────────────────────────────────
program
  .command("call <nameOrAddress> <task>")
  .description("Call a registered agent — resolves name, pays, returns result")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (nameOrAddress, task, opts) => {
    await callCommand(nameOrAddress, task, opts);
  });

// ── stellar-agent list ────────────────────────────────────────────────────────
program
  .command("list")
  .description("List all agents registered in the shared Stellar registry")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (opts) => {
    await listCommand(opts);
  });

// ── blockbot index ────────────────────────────────────────────────────────────
program
  .command("index <path>")
  .description(
    "Index files for a data-type agent (embeds via LangChain + Google AI)",
  )
  .option("-d, --dir <dir>", "Agent directory (default: current directory)")
  .action(async (dataPath, opts) => {
    const { indexCommand } = await import("./commands/index.js");
    await indexCommand(dataPath, opts);
  });

// ── stellar-agent inspect ─────────────────────────────────────────────────────
program
  .command("inspect <nameOrAddress>")
  .description("Show full metadata for an agent")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (nameOrAddress, opts) => {
    await inspectCommand(nameOrAddress, opts);
  });

// ── stellar-agent wallet ──────────────────────────────────────────────────────
const wallet = program
  .command("wallet")
  .description("Manage your caller wallet");

wallet
  .command("create")
  .description("Generate a new Stellar keypair and fund on testnet")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (opts) => {
    await walletCreateCommand(opts);
  });

wallet
  .command("balance")
  .description("Show XLM and USDC balance")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (opts) => {
    await walletBalanceCommand(opts);
  });

wallet
  .command("info")
  .description("Show wallet public key")
  .action(async () => {
    await walletInfoCommand();
  });

program.parse();
