import * as StellarSdk from "@stellar/stellar-sdk"
import { Horizon } from "@stellar/stellar-sdk"
import { STELLAR_TESTNET_HORIZON, STELLAR_MAINNET_HORIZON, type WalletConfig } from "../core/types.js"

// ─── Stellar Utilities ─────────────────────────────────────────────────────────

export function getHorizonUrl(network: "testnet" | "mainnet" = "testnet"): string {
  return network === "testnet" ? STELLAR_TESTNET_HORIZON : STELLAR_MAINNET_HORIZON
}

export function getServer(network: "testnet" | "mainnet" = "testnet"): Horizon.Server {
  return new Horizon.Server(getHorizonUrl(network))
}

export function generateKeypair(): { publicKey: string; secretKey: string } {
  const keypair = StellarSdk.Keypair.random()
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  }
}

export async function fundTestnetAccount(publicKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
    )
    return response.ok
  } catch {
    return false
  }
}

export async function getAccountBalances(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<{ asset: string; balance: string }[]> {
  const server = getServer(network)
  const account = await server.loadAccount(publicKey)
  return account.balances.map((b: any) => ({
    asset: b.asset_type === "native" ? "XLM" : b.asset_code,
    balance: b.balance,
  }))
}

export async function setAccountData(
  secretKey: string,
  key: string,
  value: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<string> {
  const server    = getServer(network)
  const keypair   = StellarSdk.Keypair.fromSecret(secretKey)
  const account   = await server.loadAccount(keypair.publicKey())

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
        name:  key.slice(0, 64),
        value: Buffer.from(value.slice(0, 64)),
      })
    )
    .setTimeout(30)
    .build()

  tx.sign(keypair)
  const result = await server.submitTransaction(tx)
  return (result as any).hash
}

export async function getAccountData(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<Record<string, string>> {
  const server  = getServer(network)
  const account = await server.loadAccount(publicKey)
  const data: Record<string, string> = {}

  for (const [key, value] of Object.entries(account.data_attr || {})) {
    data[key] = Buffer.from(value as string, "base64").toString("utf-8")
  }

  return data
}

export async function sendPayment(opts: {
  secretKey: string
  to: string
  amount: string
  asset: "XLM" | "USDC"
  network?: "testnet" | "mainnet"
  memo?: string
}): Promise<string> {
  const network  = opts.network || "testnet"
  const server   = getServer(network)
  const keypair  = StellarSdk.Keypair.fromSecret(opts.secretKey)
  const account  = await server.loadAccount(keypair.publicKey())

  let stellarAsset: StellarSdk.Asset
  if (opts.asset === "XLM") {
    stellarAsset = StellarSdk.Asset.native()
  } else {
    // USDC on Stellar testnet
    const usdcIssuer =
      network === "testnet"
        ? "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
        : "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    stellarAsset = new StellarSdk.Asset("USDC", usdcIssuer)
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
      asset:       stellarAsset,
      amount:      opts.amount,
    })
  )

  if (opts.memo) {
    txBuilder.addMemo(StellarSdk.Memo.text(opts.memo.slice(0, 28)))
  }

  const tx = txBuilder.setTimeout(30).build()
  tx.sign(keypair)

  const result = await server.submitTransaction(tx)
  return (result as any).hash
}

export async function accountExists(
  publicKey: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<boolean> {
  try {
    const server = getServer(network)
    await server.loadAccount(publicKey)
    return true
  } catch {
    return false
  }
}

export function isValidPublicKey(key: string): boolean {
  try {
    StellarSdk.Keypair.fromPublicKey(key)
    return true
  } catch {
    return false
  }
}
