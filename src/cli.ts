#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { injectGlobalConfig } from "./utils/config.js";
import { initCommand } from "./commands/init.js";
import { serveCommand } from "./commands/serve.js";
import { callCommand } from "./commands/call.js";
import { listCommand, inspectCommand } from "./commands/list.js";
import {
  walletCreateCommand,
  walletBalanceCommand,
  walletInfoCommand,
} from "./commands/wallet.js";

// Auto-inject API keys from ~/.stellar-agent/config.json on every run
injectGlobalConfig();

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
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("--no-tunnel", "Disable tunnel (local only)")
  .option("-n, --network <network>", "testnet or mainnet", "testnet")
  .action(async (opts) => {
    await serveCommand(opts);
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
