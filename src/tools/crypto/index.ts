import { DynamicStructuredTool } from "@langchain/core/tools"
import { z }                     from "zod"

// ─── Crypto Tools ─────────────────────────────────────────────────────────────

export function buildCryptoTools() {

  const getCryptoPrice = new DynamicStructuredTool({
    name:        "get_crypto_price",
    description: "Get real-time cryptocurrency price, market cap, and 24h change. Free, no API key required.",
    schema: z.object({
      symbol: z.string().describe("Coin symbol e.g. 'XLM', 'BTC', 'ETH', 'USDC'"),
    }),
    func: async ({ symbol }) => {
      try {
        const coinMap: Record<string, string> = {
          XLM:  "stellar",
          BTC:  "bitcoin",
          ETH:  "ethereum",
          USDC: "usd-coin",
          SOL:  "solana",
          BNB:  "binancecoin",
          ADA:  "cardano",
        }
        const id  = coinMap[symbol.toUpperCase()] || symbol.toLowerCase()
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
        const res = await fetch(url)
        const data: any = await res.json()

        if (!data[id]) return `No price data found for ${symbol}`

        const info = data[id]
        return JSON.stringify({
          symbol:        symbol.toUpperCase(),
          price_usd:     info.usd,
          change_24h:    `${info.usd_24h_change?.toFixed(2)}%`,
          market_cap:    `$${(info.usd_market_cap / 1e9).toFixed(2)}B`,
        })
      } catch (e: any) {
        return `Failed to get price: ${e.message}`
      }
    },
  })

  const getStellarDexOrders = new DynamicStructuredTool({
    name:        "get_stellar_dex",
    description: "Get Stellar DEX order book for a trading pair",
    schema: z.object({
      buying:  z.string().describe("Asset being bought e.g. 'XLM' or 'USDC'"),
      selling: z.string().describe("Asset being sold e.g. 'XLM' or 'USDC'"),
    }),
    func: async ({ buying, selling }) => {
      try {
        const network  = (process.env.STELLAR_NETWORK || "testnet") as "testnet" | "mainnet"
        const baseUrl  = network === "testnet"
          ? "https://horizon-testnet.stellar.org"
          : "https://horizon.stellar.org"

        const buyAsset  = buying  === "XLM" ? "native" : `${buying}:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
        const sellAsset = selling === "XLM" ? "native" : `${selling}:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

        const [buyCode, buyIssuer]   = buyAsset.split(":")
        const [sellCode, sellIssuer] = sellAsset.split(":")

        const params = new URLSearchParams({
          buying_asset_type:   buyCode   === "native" ? "native" : "credit_alphanum4",
          selling_asset_type:  sellCode  === "native" ? "native" : "credit_alphanum4",
          ...(buyCode   !== "native" && { buying_asset_code:   buyCode,  buying_asset_issuer:   buyIssuer }),
          ...(sellCode  !== "native" && { selling_asset_code:  sellCode, selling_asset_issuer:  sellIssuer }),
          limit: "5",
        })

        const res  = await fetch(`${baseUrl}/order_book?${params}`)
        const data: any = await res.json()

        return JSON.stringify({
          bids: data.bids?.slice(0, 3),
          asks: data.asks?.slice(0, 3),
        })
      } catch (e: any) {
        return `Failed to get DEX data: ${e.message}`
      }
    },
  })

  return [getCryptoPrice, getStellarDexOrders]
}
