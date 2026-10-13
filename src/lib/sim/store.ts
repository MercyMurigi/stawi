/**
 * Simulation engine for stablecoin settlement, invoice financing, waterfall payouts
 * and onchain payout records. Fully local (browser storage). Never touches live data.
 * Money: USDC in integer cents, KES in integer cents.
 */
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { base58, chain } from "@/lib/chain";
import { canonicalJson, leafHash, merkleRoot, sha256Hex } from "@/lib/merkle";

export type Token = "USDC" | "USDT";
export type Speed = "slow" | "normal" | "instant";
export type SimFarmer = { id: string; name: string; share: number };
export type SimBuyer = { id: string; name: string; on_time: number; late: number };
export type Advance = { principal_cents: number; fee_cents: number; repaid_cents: number; at: string; repaid_at: string | null; settlement_id: string | null };
export type SimInvoice = {
  id: string; reference: string; buyer_id: string; amount_cents: number; tenor: 30 | 60 | 90;
  created_at: string; issued_at: string | null; due_at: string | null; paid_cents: number;
  advance: Advance | null; settlement_ids: string[];
};
export type DisplayStatus = "draft" | "issued" | "financed" | "paid" | "overdue" | "repaid";
export type WaterfallLine = { farmer_id: string; share: number; amount_kes_cents: number };
export type Waterfall = { pool_kes_cents: number; lender_kes_cents: number; fees_kes_cents: number; farmers_kes_cents: number; lines: WaterfallLine[] };
export type Settlement = {
  id: string; invoice_id: string; source: "buyer" | "liquidity"; token: Token; amount_cents: number; rate: number;
  gross_kes_cents: number; conversion_fee_kes_cents: number; network_fee_kes_cents: number; kes_cents: number;
  signature: string; slot: number; created_at: string; stage: number; confirmations: number;
  waterfall: Waterfall | null; record_tx: string | null; partial: boolean;
};
export type Allocation = { farmer_id_hash: string; amount_kes_cents: number; share_pct: number };
export type Manifest = {
  batch_id: string; coop_id: string; invoice_id: string; invoice_reference: string; timestamp: string; kind: "early_payout" | "settlement_waterfall";
  currency: "KES"; lender_repayment_kes_cents: number; fees_kes_cents: number; allocations: Allocation[];
};
export type PayoutRecord = {
  tx: string; slot: number; block_time: string; memo: string; settlement_id: string;
  manifest: Manifest; manifest_hash: string; merkle_root: string; tamper: { index: number; original: number } | null;
};
export type LogEntry = { at: string; text: string };
export type SimState = {
  version: 1; offset_days: number; rate: number; speed: Speed;
  coop: { id: string; name: string; address: string; liquidity_address: string };
  farmers: SimFarmer[]; buyers: SimBuyer[]; invoices: SimInvoice[]; settlements: Settlement[]; records: PayoutRecord[];
  log: LogEntry[]; demo_running: boolean;
};

export const ADVANCE_RATE = 0.8;
export const BASE_FEE_PCT = 2.5; // at 60 days
export const CONVERSION_FEE_PCT = 0.5;
export const NETWORK_FEE_KES_CENTS = 150; // KES 1.50
export const CONFIRMATIONS = 32;
export const FINANCING_LIMIT_CENTS = 100_000_00;
export const STAGES = ["Initiated", "Confirming", "Settled onchain", "Converted to KES", "Available in co-op pool"] as const;
const KEY = "stawi-sim-v1";
const DAY = 86_400_000;

// ---------- seed ----------
const NAMES = ["Wanjiku Mwangi", "Juma Omondi", "Kipchoge Cheruiyot", "Achieng Otieno", "Mutua Kioko", "Njeri Kamau", "Wafula Barasa", "Chebet Langat", "Kamau Njoroge", "Akinyi Odhiambo", "Mwende Musyoka", "Otieno Ochieng", "Wairimu Gitau", "Kiprono Rotich", "Nyambura Waweru", "Onyango Owino", "Muthoni Ndungu", "Kibet Korir", "Atieno Adhiambo", "Gachanja Mureithi", "Jepkosgei Bett", "Ndegwa Macharia", "Moraa Nyaboke", "Ruto Kiplagat"];
const SHARES = [8, 7, 6, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 2, 2];

