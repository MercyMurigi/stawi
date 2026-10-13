/** SHA-256, canonical JSON and Merkle helpers. Browser Web Crypto only. */

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** JSON with object keys sorted recursively, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const leafHash = (leaf: unknown) => sha256Hex(canonicalJson(leaf));

export type ProofStep = { sibling: string; position: "left" | "right" };

async function levels(leaves: string[]): Promise<string[][]> {
  if (leaves.length === 0) return [[await sha256Hex("")]];
  const out = [leaves];
  let cur = leaves;
  while (cur.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      const l = cur[i]!;
      const r = cur[i + 1] ?? l;
      next.push(await sha256Hex(l + r));
    }
    out.push(next);
    cur = next;
  }
  return out;
}

export async function merkleRoot(leaves: string[]): Promise<string> {
  const lv = await levels(leaves);
  return lv[lv.length - 1]![0]!;
}

export async function merkleProof(leaves: string[], index: number): Promise<ProofStep[]> {
  const lv = await levels(leaves);
  const proof: ProofStep[] = [];
  let i = index;
  for (let d = 0; d < lv.length - 1; d++) {
    const row = lv[d]!;
    const isRight = i % 2 === 1;
    const sib = isRight ? row[i - 1]! : (row[i + 1] ?? row[i]!);
    proof.push({ sibling: sib, position: isRight ? "left" : "right" });
    i = Math.floor(i / 2);
  }
  return proof;
}

export async function verifyProof(leaf: string, proof: ProofStep[], root: string): Promise<boolean> {
  let h = leaf;
  for (const s of proof) h = await sha256Hex(s.position === "left" ? s.sibling + h : h + s.sibling);
  return h === root;
}
