import { ChatGroq }         from "@langchain/groq"
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { HumanMessage }     from "@langchain/core/messages"
import { loadTools }        from "../tools/loader.js"
import type { AgentConfig } from "../core/types.js"

// ─── Agent Runner ─────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  config:    AgentConfig
  secretKey: string
  task:      string
  network?:  "testnet" | "mainnet"
  onStep?:   (step: string) => void
}

export interface RunAgentResult {
  answer:    string
  toolCalls: { tool: string; input: string; output: string }[]
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { config, secretKey, task, onStep } = opts
  const network = opts.network || "testnet"

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY not set in environment")

  // Load model
  const model = new ChatGroq({
    apiKey,
    model:       config.model || "llama-3.3-70b-versatile",
    temperature: 0.1,
    maxTokens:   4096,
  })

  // Load tools for this agent
  const tools = loadTools(config, secretKey, network)
  onStep?.(`Loaded ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`)

  // Build the React agent
  const agent = createReactAgent({
    llm:   model,
    tools,
    messageModifier: config.system_prompt
      ? config.system_prompt
      : `You are ${config.name}, an AI agent deployed on the Stellar blockchain. ` +
        `You have tools available to check balances, make payments, search the web, and call other agents. ` +
        `Always be concise and helpful. When using tools, explain what you're doing.`,
  })

  const toolCalls: { tool: string; input: string; output: string }[] = []

  // Run the agent
  const result = await agent.invoke(
    { messages: [new HumanMessage(task)] },
    {
      callbacks: [
        {
          handleToolStart(tool: any, input: string) {
            onStep?.(`Using tool: ${tool.name} with input: ${input.slice(0, 100)}`)
          },
          handleToolEnd(output: string, runId: string, parentRunId: string, tags: any) {
            onStep?.(`Tool result: ${output.slice(0, 200)}`)
          },
        },
      ],
    }
  )

  // Extract final answer from messages
  const messages = result.messages || []
  let answer = ""

  for (const msg of [...messages].reverse()) {
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
        : ""
    if (content && msg.getType() === "ai") {
      answer = content
      break
    }
  }

  // Collect tool calls from message history
  for (const msg of messages) {
    if (msg.getType() === "ai") {
      const calls = (msg as any).tool_calls || []
      for (const call of calls) {
        toolCalls.push({
          tool:   call.name,
          input:  JSON.stringify(call.args || {}),
          output: "",
        })
      }
    }
    if (msg.getType() === "tool") {
      const last = toolCalls[toolCalls.length - 1]
      if (last) last.output = typeof msg.content === "string" ? msg.content : ""
    }
  }

  return { answer, toolCalls }
}