export function feePct(tenor: 30 | 60 | 90) { return (BASE_FEE_PCT * tenor) / 60; }
export function advanceTerms(amount_cents: number, tenor: 30 | 60 | 90) {
  const principal_cents = Math.round(amount_cents * ADVANCE_RATE);
  const fee_cents = Math.round((principal_cents * feePct(tenor)) / 100);
  return { principal_cents, fee_cents };
}

function seed(): SimState {
  const now = Date.now();
  const iso = (d: number) => new Date(now + d * DAY).toISOString();
  const t = advanceTerms(24_000_00, 90);
  return {
    version: 1, offset_days: 0, rate: 129, speed: "normal",
    coop: { id: "coop_kcg", name: "Kiambu Coffee Growers", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", liquidity_address: "LiQPooL9vZ3mQ4rXg8WcN2hJ5kT7yB1aE6sD4fU2pVo" },
    farmers: NAMES.map((name, i) => ({ id: `kcg_f${String(i + 1).padStart(2, "0")}`, name, share: SHARES[i]! })),
    buyers: [
      { id: "b_nordic", name: "Nordic Roast AB", on_time: 6, late: 0 },
      { id: "b_pacific", name: "Pacific Bean Traders", on_time: 2, late: 2 },
    ],
    invoices: [
      { id: "sinv_101", reference: "KCG-101", buyer_id: "b_nordic", amount_cents: 12_000_00, tenor: 60, created_at: iso(-1), issued_at: null, due_at: null, paid_cents: 0, advance: null, settlement_ids: [] },
      { id: "sinv_102", reference: "KCG-102", buyer_id: "b_pacific", amount_cents: 18_500_00, tenor: 30, created_at: iso(-12), issued_at: iso(-12), due_at: iso(18), paid_cents: 0, advance: null, settlement_ids: [] },
      { id: "sinv_103", reference: "KCG-103", buyer_id: "b_nordic", amount_cents: 24_000_00, tenor: 90, created_at: iso(-20), issued_at: iso(-20), due_at: iso(70), paid_cents: 0, advance: { ...t, repaid_cents: 0, at: iso(-19), repaid_at: null, settlement_id: null }, settlement_ids: [] },
    ],
    settlements: [], records: [], log: [{ at: iso(0), text: "Simulation seeded: Kiambu Coffee Growers, 24 farmers, 3 invoices." }], demo_running: false,
  };
}

// ---------- store ----------
let state: SimState = seed();
let hydrated = false;
const subs = new Set<() => void>();
const serverSnap = state;

function emit() {
  if (typeof window !== "undefined") {
    try { localStorage.setItem(KEY, JSON.stringify({ ...state, demo_running: false })); } catch { /* quota */ }
  }
  subs.forEach((f) => f());
}
function set(fn: (s: SimState) => SimState) { state = fn(state); emit(); }
export const getSim = () => state;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...(JSON.parse(raw) as SimState), demo_running: false };
  } catch { /* ignore */ }
  // Seeded financed invoice gets its liquidity settlement on first load.
  const seeded = state.invoices.find((i) => i.advance && !i.advance.settlement_id && state.settlements.length === 0);
  emit();
  if (seeded) void runSettlement({ invoice_id: seeded.id, source: "liquidity", token: "USDC", amount_cents: seeded.advance!.principal_cents, quiet: true, speedOverride: "instant" });
}

export function useSim(): { sim: SimState; ready: boolean } {
  const sim = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => serverSnap);
  useEffect(() => hydrate(), []);
  return { sim, ready: hydrated };
}

