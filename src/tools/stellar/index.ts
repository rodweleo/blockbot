import { DynamicStructuredTool } from "@langchain/core/tools"
import { z }                     from "zod"
import {
  getAccountBalances,
  sendPayment,
  accountExists,
  getAccountData,
} from "../../utils/stellar.js"
import { resolveAgent, listAgents } from "../../core/registry.js"

// ─── Stellar Core Tools ────────────────────────────────────────────────────────
// These tools are injected into EVERY agent automatically.

export function buildStellarCoreTools(agentSecretKey: string, network: "testnet" | "mainnet" = "testnet") {

  const getStellarBalance = new DynamicStructuredTool({
    name:        "get_stellar_balance",
    description: "Get XLM and USDC balance of any Stellar account address",
    schema: z.object({
      address: z.string().describe("Stellar public key address"),
    }),
    func: async ({ address }) => {
      try {
        const balances = await getAccountBalances(address, network)
        return JSON.stringify(balances)
      } catch (e: any) {
        return `Error: ${e.message}`
      }
    },
  })

  const sendStellarPayment = new DynamicStructuredTool({
    name:        "send_stellar_payment",
    description: "Send XLM or USDC from this agent's wallet to another Stellar address",
    schema: z.object({
      to:     z.string().describe("Recipient Stellar public key"),
      amount: z.string().describe("Amount to send (e.g. '1.5')"),
      asset:  z.enum(["XLM", "USDC"]).describe("Asset to send"),
      memo:   z.string().optional().describe("Optional memo (max 28 chars)"),
    }),
    func: async ({ to, amount, asset, memo }) => {
      try {
        const txHash = await sendPayment({
          secretKey: agentSecretKey,
          to,
          amount,
          asset,
          network,
          memo,
        })
        return `Payment sent successfully. Transaction hash: ${txHash}`
      } catch (e: any) {
        return `Payment failed: ${e.message}`
      }
    },
  })

  const resolveAgentTool = new DynamicStructuredTool({
    name:        "resolve_agent",
    description: "Look up a registered agent by name or wallet address and get its metadata including endpoint and price",
    schema: z.object({
      nameOrAddress: z.string().describe("Agent name (e.g. 'researcher-agent') or Stellar public key"),
    }),
    func: async ({ nameOrAddress }) => {
      try {
        const meta = await resolveAgent(nameOrAddress, network)
        return JSON.stringify({
          name:        meta.name,
          description: meta.description,
          endpoint:    meta.endpoint,
          price:       meta.price,
          asset:       meta.asset,
          model:       meta.model,
          owner:       meta.owner,
        })
      } catch (e: any) {
        return `Error resolving agent: ${e.message}`
      }
    },
  })

  const listAgentsTool = new DynamicStructuredTool({
    name:        "list_agents",
    description: "List all agents registered in the Stellar registry. Use this to discover available agents you can call.",
    schema: z.object({}),
    func: async () => {
      try {
        const agents = await listAgents(network)
        if (agents.length === 0) return "No agents registered yet."
        return JSON.stringify(agents.map(a => a.name))
      } catch (e: any) {
        return `Error listing agents: ${e.message}`
      }
    },
  })

  const getAccountInfo = new DynamicStructuredTool({
    name:        "get_stellar_account_info",
    description: "Get full Stellar account info including data fields for any address",
    schema: z.object({
      address: z.string().describe("Stellar public key"),
    }),
    func: async ({ address }) => {
      try {
        const exists = await accountExists(address, network)
        if (!exists) return `Account ${address} does not exist on ${network}`
        const balances = await getAccountBalances(address, network)
        const data     = await getAccountData(address, network)
        return JSON.stringify({ address, balances, data })
      } catch (e: any) {
        return `Error: ${e.message}`
      }
    },
  })

  return [
    getStellarBalance,
    sendStellarPayment,
    resolveAgentTool,
    listAgentsTool,
    getAccountInfo,
  ]
}
