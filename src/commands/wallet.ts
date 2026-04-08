import chalk                             from "chalk"
import { generateKeypair, fundTestnetAccount, getAccountBalances } from "../utils/stellar.js"
import { saveWallet, loadWallet, getNetwork }                       from "../utils/config.js"
import { logger }                                                    from "../utils/logger.js"

// ─── wallet commands ──────────────────────────────────────────────────────────

export async function walletCreateCommand(options: { network?: string }): Promise<void> {
  logger.banner()
  const network = (options.network || getNetwork()) as "testnet" | "mainnet"

  const existing = loadWallet()
  if (existing) {
    console.log(chalk.yellow("  ⚠ Wallet already exists"))
    console.log(chalk.gray(`    Public key: ${existing.publicKey}`))
    console.log(chalk.gray(`    Network:    ${existing.network}`))
    console.log()
    console.log(chalk.gray("  To create a new wallet, delete ~/.stellar-agent/wallet.json first"))
    return
  }

  console.log(chalk.cyan("  [1/3] Generating Stellar keypair..."))
  const { publicKey, secretKey } = generateKeypair()
  logger.success("Keypair generated")
  logger.arrow(`Public key: ${publicKey}`)

  if (network === "testnet") {
    console.log()
    console.log(chalk.cyan("  [2/3] Funding via Stellar Friendbot (testnet)..."))
    const funded = await fundTestnetAccount(publicKey)
    if (funded) {
      logger.success("Account funded with 10,000 XLM (testnet)")
    } else {
      logger.warn("Friendbot funding failed — fund manually")
      logger.info(`https://friendbot.stellar.org?addr=${publicKey}`)
    }
  } else {
    console.log(chalk.cyan("  [2/3] Skipping Friendbot (mainnet)"))
    logger.info("Fund this address with XLM before using")
  }

  console.log()
  console.log(chalk.cyan("  [3/3] Saving wallet..."))
  saveWallet({ publicKey, secretKey, network })
  logger.success("Wallet saved to ~/.stellar-agent/wallet.json")

  console.log()
  console.log(chalk.cyan("  " + "─".repeat(54)))
  console.log(chalk.green.bold("  Wallet created ✓"))
  console.log(chalk.cyan("  " + "─".repeat(54)))
  console.log(chalk.gray("  Public key: ") + chalk.white(publicKey))
  console.log(chalk.gray("  Network:    ") + chalk.white(network))
  console.log(chalk.red("  ⚠ Secret key stored securely in ~/.stellar-agent/wallet.json"))
  console.log(chalk.red("  ⚠ Never share your secret key"))
  console.log()
}

export async function walletBalanceCommand(options: { network?: string }): Promise<void> {
  const network = (options.network || getNetwork()) as "testnet" | "mainnet"
  const wallet  = loadWallet()

  if (!wallet) {
    console.error(chalk.red("  ✗ No wallet found. Run: stellar-agent wallet create"))
    process.exit(1)
  }

  try {
    const balances = await getAccountBalances(wallet.publicKey, network)
    console.log()
    console.log(chalk.cyan("  Wallet Balance"))
    console.log(chalk.gray("  Address: ") + chalk.white(wallet.publicKey))
    console.log(chalk.gray("  Network: ") + chalk.white(network))
    console.log()

    for (const { asset, balance } of balances) {
      const color = asset === "XLM" ? chalk.cyan : chalk.green
      console.log(`    ${color(asset.padEnd(8))} ${chalk.white(balance)}`)
    }
    console.log()

    logger.info(`Explorer: https://stellar.expert/explorer/${network}/account/${wallet.publicKey}`)
    console.log()
  } catch (e: any) {
    console.error(chalk.red(`  ✗ Failed to get balance: ${e.message}`))
    process.exit(1)
  }
}

export async function walletInfoCommand(): Promise<void> {
  const wallet = loadWallet()
  if (!wallet) {
    console.error(chalk.red("  ✗ No wallet found. Run: stellar-agent wallet create"))
    process.exit(1)
  }
  console.log()
  console.log(chalk.cyan("  Caller Wallet"))
  console.log(chalk.gray("  Public key: ") + chalk.white(wallet.publicKey))
  console.log(chalk.gray("  Network:    ") + chalk.white(wallet.network))
  console.log()
}
