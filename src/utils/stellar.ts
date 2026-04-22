import * as StellarSdk from "@stellar/stellar-sdk";
import { Contract, Horizon, Keypair, SorobanRpc } from "@stellar/stellar-sdk";
import {
  STELLAR_TESTNET_HORIZON,
  STELLAR_MAINNET_HORIZON,
  type WalletConfig,
} from "../core/types.js";
import { USDC_ISSUERS, EURC_ISSUERS } from "../core/constants.js";
import { getNetworkPassphrase } from "@x402/stellar";
import axios from "axios";

const SOROBAN_URLS: Record<string, string> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://soroban.stellar.org",
};

const ASSET_ISSUERS: Record<string, Record<string, string>> = {
  testnet: {
    USDC: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    EURC: "GB3Q6QDZYTHWT7E5PVS3W7FTMU3ANQGGBWRS6EZQRQRGFGXK2QOSXHFF",
  },
  mainnet: {
    USDC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    EURC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  },
};

export const SAC_CONTRACTS: Record<string, Record<string, string>> = {
  testnet: {
    XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    EURC: "GBEFXQHOPYSKVZJNXKQGX47LBPNKMGYJFK3GSGFQGQX4PJSTBQF6ZZA",
  },
  mainnet: {
    XLM: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    USDC: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJKVM",
    EURC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  },
};

export const XLM_SAC = {
  "stellar:testnet": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "stellar:public": "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
};

// ─── Stellar Utilities ─────────────────────────────────────────────────────────
export function getSorobanServer(
  network: "testnet" | "mainnet",
): SorobanRpc.Server {
  return new SorobanRpc.Server(SOROBAN_URLS[network]);
}

export function getHorizonUrl(
  network: "testnet" | "mainnet" = "testnet",
): string {
  return network === "testnet"
    ? STELLAR_TESTNET_HORIZON
    : STELLAR_MAINNET_HORIZON;
}

export function getServer(
  network: "testnet" | "mainnet" = "testnet",
): Horizon.Server {
  return new Horizon.Server(getHorizonUrl(network));
}

export function generateKeypair(): { publicKey: string; secretKey: string } {
  const keypair = StellarSdk.Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}

export async function fundTestnetAccount(publicKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`,
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function getAccountBalances(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<{ asset: string; balance: string }[]> {
  const server = getServer(network);
  const account = await server.loadAccount(publicKey);
  return account.balances.map((b: any) => ({
    asset: b.asset_type === "native" ? "XLM" : b.asset_code,
    balance: b.balance,
  }));
}

export async function ensureAccountFunded(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<void> {
  if (network !== "testnet") return;

  const server = getServer(network);

  try {
    await server.loadAccount(publicKey);
  } catch (e: any) {
    if (e?.response?.status === 404) {
      console.log(`[stellar] Account not found — funding via Friendbot...`);
      const res = await fetch(
        `https://friendbot.stellar.org?addr=${publicKey}`,
      );
      if (!res.ok) throw new Error("Friendbot funding failed");
      console.log(`[stellar] Account funded on testnet`);
    } else {
      throw e;
    }
  }
}

