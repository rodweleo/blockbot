import { ChatGroq } from "@langchain/groq";
import {
  ClearToolUsesEdit,
  contextEditingMiddleware,
  createAgent,
  summarizationMiddleware,
} from "langchain";
import { HumanMessage } from "@langchain/core/messages";
import { loadTools } from "../tools/loader.js";
import type { AgentConfig } from "../core/types.js";

// ─── Agent Runner ─────────────────────────────────────────────────────────────

export interface RunAgentOptions {
  config: AgentConfig;
  secretKey: string;
  task: string;
  network?: "testnet" | "mainnet";
  onStep?: (step: string) => void;
}

export interface RunAgentResult {
  answer: string;
  toolCalls: { tool: string; input: string; output: string }[];
}

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const { config, secretKey, task, onStep } = opts;
  const network = opts.network || "testnet";

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set in environment");

  // Load model
  const model = new ChatGroq({
    apiKey,
    model: config.model || "llama-3.3-70b-versatile",
    temperature: 1,
    maxTokens: 1024,
  });

  // Load tools for this agent
  const tools = loadTools(config, secretKey, network);
  onStep?.(
    `Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`,
  );

  // Build the React agent
  const agent = createAgent({
    model,
    tools,
    middleware: [
      summarizationMiddleware,
      contextEditingMiddleware({
        edits: [
          new ClearToolUsesEdit({
            trigger: {
              tokens: 30000,
            },
            keep: {
              tokens: 1000,
            },
          }),
        ],
      }),
    ],
    systemPrompt: config.system_prompt
      ? config.system_prompt
      : `You are ${config.name}, an AI agent deployed on the Stellar blockchain. ` +
        `You have tools available to check balances, make payments, search the web, and call other agents. ` +
        `Always be concise and helpful. When using tools, explain what you're doing. ` +
        `IMPORTANT RULES FOR CALLING OTHER AGENTS: ` +
        `(1) ALWAYS use the call_agent tool to invoke another agent — it handles x402 payment automatically. ` +
        `(2) NEVER manually combine resolve_agent + send_stellar_payment + HTTP fetch to call an agent. ` +
        `(3) NEVER call agent endpoints directly — they are x402-protected and will reject direct requests. ` +
        `(4) call_agent is the single correct entry point for all agent-to-agent interactions.`,
  });

  const toolCalls: { tool: string; input: string; output: string }[] = [];

  // Run the agent
  const result = await agent.invoke(
    { messages: [new HumanMessage(task)] },
    {
      callbacks: [
        {
          handleToolStart(tool: any, input: string) {
            onStep?.(
              `Using tool: ${tool.name} with input: ${input.slice(0, 100)}`,
            );
          },
          handleToolEnd(
            output: string,
            runId: string,
            parentRunId: string,
            tags: any,
          ) {
            onStep?.(`Tool result: ${output.slice(0, 200)}`);
          },
        },
      ],
    },
  );

  // Extract final answer from messages
  const messages = result.messages || [];
  let answer = "";

  for (const msg of [...messages].reverse()) {
    const content =
      typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("")
          : "";
    if (content && msg.type === "ai") {
      answer = content;
      break;
    }
  }

  // Collect tool calls from message history
  for (const msg of messages) {
    if (msg.type === "ai") {
      const calls = (msg as any).tool_calls || [];
      for (const call of calls) {
        toolCalls.push({
          tool: call.name,
          input: JSON.stringify(call.args || {}),
          output: "",
        });
      }
    }
    if (msg.type === "tool") {
      const last = toolCalls[toolCalls.length - 1];
      if (last)
        last.output = typeof msg.content === "string" ? msg.content : "";
    }
  }

  return { answer, toolCalls };
}
