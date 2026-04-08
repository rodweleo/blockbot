import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { resolveAgent } from "./registry.js";
import { getAccountBalances } from "../utils/stellar.js";
import type { CallAgentOptions, CallAgentResult } from "./types.js";

// ─── callAgent (x402-Compliant) ────────────────────────────────────────────────
// The core function used by:
//   1. `blockbot call` CLI command
//   2. Agent servers calling other agents (agent-to-agent)
// Uses official x402 protocol with signed Soroban transactions.

export async function callAgent(
  opts: CallAgentOptions,
): Promise<CallAgentResult> {
  const { nameOrAddress, task, payerKeypair, onStep } = opts;
  const network = opts.network || "testnet";
  const stepsLog: string[] = [];
  const start = Date.now();

  function log(msg: string, detail?: string) {
    const line = detail ? `${msg}: ${detail}` : msg;
    stepsLog.push(line);
    onStep?.(line);
  }

  try {
    // ── Step 1: Resolve agent ──────────────────────────────────────────────────
    log("Resolving agent", nameOrAddress);
    const meta = await resolveAgent(nameOrAddress, network);
    log("Agent found", `${meta.name} @ ${meta.endpoint}`);
    log("Price", `$${meta.price} ${meta.asset}`);

    // ── Step 2: Check caller balance ───────────────────────────────────────────
    const { Keypair } = await import("@stellar/stellar-sdk");
    const callerKeypair = Keypair.fromSecret(payerKeypair);
    const callerAddress = callerKeypair.publicKey();

    log("Checking caller balance", callerAddress.slice(0, 20) + "...");
    const balances = await getAccountBalances(callerAddress, network);
    const relevant = balances.find((b) => b.asset === meta.asset);
    const balance = parseFloat(relevant?.balance || "0");
    const price = parseFloat(meta.price);

    if (balance < price) {
      throw new Error(
        `Insufficient ${meta.asset} balance. Have: ${balance}, Need: $${price}`,
      );
    }
    log("Balance sufficient", `${balance} ${meta.asset}`);

    // ── Step 3: Set up x402 client ─────────────────────────────────────────────
    const stellarNetwork =
      network === "testnet" ? "stellar:testnet" : "stellar:public";
    const sorobanRpcUrl =
      network === "testnet"
        ? "https://soroban-testnet.stellar.org"
        : "https://soroban.stellar.org";

    // Create x402 client with Stellar signer
    const signer = createEd25519Signer(payerKeypair, stellarNetwork);
    const rpcConfig = sorobanRpcUrl ? { url: sorobanRpcUrl } : undefined;

    const x402ClientInstance = new x402Client().register(
      "stellar:*",
      new ExactStellarScheme(signer, rpcConfig),
    );

    const httpClient = new x402HTTPClient(x402ClientInstance);
    log("x402 client initialized", `${stellarNetwork}`);

    // ── Step 4: Probe endpoint for 402 response ────────────────────────────────
    log("Probing agent endpoint for payment terms");

    let initialResponse: Response;
    try {
      initialResponse = await fetch(meta.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
    } catch (err: any) {
      throw new Error(`Cannot reach agent endpoint: ${err.message}`);
    }

    // ── Step 5: Handle 402 Payment Required ────────────────────────────────────
    if (initialResponse.status === 402) {
      log("Payment required", "Creating signed x402 payload");

      // Extract payment requirements from 402 response
      const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
        initialResponse.headers.get(name),
      );

      // Create signed payment payload
      let paymentPayload =
        await x402ClientInstance.createPaymentPayload(paymentRequired);
      log("Payment payload created", `scheme: exact`);

      // Build Soroban transaction
      const networkPassphrase = getNetworkPassphrase(stellarNetwork);
      const tx = new Transaction(
        paymentPayload.payload.transaction as string,
        networkPassphrase,
      );

      // Extract and update Soroban data
      const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
      if (sorobanData) {
        paymentPayload = {
          ...paymentPayload,
          payload: {
            ...paymentPayload.payload,
            transaction: TransactionBuilder.cloneFrom(tx, {
              fee: "1", // 1 stroop to avoid facilitator limits
              sorobanData,
              networkPassphrase,
            })
              .build()
              .toXDR(),
          },
        };
      }

      // Encode payment signature headers
      const paymentHeaders =
        httpClient.encodePaymentSignatureHeader(paymentPayload);
      log("Payment signed", "Sending with Authorization header");

      // ── Step 6: Retry with signed payment ──────────────────────────────────
      const paidResponse = await fetch(meta.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...paymentHeaders,
        },
        body: JSON.stringify({ task }),
      });

      // Verify settlement
      const paymentSettleResponse = httpClient.getPaymentSettleResponse(
        (name) => paidResponse.headers.get(name),
      );

      if (paymentSettleResponse) {
        log(
          "Payment settled transaction",
          JSON.stringify(paymentSettleResponse.transaction),
        );
        log(
          "Payment settled",
          `txHash: ${paymentSettleResponse.transaction?.slice(0, 20)}...`,
        );
      }

      if (!paidResponse.ok) {
        throw new Error(
          `Agent execution failed: ${paidResponse.status} ${paidResponse.statusText}`,
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
      // No payment required (unlikely, but handle it)
      const result = await initialResponse.json();
      log("Response received", "No payment required");
      return {
        success: true,
        result: result.result || JSON.stringify(result),
        stepsLog,
      };
    } else {
      throw new Error(
        `Agent endpoint error: ${initialResponse.status} ${initialResponse.statusText}`,
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
