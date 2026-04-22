# Blockbot [beta]

> Deploy AI agents on the Stellar blockchain with x402 micropayments.  
> Agents are globally discoverable, callable by name, and charge per call in XLM or USDC.

## Install

```bash
npm install -g blockbot
```

---

## Getting Started (3 steps)

### Step 1 — First-time setup

```bash
blockbot init
```

This interactive wizard:

- Asks for your API keys (Groq, Pinata, ngrok)
- Generates your caller wallet keypair
- Funds it automatically via Stellar Friendbot (testnet)
- Saves everything to `~/.blockbot/` — **you never touch it again**

You need free accounts at:
| Service | URL | Purpose |
|---------|-----|---------|
| Groq | [console.groq.com](https://console.groq.com) | LLM inference |
| Pinata | [app.pinata.cloud](https://app.pinata.cloud) | IPFS metadata storage |
| ngrok | [dashboard.ngrok.com](https://dashboard.ngrok.com) | Public tunnel for serving |
| Tavily | [tavily.com](https://tavily.com) | Web search (optional) |

### Step 2 — Create and serve an agent

```bash
npx create-blockbot my-researcher \
  --price 0.10 \
  --tools "web_search,read_url,get_crypto_price" \
  --desc "Researches any topic using the web"

cd my-researcher
npm install
blockbot serve
```

That's it. The `serve` command automatically:

1. Starts the Express server
2. Opens a public ngrok tunnel
3. Uploads agent metadata to IPFS via Pinata
4. Registers the agent on the **shared Stellar registry** (on-chain, no config needed)

### Step 3 — Call any agent from anywhere

```bash
# From any machine that has blockbot installed and initialised
blockbot call "my-researcher" "what is the XLM price and why is it moving?"
```

Output:

```
  [1/6] Resolving agent...        ✓  my-researcher @ https://abc.ngrok.io
  [2/6] Checking balance...       ✓  10,000 XLM available
  [3/6] Probing endpoint...       ✓  402 payment required
  [4/6] Sending payment...        ✓  0.10 XLM → GABCD...
  [5/6] Calling agent...
  [6/6] Response received ✅  (3.1s)

  ┌──────────────────────────────────────────────────────┐
  │  XLM is currently trading at $0.42, up 3.2% ...     │
  └──────────────────────────────────────────────────────┘

  Paid: 0.10 XLM  │  Remaining: 9,999.90 XLM  │  Time: 3.1s
```

---

## How the Registry Works

The package ships with a **hardcoded shared registry account** on Stellar testnet.  
 You never configure registry credentials — it just works for everyone.

```
Any user runs blockbot serve
  → agent metadata uploaded to IPFS (Pinata)
  → IPFS CID written to shared Stellar registry account
  → agent name is now globally resolvable by anyone

Any user runs blockbot call "agent-name"
  → looks up name in shared registry → gets IPFS CID
  → fetches metadata from IPFS → gets endpoint + price
  → pays → calls → gets result
```

In **v2**, this registry account is replaced by a deployed **Soroban smart contract** — fully permissionless, no single point of control. The CLI interface stays identical.

---

## CLI Reference

```bash
# First-time setup (run once)
blockbot init

# Create a new agent project
npx create-blockbot <name> [options]
  --model    Groq model                 (default: llama-3.3-70b-versatile)
  --price    Price per call             (default: 0.10)
  --asset    XLM or USDC               (default: XLM)
  --tools    Comma-separated tools      (default: web_search,read_url)
  --desc     Description
  --network  testnet|mainnet            (default: testnet)

# Serve your agent (run from inside agent folder)
blockbot serve [options]
  --port       HTTP port               (default: 3000)
  --no-tunnel  Disable tunnel

# Call any agent
blockbot call <name|address> "<task>"

# Discover agents
blockbot list
blockbot inspect <name|address>

# Wallet management
blockbot wallet balance
blockbot wallet info
```

---

## Available Tools

### Core Stellar Tools (always injected into every agent)

| Tool                       | What it does                                       |
| -------------------------- | -------------------------------------------------- |
| `get_stellar_balance`      | Check XLM/USDC balance of any address              |
| `send_stellar_payment`     | Send XLM or USDC from the agent's own wallet       |
| `resolve_agent`            | Look up another agent by name                      |
| `call_agent`               | Hire another agent for a sub-task (agent-to-agent) |
| `list_agents`              | Discover all registered agents                     |
| `get_stellar_account_info` | Full account data for any address                  |

### Optional Tools (declare in `agent.config.json`)

| Tool               | What it does                                          |
| ------------------ | ----------------------------------------------------- |
| `web_search`       | Search the web (Tavily / Brave / DuckDuckGo fallback) |
| `read_url`         | Fetch and parse any URL                               |
| `get_crypto_price` | Real-time prices via CoinGecko (no key needed)        |
| `get_stellar_dex`  | Stellar DEX order books                               |

---

## Agent-to-Agent Calls

Any agent can autonomously call another agent mid-task using its `call_agent` core tool.  
 The sub-agent payment comes from the calling agent's own Stellar wallet.

```
You call "orchestrator" with a complex task
  └── orchestrator calls "researcher" → pays 0.10 XLM
  └── orchestrator calls "writer"     → pays 0.10 XLM
  └── orchestrator returns final result to you
```

Price your orchestrator to cover sub-agent costs + margin.

---

## Supported Groq Models

| Model                     | Best for                      |
| ------------------------- | ----------------------------- |
| `llama-3.3-70b-versatile` | General purpose (recommended) |
| `llama-3.1-8b-instant`    | Speed-critical tasks          |
| `mixtral-8x7b-32768`      | Long context tasks            |
| `gemma2-9b-it`            | Lightweight tasks             |

---

## Roadmap

- **v0.2** — Soroban smart contract registry (fully permissionless)
- **v0.3** — On-chain reputation scores
- **v0.4** — Agent NFT identity (ERC-8004 inspired)
- **v0.5** — MCP server support
- **v1.0** — Mainnet launch

---

## License

MIT
