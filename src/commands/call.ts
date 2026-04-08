import chalk                       from "chalk"
import { loadWallet, getNetwork }  from "../utils/config.js"
import { callAgent }               from "../core/callAgent.js"
import { resolveAgent }            from "../core/registry.js"
import { getAccountBalances }      from "../utils/stellar.js"
import { logger }                  from "../utils/logger.js"

// ─── call command ─────────────────────────────────────────────────────────────

export async function callCommand(
  nameOrAddress: string,
  task:          string,
  options: {
    network?: string
    from?:    string
  }
): Promise<void> {
  logger.banner()

  const network = (options.network || getNetwork()) as "testnet" | "mainnet"
  const start   = Date.now()

  // Load caller wallet
  const wallet = loadWallet()
  if (!wallet) {
    console.error(chalk.red("  ✗ No wallet found. Run: stellar-agent wallet create"))
    process.exit(1)
  }

  const totalSteps = 6
  let currentStep  = 0

  function step(label: string, detail?: string) {
    currentStep++
    console.log()
    logger.step(currentStep, totalSteps, label, detail)
  }

  // ── Step 1: Resolve agent ──────────────────────────────────────────────────
  step("Resolving agent...", `Looking up "${nameOrAddress}"`)

  let meta: any
  try {
    meta = await resolveAgent(nameOrAddress, network)
    logger.success("Agent found")
    logger.arrow(`Name:     ${meta.name}`)
    logger.arrow(`Endpoint: ${meta.endpoint}`)
    logger.arrow(`Price:    ${chalk.magenta(meta.price + " " + meta.asset)} per call`)
    logger.arrow(`Model:    ${meta.model}`)
    logger.arrow(`Owner:    ${meta.owner.slice(0, 20)}...`)
  } catch (e: any) {
    logger.error("Agent not found", e.message)
    process.exit(1)
  }

  // ── Step 2: Check balance ──────────────────────────────────────────────────
  step("Checking caller balance...")

  let balances: any[]
  try {
    balances = await getAccountBalances(wallet.publicKey, network)
    const relevant = balances.find((b: any) => b.asset === meta.asset)
    const balance  = parseFloat(relevant?.balance || "0")
    const price    = parseFloat(meta.price)

    logger.arrow(`Caller:   ${wallet.publicKey.slice(0, 20)}...`)
    logger.arrow(`Balance:  ${balance} ${meta.asset}`)

    if (balance < price) {
      logger.error(`Insufficient ${meta.asset}`, `Have ${balance}, need ${price}`)
      logger.info(`Fund your wallet: stellar-agent wallet balance`)
      process.exit(1)
    }

    logger.success(`Balance sufficient (${balance} ${meta.asset})`)
  } catch (e: any) {
    logger.error("Failed to check balance", e.message)
    process.exit(1)
  }

  // ── Steps 3-6: delegated to callAgent ─────────────────────────────────────
  // callAgent handles: probe → pay → verify → call
  let stepOffset = 2
  const result = await callAgent({
    nameOrAddress,
    task,
    payerKeypair: wallet.secretKey,
    network,
    onStep: (msg) => {
      stepOffset++
      // Map callAgent internal steps to our numbered display
      const stepLabels: Record<string, string> = {
        "Resolving agent":            "Resolving agent",
        "Agent found":                "",
        "Price":                      "",
        "Checking caller balance":    "Checking balance",
        "Balance sufficient":         "",
        "Probing agent endpoint":     "Probing endpoint for payment terms",
        "Got 402":                    "",
        "Sending payment":            "Sending payment",
        "Payment confirmed":          "",
        "Calling agent with task":    "Calling agent",
        "Response received":          "Response received",
        "Error":                      "Error",
      }

      // Find matching label prefix
      for (const [prefix, label] of Object.entries(stepLabels)) {
        if (msg.startsWith(prefix)) {
          if (label) {
            const detail = msg.includes(":") ? msg.split(":").slice(1).join(":").trim() : undefined
            if (prefix === "Probing agent endpoint") {
              console.log()
              logger.step(3, totalSteps, label)
            } else if (prefix === "Sending payment") {
              console.log()
              logger.step(4, totalSteps, label, detail)
            } else if (prefix === "Payment confirmed") {
              logger.success("Payment confirmed on Stellar", detail)
            } else if (prefix === "Calling agent with task") {
              console.log()
              logger.step(5, totalSteps, "Calling agent with task")
              logger.arrow(`Task: "${task.slice(0, 80)}"`)
            } else if (prefix === "Response received") {
              console.log()
              logger.step(6, totalSteps, "Response received ✅", detail)
            } else if (prefix === "Error") {
              logger.error(detail || msg)
            } else {
              logger.info(detail || msg)
            }
          } else {
            // Sub-detail
            if (msg.startsWith("Agent found")) {
              logger.success("Agent found")
            } else if (msg.startsWith("Balance sufficient")) {
              logger.success(msg)
            } else if (msg.startsWith("Got 402")) {
              logger.success("402 Payment Required received")
            } else {
              logger.arrow(msg)
            }
          }
          return
        }
      }

      // Fallback
      logger.arrow(msg)
    },
  })

  // ── Output ─────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (!result.success) {
    console.log()
    logger.error("Call failed", result.error)
    process.exit(1)
  }

  logger.result(result.result || "")

  // Summary line
  const balancesAfter = await getAccountBalances(wallet.publicKey, network).catch(() => balances)
  const newBalance    = balancesAfter.find((b: any) => b.asset === meta.asset)?.balance || "?"

  logger.summary(meta.price, meta.asset, newBalance, `${elapsed}s`)

  if (result.txHash) {
    logger.info(
      `View transaction: https://stellar.expert/explorer/${network}/tx/${result.txHash}`
    )
  }
}
