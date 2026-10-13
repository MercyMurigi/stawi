/**
 * Chain adapter. Everything here is SIMULATED: no wallets, keys or RPC calls.
 * Swap `chain` for a Solana devnet implementation of ChainAdapter later.
 */
import { canonicalJson, sha256Hex } from "./merkle";

export type ChainTx = { signature: string; slot: number; block_time: string };
export type AnchorTx = ChainTx & { manifest_hash: string; memo: string };

export interface ChainAdapter {
  readonly network: string;
  submitSettlement(input: { token: string; amount_minor: number; from: string; to: string }): Promise<ChainTx>;
  recordPayout(manifest: unknown): Promise<AnchorTx>;
  verifyRecord(manifest: unknown, expectedHash: string): Promise<boolean>;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(len: number): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => B58[b % 58]).join("");
}

let slot = 318_400_000;
function nextTx(): ChainTx {
  slot += 2 + Math.floor(Math.random() * 40);
  return { signature: base58(88), slot, block_time: new Date().toISOString() };
}

export const simulatedChain: ChainAdapter = {
  network: "Solana (simulated)",
  async submitSettlement() {
    return nextTx();
  },
  async recordPayout(manifest) {
    const manifest_hash = await sha256Hex(canonicalJson(manifest));
    return { ...nextTx(), manifest_hash, memo: `stawi:payout:v1:${manifest_hash.slice(0, 16)}` };
  },
  async verifyRecord(manifest, expectedHash) {
    return (await sha256Hex(canonicalJson(manifest))) === expectedHash;
  },
};

export const chain: ChainAdapter = simulatedChain;
