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
    // Mainnet registry — set when package hits v1.0
    publicKey: "",
    secretKey: "",
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
export const DEFAULT_PORT = 3000;
export const CONFIG_DIR_NAME = ".blockbot";

export const REGISTRY_DATA_PREFIX = "agent:";
