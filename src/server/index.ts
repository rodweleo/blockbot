import express, { type Request, type Response } from "express"
import cors                                      from "cors"
import { runAgent }                              from "../core/agentRunner.js"
import type { AgentConfig }                      from "../core/types.js"

// ─── Agent HTTP Server ────────────────────────────────────────────────────────

export function createAgentServer(opts: {
  config:    AgentConfig
  secretKey: string
  network:   "testnet" | "mainnet"
}): express.Application {
  const { config, secretKey, network } = opts
  const app = express()

  app.use(cors())
  app.use(express.json())

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status:  "ok",
      agent:   config.name,
      version: config.version,
      model:   config.model,
    })
  })

  // ── Agent metadata ────────────────────────────────────────────────────────────
  app.get("/agent", (_req: Request, res: Response) => {
    res.json({
      name:        config.name,
      description: config.description,
      price:       config.price,
      asset:       config.asset,
      model:       config.model,
      tools:       config.tools,
      version:     config.version,
    })
  })

  // ── Main agent endpoint ───────────────────────────────────────────────────────
  app.post("/agent", async (req: Request, res: Response) => {
    const { task } = req.body

    if (!task) {
      res.status(400).json({ error: "Missing 'task' in request body" })
      return
    }

    // ── Payment verification ───────────────────────────────────────────────────
    // Check for payment proof headers (sent by callAgent after paying)
    const txHash        = req.headers["x-payment-txhash"]  as string
    const paymentFrom   = req.headers["x-payment-from"]    as string
    const paymentAmount = req.headers["x-payment-amount"]  as string
    const paymentAsset  = req.headers["x-payment-asset"]   as string

    if (!txHash) {
      // No payment — return 402 with payment requirements
      res.status(402).json({
        error:   "Payment required",
        payment: {
          amount:  config.price,
          asset:   config.asset,
          payTo:   config.owner,
          network: network,
          resource: "/agent",
          description: `${config.name}: ${config.description}`,
        },
        instructions: [
          "1. Send payment to the 'payTo' address on Stellar",
          "2. Retry this request with payment proof headers:",
          "   X-Payment-TxHash: <transaction_hash>",
          "   X-Payment-From: <your_stellar_address>",
          "   X-Payment-Amount: <amount_paid>",
          "   X-Payment-Asset: <asset>",
        ],
      })
      return
    }

    // ── Verify payment on Stellar ──────────────────────────────────────────────
    try {
      const verified = await verifyPayment({
        txHash,
        from:     paymentFrom,
        to:       config.owner!,
        amount:   config.price,
        asset:    config.asset,
        network,
      })

      if (!verified) {
        res.status(402).json({ error: "Payment verification failed" })
        return
      }
    } catch (e: any) {
      res.status(402).json({ error: `Payment verification error: ${e.message}` })
      return
    }

    // ── Run the agent ──────────────────────────────────────────────────────────
    console.log(`\n  [${new Date().toISOString()}] Task received from ${paymentFrom?.slice(0, 20)}`)
    console.log(`  Task: "${task.slice(0, 100)}"`)
    console.log(`  Payment: ${paymentAmount} ${paymentAsset} (tx: ${txHash?.slice(0, 20)}...)`)

    try {
      const steps: string[] = []
      const result = await runAgent({
        config,
        secretKey,
        task,
        network,
        onStep: (step) => {
          console.log(`    → ${step}`)
          steps.push(step)
        },
      })

      console.log(`  ✓ Task complete\n`)

      res.json({
        success:   true,
        agent:     config.name,
        result:    result.answer,
        toolCalls: result.toolCalls,
        steps,
        payment: {
          txHash,
          from:   paymentFrom,
          amount: paymentAmount,
          asset:  paymentAsset,
        },
      })
    } catch (e: any) {
      console.error(`  ✗ Task failed: ${e.message}`)
      res.status(500).json({ error: `Agent execution failed: ${e.message}` })
    }
  })

  return app
}

// ─── Payment Verification ─────────────────────────────────────────────────────
async function verifyPayment(opts: {
  txHash:  string
  from:    string
  to:      string
  amount:  string
  asset:   string
  network: "testnet" | "mainnet"
}): Promise<boolean> {
  try {
    const baseUrl = opts.network === "testnet"
      ? "https://horizon-testnet.stellar.org"
      : "https://horizon.stellar.org"

    const res  = await fetch(`${baseUrl}/transactions/${opts.txHash}`)
    if (!res.ok) return false

    const tx: any = await res.json()

    // Check transaction is recent (within 5 minutes)
    const txTime   = new Date(tx.created_at).getTime()
    const now      = Date.now()
    const fiveMin  = 5 * 60 * 1000
    if (now - txTime > fiveMin) {
      console.log("  ⚠ Payment transaction is too old")
      return false
    }

    // Fetch operations on this transaction
    const opsRes  = await fetch(`${baseUrl}/transactions/${opts.txHash}/operations`)
    const opsData: any = await opsRes.json()
    const ops     = opsData._embedded?.records || []

    for (const op of ops) {
      if (op.type !== "payment") continue
      if (op.to !== opts.to) continue
      if (op.from !== opts.from) continue

      const paidAmount = parseFloat(op.amount)
      const required   = parseFloat(opts.amount)

      if (paidAmount >= required) {
        const assetMatch =
          (opts.asset === "XLM" && op.asset_type === "native") ||
          (opts.asset !== "XLM" && op.asset_code === opts.asset)

        if (assetMatch) return true
      }
    }

    return false
  } catch {
    return false
  }
}
