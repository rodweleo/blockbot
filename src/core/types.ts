export interface AgentConfig {
  name: string
  version: string
  description: string
  model: string
  price: string
  asset: "XLM" | "USDC"
  tools: string[]
  system_prompt: string
  max_tool_iterations: number
  owner?: string
  endpoint?: string
  ipfs_cid?: string
  registered_at?: string
}

export interface AgentMetadata extends AgentConfig {
  owner: string
  endpoint: string
  ipfs_cid: string
  registered_at: string
}

export interface WalletConfig {
  publicKey: string
  secretKey: string
  network: "testnet" | "mainnet"
}

export interface CallAgentOptions {
  nameOrAddress: string
  task: string
  payerKeypair: string
  onStep?: (step: string, detail?: string) => void
  network?: "testnet" | "mainnet"
}

export interface CallAgentResult {
  success: boolean
  result?: string
  error?: string
  txHash?: string
  stepsLog: string[]
}

export const STELLAR_TESTNET_HORIZON = "https://horizon-testnet.stellar.org"
export const STELLAR_MAINNET_HORIZON = "https://horizon.stellar.org"
