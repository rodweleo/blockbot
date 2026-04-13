import fs from "fs";
import path from "path";
import type { AgentMetadata } from "../../core/types.js";
import {
  ensureBlockbotHome,
  getDefaultRegistryPath,
  resolveRegistryPath,
} from "../../core/paths.js";
import { LOCAL_REGISTRY_PATH } from "../../core/constants.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocalAgentEntry {
  name: string;
  description?: string;
  skills: string[];
  price: string;
  asset: string;
  endpoint: string; // e.g. http://localhost:51780/agent
  owner: string; // Stellar public key
  model?: string;
  version?: string;
  type?: "agent" | "data" | "proxy";
  registeredAt: string;
  lastSeenAt: string;
}

interface RegistryStore {
  version: number;
  updatedAt: string;
  agents: Record<string, LocalAgentEntry>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGISTRY_VERSION = 1;

// ─── LocalRegistry ────────────────────────────────────────────────────────────

export class LocalRegistry {
  private readonly registryFile: string;
  private readonly registryDir: string;

  constructor() {
    ensureBlockbotHome();

    this.registryFile = resolveRegistryPath(LOCAL_REGISTRY_PATH);
    this.registryDir = path.dirname(this.registryFile);

    this.migrateLegacyRegistry();
  }

  // ── Internal: load store from disk ─────────────────────────────────────────
  private load(): RegistryStore {
    try {
      if (!fs.existsSync(this.registryFile)) {
        return this.empty();
      }
      const raw = fs.readFileSync(this.registryFile, "utf-8");
      const parsed = JSON.parse(raw) as RegistryStore;

      // Handle schema migrations if version changes later
      if (!parsed.version) {
        return this.empty();
      }

      return parsed;
    } catch {
      return this.empty();
    }
  }

  // ── Internal: save store to disk ────────────────────────────────────────────
  private save(store: RegistryStore): void {
    fs.mkdirSync(this.registryDir, { recursive: true });
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(
      this.registryFile,
      JSON.stringify(store, null, 2),
      "utf-8",
    );
  }

  // ── Internal: empty store ───────────────────────────────────────────────────
  private empty(): RegistryStore {
    return {
      version: REGISTRY_VERSION,
      updatedAt: new Date().toISOString(),
      agents: {},
    };
  }

  // ── Internal: one-time migration from old per-project registry ─────────────
  private migrateLegacyRegistry(): void {
    const legacyPath = path.resolve(
      process.cwd(),
      ".blockbot",
      "registry.json",
    );
    const defaultPath = getDefaultRegistryPath();

    if (this.registryFile !== defaultPath) return;
    if (fs.existsSync(this.registryFile)) return;
    if (!fs.existsSync(legacyPath)) return;

    fs.mkdirSync(this.registryDir, { recursive: true });
    fs.copyFileSync(legacyPath, this.registryFile);
  }

  // ── Register an agent ───────────────────────────────────────────────────────
  // Called by serveCommand after the agent server starts
  register(entry: Omit<LocalAgentEntry, "lastSeenAt">): LocalAgentEntry {
    const store = this.load();
    const now = new Date().toISOString();

    const full: LocalAgentEntry = {
      ...entry,
      lastSeenAt: now,
    };

    store.agents[entry.name] = full;
    this.save(store);

    return full;
  }

  // ── Update lastSeenAt (heartbeat) ───────────────────────────────────────────
  // Call periodically while the agent is running to mark it as alive
  heartbeat(name: string): boolean {
    const store = this.load();
    const agent = store.agents[name];
    if (!agent) return false;

    agent.lastSeenAt = new Date().toISOString();
    this.save(store);
    return true;
  }

  // ── Find by exact name ──────────────────────────────────────────────────────
  // Used by resolveAgent in registry.ts
  findByName(name: string): LocalAgentEntry | null {
    return this.load().agents[name] ?? null;
  }

  // ── Find by skill ────────────────────────────────────────────────────────────
  // Returns agents sorted cheapest first
  findBySkill(skill: string): LocalAgentEntry[] {
    const store = this.load();
    return Object.values(store.agents)
      .filter((a) => a.skills.includes(skill))
      .sort((a, b) => Number(a.price) - Number(b.price));
  }

  // ── Find by owner wallet ─────────────────────────────────────────────────────
  findByOwner(publicKey: string): LocalAgentEntry[] {
    const store = this.load();
    return Object.values(store.agents).filter((a) => a.owner === publicKey);
  }

  // ── List all registered agents ──────────────────────────────────────────────
  listAll(): LocalAgentEntry[] {
    return Object.values(this.load().agents);
  }

  // ── Unregister an agent ─────────────────────────────────────────────────────
  // Called on SIGINT / graceful shutdown in serveCommand
  unregister(name: string): boolean {
    const store = this.load();
    if (!store.agents[name]) return false;

    delete store.agents[name];
    this.save(store);
    return true;
  }

  // ── Convert LocalAgentEntry → AgentMetadata ─────────────────────────────────
  // Used by resolveAgent to return a consistent type to callAgent
  toAgentMetadata(entry: LocalAgentEntry): AgentMetadata {
    return {
      name: entry.name,
      description: entry.description ?? "",
      endpoint: entry.endpoint,
      price: entry.price,
      asset: entry.asset,
      owner: entry.owner,
      model: entry.model ?? "unknown",
      version: entry.version ?? "0.0.0",
      type: entry.type ?? "agent",
      registered_at: entry.registeredAt,
      ipfs_cid: "", // not applicable in local mode
    } as AgentMetadata;
  }

  // ── Check if an agent endpoint is reachable ─────────────────────────────────
  async isReachable(name: string): Promise<boolean> {
    const entry = this.findByName(name);
    if (!entry) return false;

    try {
      // Hit the /health endpoint — no payment required
      const healthUrl = entry.endpoint.replace("/agent", "/health");
      const res = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(3000), // 3s timeout
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Print registry summary to console ───────────────────────────────────────
  // Used by `blockbot registry list` CLI command
  print(): void {
    const agents = this.listAll();

    if (agents.length === 0) {
      console.log("\n  📋 Local registry is empty.");
      console.log("     Start an agent with: blockbot serve\n");
      return;
    }

    console.log(
      `\n  📋 Local Registry (${agents.length} agent${agents.length === 1 ? "" : "s"})`,
    );
    console.log("  " + "─".repeat(70));

    for (const a of agents) {
      const age = this.timeSince(a.lastSeenAt);
      const skills = a.skills.length ? a.skills.join(", ") : "none";

      console.log(`  🤖 ${a.name.padEnd(24)} ${a.endpoint}`);
      console.log(`     price:    $${a.price} ${a.asset}`);
      console.log(`     skills:   ${skills}`);
      console.log(`     owner:    ${a.owner.slice(0, 20)}...`);
      console.log(`     last seen: ${age}`);
      console.log();
    }

    console.log("  " + "─".repeat(70));
    console.log(`  registry: ${this.registryFile}\n`);
  }

  // ── Internal: human-readable time diff ─────────────────────────────────────
  private timeSince(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const localRegistry = new LocalRegistry();
