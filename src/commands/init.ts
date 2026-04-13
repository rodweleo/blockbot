import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  generateKeypair,
  fundTestnetAccount,
  getAccountBalances,
  accountExists,
} from "../utils/stellar.js";
import { saveWallet, loadWallet, ensureConfigDir } from "../utils/config.js";
import { logger } from "../utils/logger.js";

// ─── init command ─────────────────────────────────────────────────────────────
// Run once by any new user. Sets up:
//   1. Caller wallet (keypair + Friendbot funding)
//   2. ~/.stellar-agent/config.json with API keys
//   3. Verifies everything works
// No registry setup needed — it's hardcoded in the package.

export async function initCommand(): Promise<void> {
  logger.banner();

  console.log(
    chalk.white("  Welcome! Let's get you set up in under 2 minutes.\n"),
  );
  console.log(chalk.gray("  You'll need API keys from:"));
  console.log(chalk.gray("    • console.groq.com        (free)"));
  console.log(chalk.gray("    • app.pinata.cloud         (free tier)"));
  console.log(chalk.gray("    • dashboard.ngrok.com      (free tier)\n"));

  // Check if already initialised
  const existing = loadWallet();
  if (existing) {
    console.log(chalk.yellow("  ⚠ Already initialised."));
    console.log(chalk.gray(`    Wallet: ${existing.publicKey}`));
    console.log(chalk.gray(`    Network: ${existing.network}`));
    console.log();

    const { reinit } = await inquirer.prompt([
      {
        type: "confirm",
        name: "reinit",
        message: "Re-run setup and overwrite existing wallet?",
        default: false,
      },
    ]);

    if (!reinit) {
      console.log(
        chalk.gray(
          "\n  Nothing changed. Run stellar-agent wallet balance to check status.\n",
        ),
      );
      return;
    }
  }

  // ── Collect API keys interactively ────────────────────────────────────────
  console.log(chalk.cyan("\n  Enter your API keys (paste and press Enter):\n"));

  const answers = await inquirer.prompt([
    {
      type: "password",
      name: "groqKey",
      message: "GROQ_API_KEY:",
      mask: "•",
      validate: (v: string) => v.trim().length > 10 || "Key looks too short",
    },
    {
      type: "password",
      name: "pinataJwt",
      message: "PINATA_JWT:",
      mask: "•",
      validate: (v: string) => v.trim().length > 10 || "Key looks too short",
    },
    {
      type: "password",
      name: "ngrokToken",
      message: "NGROK_AUTHTOKEN (optional — press Enter to skip):",
      mask: "•",
      default: "",
    },
    {
      type: "password",
      name: "tavilyKey",
      message: "TAVILY_API_KEY (optional — better web search):",
      mask: "•",
      default: "",
    },
    {
      type: "list",
      name: "network",
      message: "Network:",
      choices: ["testnet", "mainnet"],
      default: "testnet",
    },
  ]);

  console.log();

  // ── Step 1: Generate caller wallet ────────────────────────────────────────
  console.log(chalk.cyan("  [1/4] Generating your caller wallet..."));
  const { publicKey, secretKey } = generateKeypair();
  logger.success("Keypair generated");
  logger.arrow(`Public key: ${publicKey}`);

  // ── Step 2: Fund via Friendbot ────────────────────────────────────────────
  if (answers.network === "testnet") {
    console.log();
    console.log(
      chalk.cyan("  [2/4] Funding wallet via Friendbot (testnet)..."),
    );
    const funded = await fundTestnetAccount(publicKey);
    if (funded) {
      logger.success("Funded with 10,000 XLM — ready to pay agents");
    } else {
      logger.warn("Friendbot failed — fund manually:");
      logger.info(`https://friendbot.stellar.org?addr=${publicKey}`);
    }
  } else {
    console.log(chalk.cyan("  [2/4] Skipping Friendbot (mainnet)"));
    logger.warn(`Fund this address with XLM before calling agents:`);
    logger.info(publicKey);
  }

  // ── Step 3: Save wallet + global config ──────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [3/4] Saving config..."));

  ensureConfigDir();
  saveWallet({ publicKey, secretKey, network: answers.network });
  logger.success("Wallet saved to ~/.stellar-agent/wallet.json");

  // Write global config with API keys
  const globalConfig = {
    network: answers.network,
    groqApiKey: answers.groqKey.trim(),
    pinataJwt: answers.pinataJwt.trim(),
    ngrokToken: answers.ngrokToken.trim(),
    tavilyApiKey: answers.tavilyKey.trim(),
  };

  const configPath = path.join(os.homedir(), ".stellar-agent", "config.json");
  fs.writeFileSync(configPath, JSON.stringify(globalConfig, null, 2), {
    mode: 0o600,
  });
  logger.success("API keys saved to ~/.stellar-agent/config.json");

  // ── Step 4: Verify Groq key works ────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  [4/4] Verifying Groq API key..."));
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${answers.groqKey.trim()}` },
    });
    if (res.ok) {
      const data: any = await res.json();
      const models = data.data
        ?.map((m: any) => m.id)
        .filter(
          (id: string) =>
            id.includes("llama") ||
            id.includes("mixtral") ||
            id.includes("gemma"),
        );
      logger.success("Groq key valid");
      logger.arrow(`Available models: ${models?.slice(0, 3).join(", ")}`);
    } else {
      logger.warn("Groq key check failed — double-check your key");
    }
  } catch {
    logger.warn(
      "Could not verify Groq key (network issue) — continuing anyway",
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log(chalk.green.bold("  Setup complete ✓"));
  console.log(chalk.cyan("  " + "─".repeat(54)));
  console.log();
  console.log(chalk.white("  Your wallet:  ") + chalk.cyan(publicKey));
  console.log(chalk.white("  Network:      ") + chalk.white(answers.network));
  console.log();
  console.log(chalk.white("  Next — create your first agent:\n"));
  console.log(chalk.cyan("    npx create-stellar-agent my-agent"));
  console.log(chalk.gray("    cd my-agent && stellar-agent serve"));
  console.log();
  console.log(chalk.white("  Or call an existing agent:\n"));
  console.log(chalk.cyan("    blockbot list"));
  console.log(chalk.cyan('    blockbot call <agent-name> "your task"'));
  console.log();
}