// ---------- helpers ----------
export const simNow = (s = state) => Date.now() + s.offset_days * DAY;
const nowIso = () => new Date(simNow()).toISOString();
const uid = (p: string) => `${p}_${base58(10)}`;
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
export function log(text: string) { set((s) => ({ ...s, log: [{ at: nowIso(), text }, ...s.log].slice(0, 80) })); }

export function displayStatus(inv: SimInvoice, s = state): DisplayStatus {
  if (!inv.issued_at) return "draft";
  if (inv.paid_cents >= inv.amount_cents) return inv.advance ? "repaid" : "paid";
  if (inv.due_at && simNow(s) > Date.parse(inv.due_at)) return "overdue";
  if (inv.advance) return "financed";
  return "issued";
}
export const buyerOf = (inv: SimInvoice, s = state) => s.buyers.find((b) => b.id === inv.buyer_id)!;
export function riskOf(buyer: SimBuyer, s = state): "Low" | "Medium" | "High" {
  const total = buyer.on_time + buyer.late;
  const lateRatio = total ? buyer.late / total : 0.5;
  const track = s.records.length;
  if (lateRatio >= 0.4) return "High";
  if (lateRatio === 0 && (buyer.on_time >= 3 || track >= 2)) return "Low";
  return "Medium";
}

/** Largest-remainder split: lines sum exactly to total. */
export function allocate(total: number, farmers: SimFarmer[]): WaterfallLine[] {
  const sum = farmers.reduce((a, f) => a + f.share, 0) || 1;
  const raw = farmers.map((f) => (total * f.share) / sum);
  const base = raw.map(Math.floor);
  let rem = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const o of order) { if (rem <= 0) break; base[o.i]! += 1; rem -= 1; }
  return farmers.map((f, i) => ({ farmer_id: f.id, share: f.share, amount_kes_cents: base[i]! }));
}

export function quote(amount_cents: number, rate: number) {
  const gross = Math.round(amount_cents * rate);
  const conv = Math.round((gross * CONVERSION_FEE_PCT) / 100);
  const net = Math.max(0, gross - conv - NETWORK_FEE_KES_CENTS);
  return { gross_kes_cents: gross, conversion_fee_kes_cents: conv, network_fee_kes_cents: NETWORK_FEE_KES_CENTS, kes_cents: net };
}

export const outstandingCents = (a: Advance) => Math.max(0, a.principal_cents + a.fee_cents - a.repaid_cents);

// ---------- actions ----------
export function createInvoice(input: { buyer_id: string; amount_cents: number; tenor: 30 | 60 | 90 }): SimInvoice {
  const n = 101 + state.invoices.length;
  const inv: SimInvoice = { id: uid("sinv"), reference: `KCG-${n}`, ...input, created_at: nowIso(), issued_at: null, due_at: null, paid_cents: 0, advance: null, settlement_ids: [] };
  set((s) => ({ ...s, invoices: [inv, ...s.invoices] }));
  log(`Invoice ${inv.reference} drafted for ${buyerOf(inv).name}.`);
  return inv;
}
export function issueInvoice(id: string) {
  set((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, issued_at: nowIso(), due_at: new Date(simNow() + i.tenor * DAY).toISOString() } : i)) }));
  const inv = state.invoices.find((i) => i.id === id)!;
  log(`Invoice ${inv.reference} issued, due in ${inv.tenor} days.`);
}
export async function acceptAdvance(id: string) {
  const inv = state.invoices.find((i) => i.id === id);
  if (!inv || inv.advance || !inv.issued_at) throw new Error("This invoice can't be financed");
  const t = advanceTerms(inv.amount_cents, inv.tenor);
  set((s) => ({ ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, advance: { ...t, repaid_cents: 0, at: nowIso(), repaid_at: null, settlement_id: null } } : i)) }));
  log(`Advance accepted on ${inv.reference}: ${fmtUsdc(t.principal_cents)} from the liquidity pool.`);
  return runSettlement({ invoice_id: id, source: "liquidity", token: "USDC", amount_cents: t.principal_cents });
}
export function setRate(rate: number) { set((s) => ({ ...s, rate: Math.round(rate * 100) / 100 })); }
export function setSpeed(speed: Speed) { set((s) => ({ ...s, speed })); }
export function fastForward(days = 30) { set((s) => ({ ...s, offset_days: s.offset_days + days })); log(`Clock moved forward ${days} days.`); }
export function resetSim() { state = seed(); emit(); hydrated = true; toast.success("Simulation reset to the seeded state"); }

