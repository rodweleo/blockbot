import chalk from "chalk";

// ─── Logger ────────────────────────────────────────────────────────────────────

const ICONS = {
  step: chalk.cyan("◆"),
  success: chalk.green("✓"),
  error: chalk.red("✗"),
  warn: chalk.yellow("⚠"),
  info: chalk.blue("ℹ"),
  arrow: chalk.gray("→"),
  pay: chalk.magenta("⟁"),
  agent: chalk.cyan("⬡"),
};

export const logger = {
  banner() {
    console.log();
    console.log(chalk.cyan.bold("  ╔═══════════════════════════════════╗"));
    console.log(
      chalk.cyan.bold("  ║") +
        chalk.white.bold("       blockbot  v0.1.0            ") +
        chalk.cyan.bold("║"),
    );
    console.log(
      chalk.cyan.bold("  ║") +
        chalk.gray("   AI agents on Stellar blockchain   ") +
        chalk.cyan.bold("║"),
    );
    console.log(chalk.cyan.bold("  ╚═══════════════════════════════════╝"));
    console.log();
  },

  step(index: number, total: number, label: string, detail?: string) {
    const counter = chalk.gray(`[${index}/${total}]`);
    console.log(`  ${counter} ${ICONS.step} ${chalk.white(label)}`);
    if (detail) console.log(`         ${chalk.gray(detail)}`);
  },

  success(label: string, detail?: string) {
    console.log(`         ${ICONS.success} ${chalk.green(label)}`);
    if (detail) console.log(`           ${chalk.gray(detail)}`);
  },

  error(label: string, detail?: string) {
    console.log(`         ${ICONS.error} ${chalk.red(label)}`);
    if (detail) console.log(`           ${chalk.gray(detail)}`);
  },

  warn(label: string, detail?: string) {
    console.log(`         ${ICONS.warn} ${chalk.yellow(label)}`);
    if (detail) console.log(`           ${chalk.gray(detail)}`);
  },

  info(label: string) {
    console.log(`         ${ICONS.info} ${chalk.gray(label)}`);
  },

  arrow(label: string) {
    console.log(`         ${ICONS.arrow} ${chalk.gray(label)}`);
  },

  payment(label: string) {
    console.log(`         ${ICONS.pay} ${chalk.magenta(label)}`);
  },

  agentCall(label: string) {
    console.log(`         ${ICONS.agent} ${chalk.cyan(label)}`);
  },

  subStep(label: string, detail?: string) {
    console.log(`              ${chalk.gray("└")} ${chalk.gray(label)}`);
    if (detail) console.log(`                ${chalk.gray(detail)}`);
  },

  result(text: string) {
    console.log();
    console.log(chalk.cyan("  ┌" + "─".repeat(54) + "┐"));
    console.log(
      chalk.cyan("  │") +
        chalk.white.bold("  Result") +
        " ".repeat(47) +
        chalk.cyan("│"),
    );
    console.log(chalk.cyan("  ├" + "─".repeat(54) + "┤"));
    const lines = text.split("\n");
    for (const line of lines) {
      const chunks = chunkString(line, 52);
      for (const chunk of chunks) {
        console.log(
          chalk.cyan("  │") +
            "  " +
            chalk.white(chunk.padEnd(52)) +
            chalk.cyan("│"),
        );
      }
    }
    console.log(chalk.cyan("  └" + "─".repeat(54) + "┘"));
    console.log();
  },

  agentCard(meta: {
    name: string;
    description: string;
    endpoint: string;
    price: string;
    asset: string;
    model: string;
    owner: string;
  }) {
    console.log();
    console.log(chalk.cyan("  ┌" + "─".repeat(54) + "┐"));
    console.log(
      chalk.cyan("  │") +
        chalk.white.bold(`  ${meta.name}`).padEnd(64) +
        chalk.cyan("│"),
    );
    console.log(chalk.cyan("  ├" + "─".repeat(54) + "┤"));
    const rows = [
      ["Description", meta.description],
      ["Endpoint", meta.endpoint],
      ["Price", `${meta.price} ${meta.asset} per call`],
      ["Model", meta.model],
      ["Owner", meta.owner.slice(0, 20) + "..."],
    ];
    for (const [k, v] of rows) {
      const key = chalk.gray(k.padEnd(12));
      const val = chalk.white(v.slice(0, 36));
      console.log(
        chalk.cyan("  │") + `  ${key}  ${val}`.padEnd(64) + chalk.cyan("│"),
      );
    }
    console.log(chalk.cyan("  └" + "─".repeat(54) + "┘"));
    console.log();
  },

  divider() {
    console.log(chalk.gray("  " + "─".repeat(54)));
  },

  blank() {
    console.log();
  },

  summary(paid: string, asset: string, remaining: string, elapsed: string) {
    console.log(
      chalk.gray("  Paid: ") +
        chalk.magenta(`${paid} ${asset}`) +
        chalk.gray("  │  Remaining: ") +
        chalk.white(remaining) +
        ` ${asset}` +
        chalk.gray("  │  Time: ") +
        chalk.white(elapsed),
    );
    console.log();
  },
};

function chunkString(str: string, size: number): string[] {
  if (str.length <= size) return [str];
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}
