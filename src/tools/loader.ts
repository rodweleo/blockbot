import type { AgentConfig }          from "../core/types.js"
import { buildStellarCoreTools }     from "./stellar/index.js"
import { buildWebTools }             from "./web/index.js"
import { buildCryptoTools }          from "./crypto/index.js"
import type { DynamicStructuredTool } from "@langchain/core/tools"

// ─── Tool Loader ──────────────────────────────────────────────────────────────

const OPTIONAL_TOOL_REGISTRY: Record<string, () => DynamicStructuredTool[]> = {
  web_search:       () => buildWebTools(),
  read_url:         () => buildWebTools(),
  get_crypto_price: () => buildCryptoTools(),
  get_stellar_dex:  () => buildCryptoTools(),
}

export function loadTools(
  config:      AgentConfig,
  secretKey:   string,
  network:     "testnet" | "mainnet" = "testnet"
): DynamicStructuredTool[] {

  // Always inject Stellar core tools
  const tools: DynamicStructuredTool[] = [
    ...buildStellarCoreTools(secretKey, network),
  ]

  // Load optional tools declared in config (deduplicate by tool name)
  const loaded = new Set<string>(tools.map(t => t.name))
  const builders = new Set<string>()

  for (const toolName of config.tools || []) {
    const builder = OPTIONAL_TOOL_REGISTRY[toolName]
    if (builder && !builders.has(toolName)) {
      // Mark the whole builder group as loaded to avoid duplicates
      builders.add(toolName)
      const newTools = builder()
      for (const t of newTools) {
        if (!loaded.has(t.name)) {
          tools.push(t)
          loaded.add(t.name)
        }
      }
    }
  }

  return tools
}

export function listAvailableTools(): string[] {
  return [
    "web_search",
    "read_url",
    "get_crypto_price",
    "get_stellar_dex",
  ]
}
