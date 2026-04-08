import { getAccountData, setAccountData, isValidPublicKey } from "../utils/stellar.js"
import { fetchMetadata, uploadMetadata }                     from "../utils/pinata.js"
import { SHARED_REGISTRY, REGISTRY_DATA_PREFIX }            from "./constants.js"
import type { AgentMetadata }                                from "./types.js"

// ─── Registry ─────────────────────────────────────────────────────────────────
// Uses a hardcoded shared Stellar account as the registry.
// The secret key is embedded in the package for write operations.
// Users never configure registry credentials — it just works.
// V2: replace with a deployed Soroban contract.

function getRegistry(network: "testnet" | "mainnet" = "testnet") {
  return SHARED_REGISTRY[network]
}

export async function resolveAgent(
  nameOrAddress: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<AgentMetadata> {

  // Direct wallet address — load metadata from agent's own account data
  if (isValidPublicKey(nameOrAddress)) {
    const data = await getAccountData(nameOrAddress, network)
    const cid  = data["agent:metadata"]
    if (!cid) throw new Error(`No agent metadata found on account ${nameOrAddress}`)
    return fetchMetadata<AgentMetadata>(cid)
  }

  // Name lookup — read from shared registry
  const registry = getRegistry(network)
  const data     = await getAccountData(registry.publicKey, network)
  const key      = `${REGISTRY_DATA_PREFIX}${nameOrAddress}`
  const cid      = data[key]

  if (!cid) {
    throw new Error(
      `Agent "${nameOrAddress}" not found.\nRun: stellar-agent list`
    )
  }

  return fetchMetadata<AgentMetadata>(cid)
}

export async function registerAgent(opts: {
  name:        string
  metadata:    AgentMetadata
  agentSecret: string
  network?:    "testnet" | "mainnet"
}): Promise<{ cid: string; txHash: string }> {
  const network  = opts.network || "testnet"
  const registry = getRegistry(network)

  // 1. Upload metadata to IPFS
  const cid = await uploadMetadata(opts.metadata)

  // 2. Write CID to agent's own account (self-sovereign record)
  await setAccountData(opts.agentSecret, "agent:metadata", cid, network)

  // 3. Write name→CID to shared registry using the embedded registry key
  const txHash = await setAccountData(
    registry.secretKey,
    `${REGISTRY_DATA_PREFIX}${opts.name}`,
    cid,
    network
  )

  return { cid, txHash }
}

export async function listAgents(
  network: "testnet" | "mainnet" = "testnet"
): Promise<{ name: string; cid: string }[]> {
  const registry = getRegistry(network)
  const data     = await getAccountData(registry.publicKey, network)
  const agents: { name: string; cid: string }[] = []

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(REGISTRY_DATA_PREFIX)) {
      agents.push({ name: key.slice(REGISTRY_DATA_PREFIX.length), cid: value })
    }
  }

  return agents
}
