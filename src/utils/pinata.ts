import { PinataSDK } from "pinata"

// ─── Pinata / IPFS Utilities ───────────────────────────────────────────────────

let _pinata: PinataSDK | null = null

function getPinata(): PinataSDK {
  if (!_pinata) {
    const jwt     = process.env.PINATA_JWT
    const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud"
    if (!jwt) throw new Error("PINATA_JWT not set in environment")
    _pinata = new PinataSDK({ pinataJwt: jwt, pinataGateway: gateway })
  }
  return _pinata
}

export async function uploadMetadata(metadata: object): Promise<string> {
  const pinata = getPinata()
  const blob   = new Blob([JSON.stringify(metadata, null, 2)], {
    type: "application/json",
  })
  const file   = new File([blob], "agent-metadata.json", { type: "application/json" })
  const result = await pinata.upload.file(file)
  return result.cid
}

export async function fetchMetadata<T = unknown>(cid: string): Promise<T> {
  const pinata  = getPinata()
  const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud"
  const url     = `https://${gateway}/ipfs/${cid}`
  const res     = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch IPFS metadata: ${res.statusText}`)
  return res.json() as Promise<T>
}

export function buildGatewayUrl(cid: string): string {
  const gateway = process.env.PINATA_GATEWAY || "gateway.pinata.cloud"
  return `https://${gateway}/ipfs/${cid}`
}
