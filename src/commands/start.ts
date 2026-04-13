import fs from "fs";
import path from "path";
import { serveCommand } from "./serve.js";
import { logger } from "../utils/logger.js";

interface RuntimeState {
  network?: "testnet" | "mainnet";
  tunnel?: boolean;
  port?: string;
}

export async function startCommand(options: {
  network?: string;
  tunnel?: boolean;
  port?: string;
}): Promise<void> {
  logger.banner();

  const statePath = path.join(process.cwd(), ".blockbot", "runtime.json");
  let previous: RuntimeState = {};

  if (fs.existsSync(statePath)) {
    try {
      previous = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      logger.success("Loaded previous runtime config", statePath);
    } catch (e: any) {
      logger.warn("Could not parse runtime state", e.message);
    }
  } else {
    logger.info("No previous runtime state found, using current options");
  }

  await serveCommand({
    network: options.network || previous.network,
    port: options.port || previous.port,
    tunnel:
      options.tunnel !== undefined
        ? options.tunnel
        : previous.tunnel !== undefined
          ? previous.tunnel
          : true,
  });
}