async function hasSACTrustline(
  publicKey: string,
  contractId: string,
  network: "testnet" | "mainnet",
): Promise<boolean> {
  try {
    const soroban = getSorobanServer(network);
    const account = await soroban.getAccount(publicKey);

    const contract = new Contract(contractId);
    const simTx = new StellarSdk.TransactionBuilder(account, {
      fee: "1000000",
      networkPassphrase:
        network === "mainnet"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          "balance",
          StellarSdk.nativeToScVal(StellarSdk.Address.fromString(publicKey), {
            type: "address",
          }),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await soroban.simulateTransaction(simTx);

    if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
      return true; // balance call succeeded — trustline exists
    }

    // Check if the error is specifically about missing trustline
    const errStr = JSON.stringify(simResult);
    const isTrustlineError =
      errStr.includes("Error(Contract, #13)") ||
      errStr.includes("trustline entry is missing");

    return !isTrustlineError; // if different error, assume trustline exists
  } catch {
    return false; // assume missing on any unexpected error
  }
}

export async function setAccountData(
  secretKey: string,
  key: string,
  value: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<string> {
  const server = getServer(network);
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const account = await server.loadAccount(keypair.publicKey());

  // Stellar data entry: key max 64 bytes, value max 64 bytes (base64 encoded)
  // We store the value as a Buffer
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "testnet"
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.PUBLIC,
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: key.slice(0, 64),
        value: Buffer.from(value.slice(0, 64)),
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);
  return (result as any).hash;
}

export async function getAccountData(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<Record<string, string>> {
  const server = getServer(network);
  const account = await server.loadAccount(publicKey);
  const data: Record<string, string> = {};

  for (const [key, value] of Object.entries(account.data_attr || {})) {
    data[key] = Buffer.from(value as string, "base64").toString("utf-8");
  }

  return data;
}

export async function sendPayment(opts: {
  secretKey: string;
  to: string;
  amount: string;
  asset: "XLM" | "USDC";
  network?: "testnet" | "mainnet";
  memo?: string;
}): Promise<string> {
  const network = opts.network || "testnet";
  const server = getServer(network);
  const keypair = StellarSdk.Keypair.fromSecret(opts.secretKey);
  const account = await server.loadAccount(keypair.publicKey());

  let stellarAsset: StellarSdk.Asset;
  if (opts.asset === "XLM") {
    stellarAsset = StellarSdk.Asset.native();
  } else {
    // USDC on Stellar testnet
    const usdcIssuer =
      network === "testnet"
        ? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        : "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
    stellarAsset = new StellarSdk.Asset("USDC", usdcIssuer);
  }

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "testnet"
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.PUBLIC,
  }).addOperation(
    StellarSdk.Operation.payment({
      destination: opts.to,
      asset: stellarAsset,
      amount: opts.amount,
    }),
  );

  if (opts.memo) {
    txBuilder.addMemo(StellarSdk.Memo.text(opts.memo.slice(0, 28)));
  }

  const tx = txBuilder.setTimeout(30).build();
  tx.sign(keypair);

  const result = await server.submitTransaction(tx);
  return (result as any).hash;
}

