import { Memo, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import {
  ensureTrustline,
  ensureAccountFunded,
  getAccountBalances,
  isNativeAsset,
} from "../utils/stellar.js";
import type { CallAgentOptions, CallAgentResult } from "./types.js";
import { agentRegistry } from "./registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}

function addSimulationHint(message: string, asset: string): string {
  if (
    /Error\(Contract,\s*#10\)|resulting balance is not within the allowed range/i.test(
      message,
    )
  ) {
    return (
      `${message}\n` +
      `Hint: x402 simulation indicates insufficient ${asset} for the challenged payment terms. ` +
      `Confirm payer balance/trustline for ${asset} and ensure registry/live endpoint terms are aligned.`
    );
  }
  return message;
}

// ─── callAgent (x402-Compliant) ───────────────────────────────────────────────
export async function callAgent(
  opts: CallAgentOptions,
): Promise<CallAgentResult> {
  const { nameOrAddress, task: receivedTask, payerKeypair, onStep } = opts;
  const network = opts.network || "testnet";
  const stepsLog: string[] = [];
  const start = Date.now();
  let resolvedAsset = "unknown";

  function log(msg: string, detail?: string) {
    const line = detail ? `${msg}: ${detail}` : msg;
    stepsLog.push(line);
    onStep?.(line);
    console.log(line);
  }

  try {
    // ── Step 1: Resolve agent ──────────────────────────────────────────────────
    log("Resolving agent", nameOrAddress);
    const meta = await agentRegistry.resolveAgent(nameOrAddress, network);
    resolvedAsset = meta.asset;
    log("Agent found", `${meta.name} @ ${meta.endpoint}`);
    log("Price", `${meta.price} ${meta.asset}`);

    // ── Step 1b: Refresh payment terms from live endpoint metadata ───────────
    // Registry entries can be stale; use /agent metadata as source-of-truth when available.
    let paymentAsset = meta.asset;
    let paymentPrice = parseFloat(meta.price);
    try {
      const metaRes = await fetch(meta.endpoint, { method: "GET" });
      if (metaRes.ok) {
        const live = await metaRes.json();
        const liveAsset =
          typeof live.asset === "string" ? live.asset : undefined;
        const livePriceRaw =
          typeof live.price === "string" || typeof live.price === "number"
            ? String(live.price)
            : undefined;
        const livePrice = livePriceRaw ? parseFloat(livePriceRaw) : NaN;

        if (liveAsset && liveAsset !== paymentAsset) {
          log("Live payment asset differs", `${paymentAsset} -> ${liveAsset}`);
          paymentAsset = liveAsset;
          resolvedAsset = liveAsset;
        }

        if (!isNaN(livePrice) && livePrice > 0 && livePrice !== paymentPrice) {
          log("Live payment price differs", `${paymentPrice} -> ${livePrice}`);
          paymentPrice = livePrice;
        }
      }
    } catch {
      // Non-fatal; continue with resolved metadata.
    }

    // ── Step 2: Ensure payer account exists and is funded ──────────────────────
    const { Keypair } = await import("@stellar/stellar-sdk");
    const callerKeypair = Keypair.fromSecret(payerKeypair);
    const callerAddress = callerKeypair.publicKey();

    log("Checking payer account", callerAddress.slice(0, 20) + "...");
    await ensureAccountFunded(callerAddress, network);

    // ── Step 3: Ensure trustline exists for the payment asset ──────────────────
    // Handles ALL cases:
    //   XLM   → checks + creates SAC contract trustline (needed by x402/Soroban)
    //   USDC  → checks + creates classic Horizon trustline + SAC activation
    //   EURC  → same as USDC
    log("Checking trustline", paymentAsset);
    try {
      const { existed, txHash } = await ensureTrustline(
        payerKeypair,
        paymentAsset,
        network,
      );
      if (!existed) {
        log(
          "Trustline created",
          txHash ? `tx: ${txHash.slice(0, 16)}...` : "ok",
        );
      } else {
        log("Trustline ready", paymentAsset);
      }
    } catch (e: any) {
      // Hard stop — don't let the LLM guess how to fix this
      return {
        success: false,
        error:
          `Trustline setup failed for ${paymentAsset}: ${e.message}\n` +
          `Ensure the payer wallet has at least 1 XLM for reserves and fees.`,
        stepsLog,
      };
    }

    // ── Step 4: Verify balance is sufficient ───────────────────────────────────
    const balances = await getAccountBalances(callerAddress, network);
    const relevant = balances.find((b) =>
      isNativeAsset(paymentAsset)
        ? b.asset === "XLM"
        : b.asset === paymentAsset,
    );

    const balance = parseFloat(relevant?.balance ?? "0");
    const price = paymentPrice;

    if (balance < price) {
      return {
        success: false,
        error:
          `Insufficient ${paymentAsset} balance.\n` +
          `Have: ${balance} ${paymentAsset}, Need: ${price} ${paymentAsset}.\n` +
          (isNativeAsset(paymentAsset)
            ? `Fund via: https://friendbot.stellar.org?addr=${callerAddress}`
            : `Get testnet USDC at: https://usdcfaucet.com (select Stellar testnet)`),
        stepsLog,
      };
    }
    log("Balance sufficient", `${balance} ${paymentAsset}`);

    // ── Step 5: Set up x402 client ─────────────────────────────────────────────
    const stellarNetwork =
      network === "testnet" ? "stellar:testnet" : "stellar:public";
    const sorobanRpcUrl =
      network === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "https://soroban.stellar.org";

    const signer = createEd25519Signer(payerKeypair, stellarNetwork);
    const client = new x402Client();
    const x402ClientInstance = client.register(
      "stellar:*",
      new ExactStellarScheme(signer, { url: sorobanRpcUrl }), //add later after the arg signer { url: sorobanRpcUrl }
    );
    const httpClient = new x402HTTPClient(x402ClientInstance);
    log("x402 client initialized", stellarNetwork);

    // ── Step 6: Probe endpoint for 402 response ────────────────────────────────
    log("Probing agent endpoint for payment terms");

    let initialResponse: Response;
    try {
      initialResponse = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: receivedTask }),
      });
    } catch (err: any) {
      throw new Error(`Cannot reach agent endpoint: ${err.message}`);
    }

    // ── Step 7: Handle 402 Payment Required ────────────────────────────────────
    if (initialResponse.status === 402) {
      log("Payment required", "Creating signed x402 payload");

      let paymentRequired: any;
      try {
        paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
          initialResponse.headers.get(name),
        );
        log(
          `payment required response headers:`,
          JSON.stringify(paymentRequired),
        );
      } catch (e: any) {
        const detail = await readErrorBody(initialResponse);
        throw new Error(
          `Failed to parse x402 payment terms from 402 response: ${e.message}` +
            (detail ? ` | ${detail}` : ""),
        );
      }

      // Create payment payload using x402 client (includes Soroban transaction building + signing)
      log(
        "Creating payment payload => ",
        `amount: ${paymentRequired.accepts[0].amount}; token asset: ${paymentRequired.accepts[0].asset}; payTo: ${paymentRequired.accepts[0].payTo}`,
      );
      let paymentPayload;
      try {
        paymentPayload =
          await x402ClientInstance.createPaymentPayload(paymentRequired);
        log(`Payment payload created: ${JSON.stringify(paymentPayload)}`);
      } catch (e: any) {
        throw new Error(
          addSimulationHint(e.message || String(e), paymentAsset),
        );
      }
      log("Payment payload created successfully", "scheme: exact");

      // Build and sign Soroban transaction
      const passphrase = getNetworkPassphrase(stellarNetwork);
      const tx = new Transaction(
        paymentPayload.payload.transaction as string,
        passphrase,
      );

      const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
      // Configure fee to 1 stroop, prevents testnet facilitator limit issue and lets us handle "fee too low" errors more gracefully
      if (sorobanData) {
        const ref = Date.now().toString(36);
        paymentPayload = {
          ...paymentPayload,
          payload: {
            ...paymentPayload.payload,
            transaction: TransactionBuilder.cloneFrom(tx, {
              fee: tx.fee,
              sorobanData,
              networkPassphrase: passphrase,
              memo: Memo.text(`x402:p:v1:${ref}`),
            })
              .build()
              .toXDR(),
          },
        };
      }

      const paymentHeaders =
        httpClient.encodePaymentSignatureHeader(paymentPayload);
      log("Payment signed", "Sending with Authorization header");

      log(`Payment headers:`, JSON.stringify(paymentHeaders));

      // ── Step 8: Retry with signed payment ──────────────────────────────────
      const paidResponse = await fetch(meta.endpoint, {
        method: "POST",
        headers: { ...paymentHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ task: receivedTask }),
      });

      log(JSON.stringify(paidResponse, null, 2));

      const text = await paidResponse.text();
      log(`Paid response text: ${text}`);

      log(`Payment headers: ${JSON.stringify(paidResponse.headers)}`);
      const paymentSettleResponse = httpClient.getPaymentSettleResponse(
        (name) => paidResponse.headers.get(name),
      );

      if (paymentSettleResponse) {
        log(
          "Payment settled",
          `txHash: ${paymentSettleResponse.transaction?.slice(0, 20)}...`,
        );
      }

      if (!paidResponse.ok) {
        const detail = await readErrorBody(paidResponse);
        throw new Error(
          `Agent execution failed: ${paidResponse.status} ${paidResponse.statusText}` +
            (detail ? ` | ${detail}` : ""),
        );
      }

      const result = await paidResponse.json();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      log("Response received", `${elapsed}s`);

      const answer =
        typeof result.result === "string"
          ? result.result
          : JSON.stringify(result.result);

      return {
        success: true,
        result: answer,
        txHash: paymentSettleResponse?.transaction,
        stepsLog,
      };
    } else if (initialResponse.ok) {
      // No payment required
      const result = await initialResponse.json();
      log("Response received", "no payment required");
      return {
        success: true,
        result: result.result || JSON.stringify(result),
        stepsLog,
      };
    } else {
      const detail = await readErrorBody(initialResponse);
      throw new Error(
        `Agent endpoint error: ${initialResponse.status} ${initialResponse.statusText}` +
          (detail ? ` | ${detail}` : ""),
      );
    }
  } catch (err: any) {
    const msg = err.message || String(err);
    log("Error", msg);
    return {
      success: false,
      error: msg,
      stepsLog,
    };
  }
}
