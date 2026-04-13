import {
  getAccountData,
  setAccountData,
  isValidPublicKey,
} from "../utils/stellar.js";
import { fetchMetadata, uploadMetadata } from "../utils/pinata.js";
import { SHARED_REGISTRY, REGISTRY_DATA_PREFIX } from "./constants.js";
import { localRegistry } from "./registry/local.registry.js";
import type { AgentMetadata } from "./types.js";

// ─── Registry ─────────────────────────────────────────────────────────────────
// Resolution order:
//   1. Local registry  (global blockbot home/registry.json) — for local dev / testing
//   2. Onchain registry (Stellar + IPFS)         — for production
//
// Registration order:
//   Local mode  → local registry only  (no Stellar / Pinata calls)
//   Onchain mode → local registry + Stellar + IPFS
//
// Controlled by: process.env.BLOCKBOT_MODE = "local" | "onchain"
// Defaults to "local" until explicitly set to "onchain".
// V2: replace onchain registry with a deployed Soroban contract.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLocalMode(): boolean {
  return (process.env.BLOCKBOT_MODE ?? "local") !== "onchain";
}

// ─── Registry Class ───────────────────────────────────────────────────────────

class AgentRegistry {
  constructor() {}

  // ── Get onchain registry account for the given network ─────────────────────
  getRegistry(network: "testnet" | "mainnet" = "testnet") {
    const registry = SHARED_REGISTRY[network];
    if (!registry.publicKey) {
      throw new Error(
        `Mainnet registry is not configured.\n` +
          `Set BLOCKBOT_MAINNET_REGISTRY_PUBLIC and BLOCKBOT_MAINNET_REGISTRY_SECRET env vars,\n` +
          `or deploy a registry account first.`,
      );
    }
    return registry;
  }

  // ── resolveAgent ────────────────────────────────────────────────────────────
  // Resolves an agent by name or Stellar public key.
  // Always checks local registry first, falls back to onchain.
  async resolveAgent(
    nameOrAddress: string,
    network: "testnet" | "mainnet" = "testnet",
  ): Promise<AgentMetadata> {
    // ── 1. Local registry check (always runs first) ─────────────────────────
    const localEntry = localRegistry.findByName(nameOrAddress);
    if (localEntry) {
      console.log(
        `  [registry] Resolved "${nameOrAddress}" from local registry`,
      );
      return localRegistry.toAgentMetadata(localEntry);
    }

    // ── 2. Local mode — stop here if no onchain lookup desired ─────────────
    if (isLocalMode()) {
      throw new Error(
        `Agent "${nameOrAddress}" not found in local registry.\n` +
          `Is the agent running? Start it with: blockbot serve\n` +
          `Or switch to onchain mode: BLOCKBOT_MODE=onchain`,
      );
    }

    // ── 3. Onchain fallback ─────────────────────────────────────────────────
    console.log(
      `  [registry] "${nameOrAddress}" not found locally — checking onchain...`,
    );
    return this.resolveAgentOnchain(nameOrAddress, network);
  }

  // ── resolveAgentOnchain ─────────────────────────────────────────────────────
  // Original onchain resolution logic — untouched.
  private async resolveAgentOnchain(
    nameOrAddress: string,
    network: "testnet" | "mainnet",
  ): Promise<AgentMetadata> {
    // Direct wallet address — load metadata from agent's own account data
    if (isValidPublicKey(nameOrAddress)) {
      const data = await getAccountData(nameOrAddress, network);
      const cid = data["agent:metadata"];
      if (!cid) {
        throw new Error(`No agent metadata found on account ${nameOrAddress}`);
      }
      return fetchMetadata<AgentMetadata>(cid);
    }

    // Name lookup — read from shared registry account
    const registry = this.getRegistry(network);
    const data = await getAccountData(registry.publicKey, network);
    const key = `${REGISTRY_DATA_PREFIX}${nameOrAddress}`;
    const cid = data[key];

    if (!cid) {
      throw new Error(
        `Agent "${nameOrAddress}" not found in local or onchain registry.\n` +
          `Run: blockbot list`,
      );
    }

    return fetchMetadata<AgentMetadata>(cid);
  }

