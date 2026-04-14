import fs from "fs";
import path from "path";
import readline from "readline";
import chalk from "chalk";
import { runAgent } from "../core/agentRunner.js";
import { loadAgentConfig, loadAgentEnv, getNetwork } from "../utils/config.js";
import { logger } from "../utils/logger.js";

type ChatTurn = { role: "user" | "assistant"; content: string };

function historyPath(dir: string): string {
  return path.join(dir, ".blockbot", "chat-history.json");
}

function loadHistory(dir: string): ChatTurn[] {
  const p = historyPath(dir);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(dir: string, turns: ChatTurn[]): void {
  const stateDir = path.join(dir, ".blockbot");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(historyPath(dir), JSON.stringify(turns.slice(-40), null, 2));
}

function buildTask(input: string, history: ChatTurn[]): string {
  const recent = history.slice(-10);
  if (recent.length === 0) return input;

  const transcript = recent
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  return [
    "Continue this conversation naturally.",
    "Conversation so far:",
    transcript,
    "",
    `User: ${input}`,
  ].join("\n");
}

export async function chatCommand(options: {
  network?: string;
  clear?: boolean;
}): Promise<void> {
  logger.banner();

  const dir = process.cwd();
  const network = (options.network || getNetwork()) as "testnet" | "mainnet";

  const config = loadAgentConfig(dir);
  const env = loadAgentEnv(dir);

  const secretKey = env.STELLAR_SECRET_KEY || process.env.STELLAR_SECRET_KEY;
  const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;

  if (!secretKey) {
    console.error(chalk.red("  ✗ STELLAR_SECRET_KEY not found in .env"));
    process.exit(1);
  }
  if (!groqKey) {
    console.error(chalk.red("  ✗ GROQ_API_KEY not found in .env"));
    process.exit(1);
  }

  process.env.GROQ_API_KEY = groqKey;
  process.env.STELLAR_NETWORK = network;

  let turns: ChatTurn[] = loadHistory(dir);
  if (options.clear) {
    turns = [];
    saveHistory(dir, turns);
  }

  logger.success(`Chat ready for ${config.name}`);
  logger.arrow(`Network: ${network}`);
  if (turns.length > 0) {
    logger.arrow(`Loaded ${turns.length} previous messages`);
  }
  console.log(chalk.gray("  Type your message. Commands: /exit, /clear"));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("you$ "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "/exit" || input === "/quit") {
      rl.close();
      return;
    }

    if (input === "/clear") {
      turns = [];
      saveHistory(dir, turns);
      logger.success("Conversation history cleared");
      rl.prompt();
      return;
    }

    turns.push({ role: "user", content: input });

    const task = buildTask(input, turns);
    console.log(chalk.magenta("agent$ ") + chalk.gray("thinking..."));

    try {
      const result = await runAgent({
        config,
        secretKey,
        task: input,
        network,
      });

      const answer = result.answer || "(no response)";
      turns.push({ role: "assistant", content: answer });
      saveHistory(dir, turns);

      console.log(chalk.magenta("agent$ ") + answer);
      if (result.toolCalls?.length) {
        console.log(
          chalk.gray(
            `  tools used: ${result.toolCalls.map((t) => t.tool).join(", ")}`,
          ),
        );
      }
      console.log();
    } catch (e: any) {
      console.log(chalk.red(`agent$ error: ${e.message}`));
      console.log();
    }

    rl.prompt();
  });

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      saveHistory(dir, turns);
      logger.info("Chat ended");
      resolve();
    });
  });
}
