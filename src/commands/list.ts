import chalk from "chalk";
import { fetchMetadata } from "../utils/pinata.js";
import { getNetwork } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { agentRegistry } from "../core/registry.js";

// ─── list command ─────────────────────────────────────────────────────────────

export async function listCommand(options: {
  network?: string;
}): Promise<void> {
  logger.banner();
  const network = (options.network || getNetwork()) as "testnet" | "mainnet";

  console.log(chalk.cyan("  Fetching registered agents...\n"));

  let agents: { name: string; cid: string }[];
  try {
    agents = await agentRegistry.listAgents(network);
  } catch (e: any) {
    logger.error("Failed to fetch registry", e.message);
    logger.info(
      "Make sure STELLAR_REGISTRY_ADDRESS is set in your environment",
    );
    process.exit(1);
  }

  if (agents.length === 0) {
    console.log(chalk.yellow("  No agents registered yet."));
    console.log(chalk.gray("  Deploy one with: stellar-agent serve"));
    console.log();
    return;
  }

  console.log(chalk.gray(`  Found ${agents.length} agent(s) on ${network}\n`));

  // Fetch metadata for each agent
  const rows: any[] = [];
  for (const { name, cid } of agents) {
    try {
      const meta: any = await fetchMetadata(cid);
      rows.push({
        name: chalk.cyan(meta.name || name),
        price: chalk.magenta(`${meta.price} ${meta.asset}`),
        model: chalk.gray(meta.model || "unknown"),
        desc: (meta.description || "").slice(0, 40),
        endpoint: (meta.endpoint || "").slice(0, 35) + "...",
      });
    } catch {
      rows.push({
        name: chalk.cyan(name),
        price: chalk.gray("unknown"),
        model: chalk.gray("unknown"),
        desc: chalk.gray("(metadata unavailable)"),
        endpoint: chalk.gray(cid),
      });
    }
  }

  // Print table manually
  const col = { name: 24, price: 16, model: 28, desc: 42 };

  console.log(
    "  " +
      chalk.gray("NAME".padEnd(col.name)) +
      chalk.gray("PRICE".padEnd(col.price)) +
      chalk.gray("MODEL".padEnd(col.model)) +
      chalk.gray("DESCRIPTION"),
  );
  console.log(
    "  " + chalk.gray("─".repeat(col.name + col.price + col.model + col.desc)),
  );

  for (const row of rows) {
    console.log(
      "  " + row.name.padEnd
        ? row.name.padEnd(col.name)
        : row.name +
            " ".repeat(Math.max(0, col.name - row.name.length)) +
            row.price.toString().padEnd(col.price) +
            row.model.toString().padEnd(col.model) +
            row.desc,
    );
  }

  console.log();
  console.log(
    chalk.gray(`  Call any agent: stellar-agent call <name> "<task>"`),
  );
  console.log();
}

// ─── inspect command ──────────────────────────────────────────────────────────

export async function inspectCommand(
  nameOrAddress: string,
  options: { network?: string },
): Promise<void> {
  logger.banner();
  const network = (options.network || getNetwork()) as "testnet" | "mainnet";

  console.log(chalk.cyan(`  Inspecting "${nameOrAddress}"...\n`));

  try {
    const meta: any = await agentRegistry.resolveAgent(nameOrAddress, network);

    logger.agentCard({
      name: meta.name,
      description: meta.description || "No description",
      endpoint: meta.endpoint || "unknown",
      price: meta.price || "0",
      asset: meta.asset || "XLM",
      model: meta.model || "unknown",
      owner: meta.owner || "unknown",
    });

    console.log(chalk.gray("  Full metadata:\n"));
    const fields = [
      ["Name", meta.name],
      ["Version", meta.version],
      ["Description", meta.description],
      ["Model", meta.model],
      ["Price", `${meta.price} ${meta.asset}`],
      ["Endpoint", meta.endpoint],
      ["Owner", meta.owner],
      ["Tools", (meta.tools || []).join(", ") || "none (core tools only)"],
      ["IPFS CID", meta.ipfs_cid],
      ["Registered", meta.registered_at],
    ];

    for (const [key, val] of fields) {
      if (val) {
        console.log(
          `    ${chalk.gray((key + ":").padEnd(16))} ${chalk.white(val)}`,
        );
      }
    }
    console.log();
    console.log(chalk.gray(`  Call this agent:`));
    console.log(
      chalk.cyan(`    stellar-agent call "${meta.name}" "<your task>"`),
    );
    console.log();
  } catch (e: any) {
    logger.error("Failed to inspect agent", e.message);
    process.exit(1);
  }
}