export function toggleTamper(tx?: string) {
  const rec = tx ? state.records.find((r) => r.tx === tx) : state.records[0];
  if (!rec) { toast.error("Anchor a payout record first"); return; }
  set((s) => ({
    ...s,
    records: s.records.map((r) => {
      if (r.tx !== rec.tx) return r;
      const allocations = r.manifest.allocations.map((a) => ({ ...a }));
      if (r.tamper) {
        allocations[r.tamper.index]!.amount_kes_cents = r.tamper.original;
        return { ...r, manifest: { ...r.manifest, allocations }, tamper: null };
      }
      const original = allocations[0]!.amount_kes_cents;
      allocations[0]!.amount_kes_cents = original + 1_000_00;
      return { ...r, manifest: { ...r.manifest, allocations }, tamper: { index: 0, original } };
    }),
  }));
  const now = state.records.find((r) => r.tx === rec.tx)!;
  log(now.tamper ? `Tampered with record ${rec.tx.slice(0, 8)}…: one allocation +KES 1,000.` : `Record ${rec.tx.slice(0, 8)}… restored.`);
}

export async function verifyRecord(r: PayoutRecord) {
  const hashOk = await chain.verifyRecord(r.manifest, r.manifest_hash);
  const root = await merkleRoot(await Promise.all(r.manifest.allocations.map(leafHash)));
  return { ok: hashOk && root === r.merkle_root, hashOk, rootOk: root === r.merkle_root };
}