export async function accountExists(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<boolean> {
  try {
    const server = getServer(network);
    await server.loadAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

export function isValidPublicKey(key: string): boolean {
  try {
    StellarSdk.Keypair.fromPublicKey(key);
    return true;
  } catch {
    return false;
  }
}

export function isNativeAsset(asset: string): boolean {
  const a = asset.trim().toUpperCase();
  return a === "XLM" || a === "NATIVE";
}

function getAssetObject(
  assetCode: string,
  network: "testnet" | "mainnet",
): StellarSdk.Asset {
  const code = assetCode.trim().toUpperCase();

  if (code === "XLM" || code === "NATIVE") return StellarSdk.Asset.native();

  if (code === "USDC") {
    const issuer = USDC_ISSUERS[network];
    if (!issuer) throw new Error(`No USDC issuer configured for ${network}`);
    return new StellarSdk.Asset("USDC", issuer);
  }

  if (code === "EURC") {
    const issuer = EURC_ISSUERS[network];
    if (!issuer) throw new Error(`No EURC issuer configured for ${network}`);
    return new StellarSdk.Asset("EURC", issuer);
  }

  throw new Error(
    `Unknown asset "${assetCode}". ` +
      `Supported: XLM, USDC, EURC. ` +
      `For custom assets, add the issuer to getAssetObject().`,
  );
}

export async function ensureUSDCTrustline(
  secretKey: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<{ existed: boolean; txHash?: string }> {
  const { Keypair, Horizon } = await import("@stellar/stellar-sdk");

  const keypair = Keypair.fromSecret(secretKey);
  const server = new Horizon.Server(
    network === "mainnet"
      ? "https://horizon.stellar.org"
      : "https://horizon-testnet.stellar.org",
  );

  const account = await server.loadAccount(keypair.publicKey());
  const issuer =
    network === "mainnet" ? USDC_ISSUERS.mainnet : USDC_ISSUERS.testnet;
  const USDC = new StellarSdk.Asset("USDC", issuer);

  // Check if trustline already exists
  const hasTrustline = account.balances.some(
    (b: any) =>
      b.asset_type === "credit_alphanum4" &&
      b.asset_code === "USDC" &&
      b.asset_issuer === issuer,
  );

  if (hasTrustline) {
    return { existed: true };
  }

  // Create the trustline
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset: USDC,
        limit: "10000", // max USDC this account will hold
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await server.submitTransaction(tx);

  return { existed: false, txHash: result.hash };
}

// ── Stellar Asset Contract (SAC) addresses ─────────────────────────────────
// x402 uses Soroban SAC contracts even for native XLM transfers
// utils/stellar.ts

// ── Known SAC contract addresses (x402 uses these for transfers) ────────────
const SAC: Record<string, Record<string, string>> = {
  testnet: {
    XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4",
    USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    EURC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  },
  mainnet: {
    XLM: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    USDC: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJKVM",
    EURC: "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2",
  },
};

async function createClassicTrustline(
  secretKey: string,
  assetCode: string,
  network: "testnet" | "mainnet",
): Promise<string | undefined> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const horizon = getServer(network);
  const account = await horizon.loadAccount(keypair.publicKey());
  const issuer = ASSET_ISSUERS[network]?.[assetCode];

  if (!issuer) {
    throw new Error(
      `No issuer configured for ${assetCode} on ${network}. ` +
        `Supported: ${Object.keys(ASSET_ISSUERS[network]).join(", ")}`,
    );
  }

  const asset = new StellarSdk.Asset(assetCode, issuer);

  // Check if classic trustline already exists
  const exists = account.balances.some(
    (b: any) =>
      b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );

  if (exists) return undefined; // already exists, nothing to do

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.changeTrust({
        asset,
        limit: "999999999",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await horizon.submitTransaction(tx);
  return result.hash;
}

async function createXLMSACTrustline(
  secretKey: string,
  network: "testnet" | "mainnet",
): Promise<string | undefined> {
  const keypair = Keypair.fromSecret(secretKey);
  const horizon = getServer(network);
  const account = await horizon.loadAccount(keypair.publicKey());

  // XLM SAC requires account initialization via a minimal payment
  // Use a self-payment of dust amount to create the account's entry
  // This triggers the Soroban SAC contract to register the account
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: keypair.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "0.0000001",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  try {
    const result = await horizon.submitTransaction(tx);
    return result.hash;
  } catch (e: any) {
    // If submission fails, may already be initialized — not a fatal error
    console.warn(`[stellar] XLM SAC init warning: ${e.message}`);
    return undefined;
  }
}

// ── Ensure classic trustline for non-native assets ──────────────────────────
export async function ensureTrustline(
  secretKey: string,
  assetCode: string,
  network: "testnet" | "mainnet" = "testnet",
): Promise<{ existed: boolean; txHash?: string }> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();
  const code = assetCode.trim().toUpperCase();
  const contractId = SAC_CONTRACTS[network]?.[code];

  console.log(`[stellar] Checking trustline for ${code} on ${network}...`);

  // ── XLM: only needs SAC trustline (no classic trustline for native) ────────
  if (isNativeAsset(code)) {
    if (!contractId) {
      // No SAC contract configured — assume ok (older network)
      return { existed: true };
    }

    const sacExists = await hasSACTrustline(publicKey, contractId, network);
    if (sacExists) {
      console.log(`[stellar] XLM SAC trustline already exists`);
      return { existed: true };
    }

    console.log(`[stellar] Creating XLM SAC trustline...`);
    const txHash = await createXLMSACTrustline(secretKey, network);
    console.log(
      `[stellar] XLM SAC trustline created${txHash ? `: ${txHash.slice(0, 16)}...` : ""}`,
    );
    return { existed: false, txHash };
  }

  // ── USDC / EURC: needs classic trustline + SAC trustline ──────────────────
  let classicTxHash: string | undefined;
  let classicExisted = true;

  // Step 1: Classic Horizon trustline
  try {
    classicTxHash = await createClassicTrustline(secretKey, code, network);
    if (classicTxHash) {
      classicExisted = false;
      console.log(
        `[stellar] Classic ${code} trustline created: ${classicTxHash.slice(0, 16)}...`,
      );
    } else {
      console.log(`[stellar] Classic ${code} trustline already exists`);
    }
  } catch (e: any) {
    throw new Error(`Failed to create ${code} trustline: ${e.message}`);
  }

  // Step 2: SAC trustline (if contract is configured for this asset)
  if (contractId) {
    const sacExists = await hasSACTrustline(publicKey, contractId, network);
    if (!sacExists) {
      // For non-native SAC, the classic trustline creation above
      // is sufficient — the SAC reads from the classic entry.
      // A fresh simulation after classic trustline creation should pass.
      console.log(`[stellar] ${code} SAC will use classic trustline entry`);
    } else {
      console.log(`[stellar] ${code} SAC trustline already active`);
    }
  }

  return {
    existed: classicExisted,
    txHash: classicTxHash,
  };
}

// ── Ensure SAC (Soroban Asset Contract) trustline for XLM ──────────────────
// x402 uses Soroban SAC contracts for all transfers including native XLM.
// The SAC needs the account to have authorized the contract via Soroban.
async function ensureSACTrustline(
  secretKey: string,
  assetCode: string,
  network: "testnet" | "mainnet",
  account: any,
  horizonServer: Horizon.Server,
): Promise<{ existed: boolean; txHash?: string }> {
  const keypair = StellarSdk.Keypair.fromSecret(secretKey);
  const contractId = SAC[network]?.[assetCode.toUpperCase()];
  if (!contractId) return { existed: true }; // no SAC = skip

  const sorobanUrl =
    network === "mainnet"
      ? "https://soroban.stellar.org"
      : "https://soroban-testnet.stellar.org";

  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanUrl);

  // Check if the account already has a Soroban trustline entry
  // by simulating a balance call — if it throws "missing trustline", we create it
  try {
    const contract = new StellarSdk.Contract(contractId);
    const simAccount = await sorobanServer.getAccount(keypair.publicKey());

    const simTx = new StellarSdk.TransactionBuilder(simAccount, {
      fee: "1000000",
      networkPassphrase:
        network === "mainnet"
          ? StellarSdk.Networks.PUBLIC
          : StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        contract.call(
          "balance",
          StellarSdk.nativeToScVal(
            StellarSdk.Address.fromString(keypair.publicKey()),
            {
              type: "address",
            },
          ),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await sorobanServer.simulateTransaction(simTx);

    // If simulation succeeds — trustline exists
    if (StellarSdk.SorobanRpc.Api.isSimulationSuccess(simResult)) {
      return { existed: true };
    }

    // If error contains trustline missing — need to create it
    const errStr = JSON.stringify(simResult);
    if (
      !errStr.includes("trustline") &&
      !errStr.includes("Error(Contract, #13)")
    ) {
      return { existed: true }; // different error — assume ok
    }
  } catch {
    // Simulation threw — may or may not need trustline, proceed to create
  }

  // ── Create SAC trustline via classic Operation.changeTrust ─────────────
  // For wrapped XLM, we use the Asset object to add classic trustline
  // which the SAC contract reads from
  const asset = StellarSdk.Asset.native(); // native XLM SAC uses native asset

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      // For XLM SAC: we need to invoke the contract's `authorize` entry point
      // The simplest approach is to do a 0-amount transfer to self to initialize
      StellarSdk.Operation.payment({
        destination: keypair.publicKey(),
        asset,
        amount: "0.0000001", // minimum dust amount
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  try {
    const result = await horizonServer.submitTransaction(tx);
    return { existed: false, txHash: result.hash };
  } catch (e: any) {
    // If it fails here it's likely already initialized — treat as existed
    console.warn(`SAC trustline init warning: ${e.message}`);
    return { existed: true };
  }
}

export async function generatex402FacilitatorApiKey(network: string) {
  const facilitatorUrl =
    network === "mainnet"
      ? "https://channels.openzeppelin.com/gen"
      : "https://channels.openzeppelin.com/testnet/gen";

  try {
    const res = await axios.get(facilitatorUrl);
    return res.data.apiKey;
  } catch (e) {
    throw new Error("Failed to generate x402 facilitator API key", {
      cause: e,
    });
  }
}
