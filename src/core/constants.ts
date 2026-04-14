import { getBlockbotHome, getDefaultRegistryPath } from "./paths.js";

// ─── Shared Constants ─────────────────────────────────────────────────────────
// The shared registry account is pre-funded and deployed on Stellar testnet.
// Its public key is hardcoded here — users NEVER need its secret key.
// The package handles all writes internally.
// In v2 this becomes a Soroban contract address.

export const SHARED_REGISTRY = {
  testnet: {
    // Pre-funded shared registry account — deployed with the package
    // Any stellar-agent user's agent is discoverable by everyone
    publicKey: "GBDGVI23Y3UIYQJR6GK7LEONVNCHBXGVOX4ZCD5YQL5XCXDMV7SCS6QM",
    // Secret is embedded ONLY for write operations — users never see or set this
    secretKey: "SC5O7KKTSSXP4X4NL3GADZPQORHSJ4SORDKHWPSFLRMQWJI3EFZWRYXH",
    horizon: "https://horizon-testnet.stellar.org",
    network: "testnet" as const,
  },
  mainnet: {
    // Mainnet registry — must be configured before production launch
    // TODO: Deploy a funded mainnet registry account and set these keys
    publicKey: process.env.BLOCKBOT_MAINNET_REGISTRY_PUBLIC || "",
    secretKey: process.env.BLOCKBOT_MAINNET_REGISTRY_SECRET || "",
    horizon: "https://horizon.stellar.org",
    network: "mainnet" as const,
  },
};

export const SUPPORTED_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_PRICE = "0.10";
export const DEFAULT_ASSET = "XLM"; // XLM by default — works out of box with Friendbot
export const DEFAULT_PORT = 51780;
export const CONFIG_DIR_NAME = getBlockbotHome();
export const LOCAL_REGISTRY_PATH =
  process.env.BLOCKBOT_LOCAL_REGISTRY_PATH || getDefaultRegistryPath();

export const REGISTRY_DATA_PREFIX = "agent:";

// ─── Platform Fee Configuration ──────────────────────────────────────────────
// The platform takes a percentage of each agent call payment.
// Override via environment variables for flexibility.
export const PLATFORM_FEE_PERCENT = parseFloat(
  process.env.BLOCKBOT_PLATFORM_FEE_PERCENT || "10",
); // default 10%
export const PLATFORM_FEE_WALLET: Record<string, string> = {
  testnet:
    process.env.BLOCKBOT_PLATFORM_WALLET_TESTNET ||
    "GBDGVI23Y3UIYQJR6GK7LEONVNCHBXGVOX4ZCD5YQL5XCXDMV7SCS6QM",
  mainnet: process.env.BLOCKBOT_PLATFORM_WALLET_MAINNET || "",
};

// ─── Validation Helpers ──────────────────────────────────────────────────────
export const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MAX_PRICE = 10000; // safeguard against absurd prices
export const MIN_PRICE = 0.0001;

export function validateAgentName(name: string): string | null {
  if (!name) return "Agent name is required";
  if (!AGENT_NAME_REGEX.test(name))
    return "Agent name must be lowercase alphanumeric with hyphens (e.g. my-agent-1)";
  return null;
}

export function validatePrice(price: string): string | null {
  const num = parseFloat(price);
  if (isNaN(num)) return "Price must be a valid number";
  if (num < MIN_PRICE) return `Price must be at least ${MIN_PRICE}`;
  if (num > MAX_PRICE) return `Price must be at most ${MAX_PRICE}`;
  return null;
}

export const USDC_ISSUERS: Record<string, string> = {
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

export const EURC_ISSUERS: Record<string, string> = {
  testnet: "GB3Q6QDZYTHWT7E5PVS3W7FTMU3ANQGGBWRS6EZQRQRGFGXK2QOSXHFF",
  mainnet: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
};