function patchSettlement(id: string, p: Partial<Settlement>) {
  set((s) => ({ ...s, settlements: s.settlements.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

/** Runs a settlement through every stage, applies the waterfall and anchors the payout record. */
export async function runSettlement(input: { invoice_id: string; source: "buyer" | "liquidity"; token: Token; amount_cents: number; quiet?: boolean; speedOverride?: Speed }): Promise<Settlement> {
  const inv = state.invoices.find((i) => i.id === input.invoice_id);
  if (!inv) throw new Error("Invoice not found");
  if (input.amount_cents <= 0) throw new Error("Enter an amount above zero");
  const speed = input.speedOverride ?? state.speed;
  const [confMs, stageMs] = speed === "slow" ? [160, 900] : speed === "normal" ? [45, 400] : [0, 0];
  const rate = state.rate;
  const q = quote(input.amount_cents, rate);
  const from = input.source === "liquidity" ? state.coop.liquidity_address : base58(44);
  const tx = await chain.submitSettlement({ token: input.token, amount_minor: input.amount_cents, from, to: state.coop.address });
  const st: Settlement = {
    id: uid("set"), invoice_id: inv.id, source: input.source, token: input.token, amount_cents: input.amount_cents, rate, ...q,
    signature: tx.signature, slot: tx.slot, created_at: nowIso(), stage: 0, confirmations: 0, waterfall: null, record_tx: null,
    partial: input.source === "buyer" && inv.paid_cents + input.amount_cents < inv.amount_cents,
  };
  set((s) => ({
    ...s, settlements: [st, ...s.settlements],
    invoices: s.invoices.map((i) => (i.id === inv.id ? { ...i, settlement_ids: [st.id, ...i.settlement_ids], advance: input.source === "liquidity" && i.advance ? { ...i.advance, settlement_id: st.id } : i.advance } : i)),
  }));
  const say = (t: string) => { log(t); if (!input.quiet) toast(t); };
  say(`${input.source === "liquidity" ? "Liquidity pool" : buyerOf(inv).name} sent ${fmtUsdc(input.amount_cents, input.token)} for ${inv.reference}.`);

  await sleep(stageMs);
  patchSettlement(st.id, { stage: 1 });
  for (let c = 1; c <= CONFIRMATIONS; c++) {
    if (confMs) await sleep(confMs);
    if (confMs || c === CONFIRMATIONS) patchSettlement(st.id, { confirmations: c });
  }
  patchSettlement(st.id, { stage: 2 });
  say(`Settled onchain after ${CONFIRMATIONS} confirmations (slot ${tx.slot.toLocaleString()}).`);
  await sleep(stageMs);
  patchSettlement(st.id, { stage: 3 });
  say(`Converted at ${rate.toFixed(2)} KES per ${input.token}: ${fmtKes(q.kes_cents)} after fees.`);
  await sleep(stageMs);

  // Waterfall
  const cur = state.invoices.find((i) => i.id === inv.id)!;
  let lender = 0;
  let repaidUsdc = 0;
  if (input.source === "buyer" && cur.advance) {
    const owedKes = Math.round(outstandingCents(cur.advance) * rate);
    lender = Math.min(q.kes_cents, owedKes);
    repaidUsdc = lender === owedKes ? outstandingCents(cur.advance) : Math.floor(lender / rate);
  }
  const farmersTotal = q.kes_cents - lender;
  const waterfall: Waterfall = { pool_kes_cents: q.kes_cents, lender_kes_cents: lender, fees_kes_cents: q.conversion_fee_kes_cents + q.network_fee_kes_cents, farmers_kes_cents: farmersTotal, lines: allocate(farmersTotal, state.farmers) };
  const wasOverdue = displayStatus(cur) === "overdue";
  set((s) => ({
    ...s,
    invoices: s.invoices.map((i) => {
      if (i.id !== inv.id) return i;
      const paid = input.source === "buyer" ? i.paid_cents + input.amount_cents : i.paid_cents;
      const adv = i.advance ? { ...i.advance, repaid_cents: i.advance.repaid_cents + repaidUsdc } : null;
      if (adv && outstandingCents(adv) === 0 && !adv.repaid_at) adv.repaid_at = nowIso();
      return { ...i, paid_cents: paid, advance: adv };
    }),
    buyers: input.source === "buyer" && cur.paid_cents + input.amount_cents >= cur.amount_cents
      ? s.buyers.map((b) => (b.id === cur.buyer_id ? { ...b, on_time: b.on_time + (wasOverdue ? 0 : 1), late: b.late + (wasOverdue ? 1 : 0) } : b))
      : s.buyers,
  }));
  patchSettlement(st.id, { stage: 4, waterfall });
  if (lender) say(`Waterfall: ${fmtKes(lender)} repaid to the lender first.`);
  say(`${fmtKes(farmersTotal)} paid to ${state.farmers.length} farmers via M-Pesa (simulated).`);

  // Anchor record
  const allocations: Allocation[] = await Promise.all(
    waterfall.lines.map(async (l) => ({ farmer_id_hash: await sha256Hex(l.farmer_id), amount_kes_cents: l.amount_kes_cents, share_pct: l.share })),
  );
  const manifest: Manifest = {
    batch_id: uid("batch"), coop_id: state.coop.id, invoice_id: inv.id, invoice_reference: inv.reference, timestamp: nowIso(),
    kind: input.source === "liquidity" ? "early_payout" : "settlement_waterfall", currency: "KES",
    lender_repayment_kes_cents: lender, fees_kes_cents: waterfall.fees_kes_cents, allocations,
  };
  const anchor = await chain.recordPayout(manifest);
  const merkle_root = await merkleRoot(await Promise.all(allocations.map(leafHash)));
  const rec: PayoutRecord = { tx: anchor.signature, slot: anchor.slot, block_time: nowIso(), memo: anchor.memo, settlement_id: st.id, manifest, manifest_hash: anchor.manifest_hash, merkle_root, tamper: null };
  set((s) => ({ ...s, records: [rec, ...s.records] }));
  patchSettlement(st.id, { record_tx: rec.tx });
  say(`Payout record anchored onchain: ${rec.tx.slice(0, 10)}…`);
  return state.settlements.find((x) => x.id === st.id)!;
}

// ---------- presets & demo ----------
export type Preset = "happy" | "late" | "partial" | "fx" | "financed" | "tamper";
export const PRESETS: { id: Preset; label: string }[] = [
  { id: "happy", label: "Happy path" },
  { id: "late", label: "Buyer pays late (overdue)" },
  { id: "partial", label: "Partial payment" },
  { id: "fx", label: "FX drops 5%" },
  { id: "financed", label: "Financed invoice full cycle" },
  { id: "tamper", label: "Tamper demo" },
];

const firstOpen = (financed: boolean) => state.invoices.find((i) => i.issued_at && Boolean(i.advance) === financed && i.paid_cents < i.amount_cents);

export async function runPreset(p: Preset) {
  try {
    if (p === "fx") { setRate(state.rate * 0.95); log(`FX dropped 5%: now ${state.rate.toFixed(2)} KES per USDC.`); toast("USDC/KES rate down 5%"); return; }
    if (p === "late") { const inv = firstOpen(false); fastForward(45); if (inv) toast(`${inv.reference} is now overdue`); return; }
    if (p === "tamper") {
      if (!state.records.length) { const inv = firstOpen(false) ?? createIssued(); await runSettlement({ invoice_id: inv.id, source: "buyer", token: "USDC", amount_cents: inv.amount_cents - inv.paid_cents, speedOverride: "instant", quiet: true }); }
      toggleTamper(); return;
    }
    if (p === "partial") { const inv = firstOpen(false) ?? createIssued(); await runSettlement({ invoice_id: inv.id, source: "buyer", token: "USDC", amount_cents: Math.round((inv.amount_cents - inv.paid_cents) / 2) }); return; }
    if (p === "financed") { const inv = firstOpen(true); if (!inv) throw new Error("No open financed invoice. Reset or finance one first."); await runSettlement({ invoice_id: inv.id, source: "buyer", token: "USDC", amount_cents: inv.amount_cents - inv.paid_cents }); return; }
    const inv = firstOpen(false) ?? createIssued();
    await runSettlement({ invoice_id: inv.id, source: "buyer", token: "USDC", amount_cents: inv.amount_cents - inv.paid_cents });
  } catch (e) { toast.error((e as Error).message); }
}

function createIssued() {
  const inv = createInvoice({ buyer_id: state.buyers[0]!.id, amount_cents: 15_000_00, tenor: 60 });
  issueInvoice(inv.id);
  return state.invoices.find((i) => i.id === inv.id)!;
}

export async function runFullDemo(): Promise<string | null> {
  if (state.demo_running) return null;
  set((s) => ({ ...s, demo_running: true }));
  try {
    log("▶ Full demo: invoice → advance → stablecoin settlement → waterfall → onchain record.");
    const inv = createInvoice({ buyer_id: state.buyers[0]!.id, amount_cents: 20_000_00, tenor: 60 });
    await sleep(500);
    issueInvoice(inv.id);
    await sleep(500);
    await acceptAdvance(inv.id);
    log("Farmers were paid early from the advance, before the buyer paid.");
    await sleep(700);
    const st = await runSettlement({ invoice_id: inv.id, source: "buyer", token: "USDC", amount_cents: inv.amount_cents });
    log("✔ Demo finished. Open the receipt to verify the record.");
    toast.success("Demo complete. Receipt ready to verify.");
    return st.record_tx;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  } finally {
    set((s) => ({ ...s, demo_running: false }));
  }
}

// ---------- formatting ----------
export const fmtUsdc = (cents: number, token: string = "USDC") =>
  `${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${token}`;
export const fmtKes = (cents: number) =>
  `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export { canonicalJson };
