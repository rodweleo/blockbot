import fs from "fs";
import path from "path";
import os from "os";
import type { WalletConfig, AgentConfig } from "../core/types.js";

// ─── Paths ────────────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(os.homedir(), ".blockbot");
const WALLET_FILE = path.join(CONFIG_DIR, "wallet.json");
const GLOBAL_CONFIG = path.join(CONFIG_DIR, "config.json");

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ─── Wallet ───────────────────────────────────────────────────────────────────
export function saveWallet(wallet: WalletConfig): void {
  ensureConfigDir();
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2), {
    mode: 0o600,
  });
}

export function loadWallet(): WalletConfig | null {
  if (!fs.existsSync(WALLET_FILE)) return null;
  return JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8"));
}

export function walletExists(): boolean {
  return fs.existsSync(WALLET_FILE);
}

// ─── Global config (set by `blockbot init`) ──────────────────────────────
export interface GlobalConfig {
  network: "testnet" | "mainnet";
  groqApiKey: string;
  pinataJwt: string;
  ngrokToken: string;
  tavilyApiKey: string;
}

export function loadGlobalConfig(): GlobalConfig | null {
  if (!fs.existsSync(GLOBAL_CONFIG)) return null;
  return JSON.parse(fs.readFileSync(GLOBAL_CONFIG, "utf-8"));
}

// ─── Auto-inject global config into process.env ──────────────────────────────
// Called at the start of every command so API keys are always available
// without the user manually exporting env vars.
export function injectGlobalConfig(): void {
  const cfg = loadGlobalConfig();
  if (!cfg) return;

  if (cfg.groqApiKey && !process.env.GROQ_API_KEY)
    process.env.GROQ_API_KEY = cfg.groqApiKey;
  if (cfg.pinataJwt && !process.env.PINATA_JWT)
    process.env.PINATA_JWT = cfg.pinataJwt;
  if (cfg.ngrokToken && !process.env.NGROK_AUTHTOKEN)
    process.env.NGROK_AUTHTOKEN = cfg.ngrokToken;
  if (cfg.tavilyApiKey && !process.env.TAVILY_API_KEY)
    process.env.TAVILY_API_KEY = cfg.tavilyApiKey;
  if (cfg.network && !process.env.STELLAR_NETWORK)
    process.env.STELLAR_NETWORK = cfg.network;
}

// ─── Agent config ─────────────────────────────────────────────────────────────
export function loadAgentConfig(dir: string = process.cwd()): AgentConfig {
  const configPath = path.join(dir, "agent.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No agent.config.json found in ${dir}.\nRun: npx create-blockbot <name>`,
    );
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

export function saveAgentConfig(
  config: AgentConfig,
  dir: string = process.cwd(),
): void {
  fs.writeFileSync(
    path.join(dir, "agent.config.json"),
    JSON.stringify(config, null, 2),
  );
}

// ─── Agent .env ───────────────────────────────────────────────────────────────
// Reads agent-local .env but fills missing keys from global config automatically
export function loadAgentEnv(
  dir: string = process.cwd(),
): Record<string, string> {
  const envPath = path.join(dir, ".env");
  const env: Record<string, string> = {};

  // Parse local .env first
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (
        val &&
        val !== "your_groq_api_key_here" &&
        val !== "your_pinata_jwt_here"
      ) {
        env[key] = val;
      }
    }
  }

  // Fill missing keys from global config automatically
  const global = loadGlobalConfig();
  if (global) {
    if (!env.GROQ_API_KEY && global.groqApiKey)
      env.GROQ_API_KEY = global.groqApiKey;
    if (!env.PINATA_JWT && global.pinataJwt) env.PINATA_JWT = global.pinataJwt;
    if (!env.NGROK_AUTHTOKEN && global.ngrokToken)
      env.NGROK_AUTHTOKEN = global.ngrokToken;
    if (!env.TAVILY_API_KEY && global.tavilyApiKey)
      env.TAVILY_API_KEY = global.tavilyApiKey;
    if (!env.STELLAR_NETWORK) env.STELLAR_NETWORK = global.network;
  }

  return env;
}

export function getNetwork(): "testnet" | "mainnet" {
  if (process.env.STELLAR_NETWORK === "mainnet") return "mainnet";
  const cfg = loadGlobalConfig();
  return cfg?.network || "testnet";
}