  // ── registerAgent ───────────────────────────────────────────────────────────
  // Local mode:   writes to local registry only
  // Onchain mode: writes to local registry + Stellar account + IPFS
  async registerAgent(opts: {
    name: string;
    metadata: AgentMetadata;
    agentSecret: string;
    network?: "testnet" | "mainnet";
  }): Promise<{ cid: string; txHash: string }> {
    const network = opts.network ?? "testnet";

    // ── Always register locally ─────────────────────────────────────────────
    localRegistry.register({
      name: opts.name,
      description: opts.metadata.description,
      skills: (opts.metadata.skills as unknown as string[]) ?? [],
      price: opts.metadata.price,
      asset: opts.metadata.asset,
      endpoint: opts.metadata.endpoint,
      owner: opts.metadata.owner!,
      model: opts.metadata.model,
      version: opts.metadata.version,
      type: (opts.metadata.type as "agent" | "data" | "proxy") ?? "agent",
      registeredAt: opts.metadata.registered_at ?? new Date().toISOString(),
    });

    console.log(`  [registry] Registered "${opts.name}" in local registry`);

    // ── Stop here in local mode ─────────────────────────────────────────────
    if (isLocalMode()) {
      console.log(
        `  [registry] Local mode — skipping Stellar + IPFS registration`,
      );
      console.log(
        `  [registry] Set BLOCKBOT_MODE=onchain to enable onchain registration`,
      );
      return { cid: "local", txHash: "local" };
    }

    // ── Onchain registration ────────────────────────────────────────────────
    console.log(`  [registry] Registering onchain (${network})...`);

    // 1. Upload metadata to IPFS
    const cid = await uploadMetadata(opts.metadata);
    console.log(`  [registry] Uploaded to IPFS: ${cid}`);

    // 2. Write CID to agent's own account (self-sovereign record)
    await setAccountData(opts.agentSecret, "agent:metadata", cid, network);

    // 3. Write name→CID to shared registry using the embedded registry key
    const registry = this.getRegistry(network);
    const txHash = await setAccountData(
      registry.secretKey,
      `${REGISTRY_DATA_PREFIX}${opts.name}`,
      cid,
      network,
    );

    console.log(
      `  [registry] Onchain registration complete: ${txHash.slice(0, 20)}...`,
    );

    return { cid, txHash };
  }

  // ── listAgents ──────────────────────────────────────────────────────────────
  // Local mode:   reads from local registry
  // Onchain mode: reads from local registry + merges onchain entries
  async listAgents(
    network: "testnet" | "mainnet" = "testnet",
  ): Promise<{ name: string; cid: string; source: "local" | "onchain" }[]> {
    // Always include local agents
    const localAgents = localRegistry.listAll().map((a) => ({
      name: a.name,
      cid: "local",
      source: "local" as const,
    }));

    // Stop here in local mode
    if (isLocalMode()) {
      return localAgents;
    }

    // Merge with onchain agents in onchain mode
    try {
      const registry = this.getRegistry(network);
      const data = await getAccountData(registry.publicKey, network);

      const onchainAgents = Object.entries(data)
        .filter(([key]) => key.startsWith(REGISTRY_DATA_PREFIX))
        .map(([key, cid]) => ({
          name: key.slice(REGISTRY_DATA_PREFIX.length),
          cid,
          source: "onchain" as const,
        }));

      // Merge: local entries take precedence over onchain for same name
      const localNames = new Set(localAgents.map((a) => a.name));
      const onchainOnly = onchainAgents.filter((a) => !localNames.has(a.name));

      return [...localAgents, ...onchainOnly];
    } catch (e: any) {
      console.warn(`  [registry] Could not fetch onchain agents: ${e.message}`);
      return localAgents;
    }
  }
}

export const agentRegistry = new AgentRegistry();
