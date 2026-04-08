import path    from "path"
import chalk   from "chalk"
import localtunnel from "localtunnel"
import { loadAgentConfig, loadAgentEnv, getNetwork } from "../utils/config.js"
import { uploadMetadata }                             from "../utils/pinata.js"
import { registerAgent }                              from "../core/registry.js"
import { createAgentServer }                          from "../server/index.js"
import { logger }                                     from "../utils/logger.js"
import type { AgentMetadata }                         from "../core/types.js"

// ─── serve command ────────────────────────────────────────────────────────────

export async function serveCommand(options: {
  port?:    string
  tunnel?:  boolean
  network?: string
}): Promise<void> {
  logger.banner()

  const port    = parseInt(options.port || "3000")
  const network = (options.network || getNetwork()) as "testnet" | "mainnet"
  const dir     = process.cwd()

  // Load config + env
  let config: any
  let env: Record<string, string>

  try {
    config = loadAgentConfig(dir)
    env    = loadAgentEnv(dir)
  } catch (e: any) {
    console.error(chalk.red(`  ✗ ${e.message}`))
    process.exit(1)
  }

  const secretKey  = env.STELLAR_SECRET_KEY || process.env.STELLAR_SECRET_KEY
  const groqKey    = env.GROQ_API_KEY       || process.env.GROQ_API_KEY
  const pinataJwt  = env.PINATA_JWT         || process.env.PINATA_JWT

  if (!secretKey) {
    console.error(chalk.red("  ✗ STELLAR_SECRET_KEY not found in .env"))
    process.exit(1)
  }
  if (!groqKey) {
    console.error(chalk.red("  ✗ GROQ_API_KEY not found in .env"))
    process.exit(1)
  }

  // Set env vars for tools
  process.env.GROQ_API_KEY      = groqKey
  process.env.STELLAR_NETWORK   = network
  if (pinataJwt) process.env.PINATA_JWT = pinataJwt
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY

  // ── Step 1: Start Express server ─────────────────────────────────────────────
  console.log(chalk.cyan(`  [1/5] Starting agent server...`))

  const { Keypair } = await import("@stellar/stellar-sdk")
  const keypair     = Keypair.fromSecret(secretKey)
  const publicKey   = keypair.publicKey()

  config.owner = publicKey

  const app = createAgentServer({ config, secretKey, network })

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      logger.success(`Express listening on http://localhost:${port}`)
      logger.success(`x402 payment gating active — price: ${config.price} ${config.asset}`)
      resolve()
    })
  })

  // ── Step 2: Open ngrok tunnel ─────────────────────────────────────────────────
  let publicUrl = `http://localhost:${port}`

  if (options.tunnel !== false) {
    console.log(chalk.cyan(`  [2/5] Opening tunnel (localtunnel)...`))
    try {
      const tunnel = await localtunnel({ port })
      publicUrl    = tunnel.url
      logger.success("Tunnel established", publicUrl)
      logger.info("Note: localtunnel may show a visitor page on first visit")

      tunnel.on("error", (err: any) => {
        logger.warn("Tunnel error", err.message)
      })

      // Re-register cleanup
      process.on("SIGINT", async () => {
        tunnel.close()
      })
    } catch (e: any) {
      logger.warn("Tunnel failed — using localhost", e.message)
      logger.info("For a stable public URL, set NGROK_AUTHTOKEN and install ngrok manually")
      publicUrl = `http://localhost:${port}`
    }
  } else {
    console.log(chalk.gray(`  [2/5] Skipping tunnel (--no-tunnel)`))
  }

  config.endpoint = `${publicUrl}/agent`

  // ── Step 3: Build metadata ────────────────────────────────────────────────────
  console.log(chalk.cyan(`  [3/5] Building agent metadata...`))

  const metadata: AgentMetadata = {
    ...config,
    owner:          publicKey,
    endpoint:       config.endpoint,
    registered_at:  new Date().toISOString(),
    ipfs_cid:       "",
  }

  logger.arrow(`name:     ${metadata.name}`)
  logger.arrow(`endpoint: ${metadata.endpoint}`)
  logger.arrow(`price:    ${metadata.price} ${metadata.asset}`)
  logger.arrow(`model:    ${metadata.model}`)

  // ── Step 4: Upload to Pinata ──────────────────────────────────────────────────
  console.log(chalk.cyan(`  [4/5] Uploading metadata to Pinata...`))

  let cid = "local"
  if (pinataJwt) {
    try {
      cid = await uploadMetadata(metadata)
      metadata.ipfs_cid = cid
      logger.success("IPFS CID", cid)
    } catch (e: any) {
      logger.warn("Pinata upload failed — running without IPFS", e.message)
    }
  } else {
    logger.warn("PINATA_JWT not set — skipping IPFS upload")
    logger.info("Agent discoverable by wallet address only")
  }

  // ── Step 5: Register on Stellar ──────────────────────────────────────────────
  console.log(chalk.cyan(`  [5/5] Registering on Stellar (${network})...`))

  try {
    const { txHash } = await registerAgent({
      name:        config.name,
      metadata,
      agentSecret: secretKey,
      network,
    })
    logger.success("Registered on Stellar", txHash !== "self-registered" ? `tx: ${txHash.slice(0, 20)}...` : "by wallet address")
  } catch (e: any) {
    logger.warn("Stellar registration failed", e.message)
    logger.info("Agent still reachable via endpoint directly")
  }

  // ── Live ──────────────────────────────────────────────────────────────────────
  console.log()
  console.log(chalk.cyan("  " + "─".repeat(54)))
  console.log(chalk.green.bold(`  Agent "${config.name}" is LIVE 🚀`))
  console.log(chalk.cyan("  " + "─".repeat(54)))
  console.log(chalk.gray("  Endpoint:  ") + chalk.white(config.endpoint))
  console.log(chalk.gray("  Price:     ") + chalk.magenta(`${config.price} ${config.asset} per call`))
  console.log(chalk.gray("  Network:   ") + chalk.white(network))
  console.log(chalk.gray("  Wallet:    ") + chalk.white(publicKey.slice(0, 20) + "..."))
  console.log(chalk.gray("  Model:     ") + chalk.white(config.model))
  if (cid !== "local") {
    console.log(chalk.gray("  IPFS CID:  ") + chalk.white(cid))
  }
  console.log(chalk.cyan("  " + "─".repeat(54)))
  console.log()
  console.log(chalk.gray("  Waiting for requests... (Ctrl+C to stop)\n"))

  // Keep alive — handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n  Shutting down..."))
    process.exit(0)
  })

  // Block forever
  await new Promise(() => {})
}
