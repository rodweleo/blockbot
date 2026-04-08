import axios                     from "axios"
import { resolveAgent }          from "./registry.js"
import { getAccountBalances }    from "../utils/stellar.js"
import type { CallAgentOptions, CallAgentResult } from "./types.js"

// ─── callAgent ────────────────────────────────────────────────────────────────
// The core function used by:
//   1. `stellar-agent call` CLI command
//   2. Agent servers calling other agents (agent-to-agent)
// Same code path, same payment flow, same logging hooks.

export async function callAgent(opts: CallAgentOptions): Promise<CallAgentResult> {
  const { nameOrAddress, task, payerKeypair, onStep } = opts
  const network = opts.network || "testnet"
  const stepsLog: string[] = []
  const start = Date.now()

  function log(msg: string, detail?: string) {
    const line = detail ? `${msg}: ${detail}` : msg
    stepsLog.push(line)
    onStep?.(line)
  }

  try {
    // ── Step 1: Resolve agent ──────────────────────────────────────────────────
    log("Resolving agent", nameOrAddress)
    const meta = await resolveAgent(nameOrAddress, network)
    log("Agent found", `${meta.name} @ ${meta.endpoint}`)
    log("Price", `${meta.price} ${meta.asset}`)

    // ── Step 2: Check caller balance ───────────────────────────────────────────
    const { Keypair } = await import("@stellar/stellar-sdk")
    const callerKeypair = Keypair.fromSecret(payerKeypair)
    const callerAddress = callerKeypair.publicKey()

    log("Checking caller balance", callerAddress.slice(0, 20) + "...")
    const balances = await getAccountBalances(callerAddress, network)
    const relevant = balances.find(b => b.asset === meta.asset)
    const balance  = parseFloat(relevant?.balance || "0")
    const price    = parseFloat(meta.price)

    if (balance < price) {
      throw new Error(
        `Insufficient ${meta.asset} balance. Have: ${balance}, Need: ${price}`
      )
    }
    log("Balance sufficient", `${balance} ${meta.asset}`)

    // ── Step 3: Probe endpoint for x402 payment terms ─────────────────────────
    log("Probing agent endpoint for payment terms")
    let paymentTerms: any = null

    try {
      await axios.post(meta.endpoint, { task }, { timeout: 10000 })
    } catch (err: any) {
      if (err.response?.status === 402) {
        paymentTerms = err.response.data
        log("Got 402 payment required", JSON.stringify(paymentTerms).slice(0, 100))
      } else if (err.response?.status) {
        throw new Error(`Agent endpoint error: ${err.response.status}`)
      } else {
        throw new Error(`Cannot reach agent endpoint: ${err.message}`)
      }
    }

    // ── Step 4: Handle payment ─────────────────────────────────────────────────
    // x402-axios handles the payment header automatically when set up.
    // For Stellar, we do a direct payment since x402 Stellar facilitator
    // uses transferWithAuthorization pattern.
    log(`Sending payment`, `${meta.price} ${meta.asset} → ${meta.owner.slice(0, 20)}...`)

    const { sendPayment } = await import("../utils/stellar.js")
    const txHash = await sendPayment({
      secretKey: payerKeypair,
      to:        meta.owner,
      amount:    meta.price,
      asset:     meta.asset as "XLM" | "USDC",
      network,
      memo:      `agent:${meta.name.slice(0, 18)}`,
    })
    log("Payment confirmed", `tx: ${txHash.slice(0, 20)}...`)

    // ── Step 5: Call agent with payment proof ──────────────────────────────────
    log("Calling agent with task")
    const response = await axios.post(
      meta.endpoint,
      { task },
      {
        headers: {
          "X-Payment-TxHash":  txHash,
          "X-Payment-From":    callerAddress,
          "X-Payment-Amount":  meta.price,
          "X-Payment-Asset":   meta.asset,
          "X-Payment-Network": network,
          "Content-Type":      "application/json",
        },
        timeout: 120000, // 2 min for long tasks
      }
    )

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    log("Response received", `${elapsed}s`)

    const result = typeof response.data === "string"
      ? response.data
      : response.data?.result || response.data?.answer || JSON.stringify(response.data)

    return {
      success:  true,
      result,
      txHash,
      stepsLog,
    }

  } catch (err: any) {
    const msg = err.message || String(err)
    log("Error", msg)
    return {
      success:  false,
      error:    msg,
      stepsLog,
    }
  }
}
