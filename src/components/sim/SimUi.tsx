import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, FlaskConical, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leafHash, merkleProof, sha256Hex, verifyProof, type ProofStep } from "@/lib/merkle";
import {
  CONFIRMATIONS, STAGES, fmtKes, fmtUsdc, getSim, quote, runSettlement, type DisplayStatus, type PayoutRecord,
  type Settlement, type SimInvoice, type Token, type Waterfall, useSim,
} from "@/lib/sim/store";
import { cn } from "@/lib/utils";

export function HashText({ value, head = 6, tail = 6, className }: { value: string; head?: number; tail?: number; className?: string }) {
  const [done, setDone] = useState(false);
  const short = value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  return (
    <button
      type="button"
      title={value}
      aria-label={`Copy ${value}`}
      className={cn("inline-flex items-center gap-1.5 rounded-md font-mono text-xs tabular hover:text-foreground", className)}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setDone(true);
        toast.success("Copied");
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {short}
      {done ? <Check className="size-3 text-lime" /> : <Copy className="size-3 opacity-60" />}
    </button>
  );
}

export function SimBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-terracotta/40 bg-terracotta/10 px-2 py-0.5 text-[11px] font-medium text-terracotta", className)}>
      <FlaskConical className="size-3" /> Simulation mode
    </span>
  );
}

export function SimNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 flex gap-2 rounded-xl border border-terracotta/30 bg-terracotta/5 p-3 text-sm text-muted-foreground">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-terracotta" />
      <span>{children}</span>
    </p>
  );
}

const tone: Record<DisplayStatus, string> = {
  draft: "bg-secondary text-muted-foreground",
  issued: "bg-secondary text-foreground",
  financed: "bg-lime/15 text-lime",
  paid: "bg-sage/20 text-sage",
  repaid: "bg-sage/20 text-sage",
  overdue: "bg-destructive/15 text-destructive",
};
export function InvoiceStatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize", tone[status])}>{status}</span>;
}

export function RiskBadge({ risk }: { risk: "Low" | "Medium" | "High" }) {
  const t = risk === "Low" ? "bg-sage/20 text-sage" : risk === "Medium" ? "bg-secondary text-foreground" : "bg-destructive/15 text-destructive";
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", t)}>{risk} risk</span>;
}

export function SettlementStepper({ s }: { s: Settlement }) {
  const anchored = Boolean(s.record_tx);
  const steps = [...STAGES, "Paid to farmers (M-Pesa, simulated)", "Anchor payout record onchain"];
  const at = s.stage < 4 ? s.stage : anchored ? 7 : 5;
  return (
    <ol className="space-y-2">
      {steps.map((label, i) => {
        const done = i < at;
        const active = i === at;
        return (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-[10px]", done ? "border-lime bg-lime text-primary-foreground" : active ? "border-lime text-lime" : "border-border text-muted-foreground")}>
              {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
            </span>
            <span className={cn(done || active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i === 1 && (s.stage >= 1) && <span className="ml-auto font-mono text-xs tabular text-muted-foreground">{s.confirmations}/{CONFIRMATIONS}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Breakdown({ s }: { s: Pick<Settlement, "amount_cents" | "token" | "rate" | "gross_kes_cents" | "conversion_fee_kes_cents" | "network_fee_kes_cents" | "kes_cents"> }) {
  const rows: [string, string][] = [
    ["Received", fmtUsdc(s.amount_cents, s.token)],
    [`Rate`, `${s.rate.toFixed(2)} KES per ${s.token}`],
    ["Gross in KES", fmtKes(s.gross_kes_cents)],
    ["Conversion fee (0.5%)", `− ${fmtKes(s.conversion_fee_kes_cents)}`],
    ["Network fee", `− ${fmtKes(s.network_fee_kes_cents)}`],
  ];
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="tabular">{v}</dd></div>
      ))}
      <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium"><dt>KES credited to pool</dt><dd className="tabular text-lime">{fmtKes(s.kes_cents)}</dd></div>
    </dl>
  );
}

export function WaterfallChart({ w }: { w: Waterfall }) {
  const { sim } = useSim();
  const total = w.lender_kes_cents + w.fees_kes_cents + w.farmers_kes_cents || 1;
  const segs = [
    { label: "1. Lender repayment", v: w.lender_kes_cents, c: "bg-terracotta" },
    { label: "2. Platform & network fees", v: w.fees_kes_cents, c: "bg-muted-foreground" },
    { label: "3. Farmers", v: w.farmers_kes_cents, c: "bg-lime" },
  ];
  return (
    <div className="space-y-4">
      <div className="flex h-4 overflow-hidden rounded-full bg-secondary">
        {segs.map((s) => s.v > 0 && <div key={s.label} className={s.c} style={{ width: `${(s.v / total) * 100}%` }} title={`${s.label}: ${fmtKes(s.v)}`} />)}
      </div>
      <ul className="space-y-1 text-sm">
        {segs.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", s.c)} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto tabular">{s.v === 0 && s.label.startsWith("1") ? "Skipped" : fmtKes(s.v)}</span>
          </li>
        ))}
      </ul>
      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm">Farmer allocations ({w.lines.length})</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {w.lines.map((l) => (
                <tr key={l.farmer_id} className="border-t border-border">
                  <td className="px-3 py-1.5">{sim.farmers.find((f) => f.id === l.farmer_id)?.name ?? l.farmer_id}</td>
                  <td className="px-3 py-1.5 text-right tabular text-muted-foreground">{l.share}%</td>
                  <td className="px-3 py-1.5 text-right tabular">{fmtKes(l.amount_kes_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function SimulatePaymentDialog({ invoice, open, onOpenChange }: { invoice: SimInvoice; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { sim } = useSim();
  const remaining = invoice.amount_cents - invoice.paid_cents;
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [token, setToken] = useState<Token>("USDC");
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => { if (open) { setAmount((remaining / 100).toFixed(2)); setRunId(null); } }, [open, remaining]);
  const cents = Math.round(Number(amount) * 100) || 0;
  const live = runId ? sim.settlements.find((s) => s.id === runId) : null;
  const preview = quote(cents, sim.rate);

  const start = () => {
    if (cents <= 0) { toast.error("Enter an amount above zero"); return; }
    const before = new Set(getSim().settlements.map((s) => s.id));
    const p = runSettlement({ invoice_id: invoice.id, source: "buyer", token, amount_cents: cents });
    const watch = setInterval(() => {
      const created = getSim().settlements.find((s) => !before.has(s.id));
      if (created) { setRunId(created.id); clearInterval(watch); }
    }, 30);
    p.catch((e: Error) => { clearInterval(watch); toast.error(e.message); });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Simulate buyer payment · {invoice.reference}</DialogTitle>
          <DialogDescription>No real stablecoin moves. Network: Solana (simulated).</DialogDescription>
        </DialogHeader>
        {!live ? (
          <div className="space-y-4">
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div className="space-y-1.5"><Label htmlFor="sim-amt">Amount</Label><Input id="sim-amt" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Token</Label>
                <Select value={token} onValueChange={(v) => setToken(v as Token)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="USDC">USDC</SelectItem><SelectItem value="USDT">USDT</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-xl border border-border p-3"><Breakdown s={{ amount_cents: cents, token, rate: sim.rate, ...preview }} /></div>
            <Button className="h-11 w-full" onClick={start}>Send {fmtUsdc(cents, token)}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <SettlementStepper s={live} />
            <div className="text-xs text-muted-foreground">Tx <HashText value={live.signature} /></div>
            {live.stage >= 3 && <div className="rounded-xl border border-border p-3"><Breakdown s={live} /></div>}
            {live.waterfall && <WaterfallChart w={live.waterfall} />}
            {live.record_tx && (
              <Button asChild className="h-11 w-full"><a href={`/receipt/${live.record_tx}`}>Open verifiable receipt</a></Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function VerifyResult({ result }: { result: boolean | null }) {
  if (result === null) return null;
  return result ? (
    <p className="flex items-center gap-2 rounded-xl bg-sage/15 p-3 text-sm font-medium text-sage"><ShieldCheck className="size-4" /> Record matches</p>
  ) : (
    <p className="flex items-center gap-2 rounded-xl bg-destructive/15 p-3 text-sm font-medium text-destructive"><ShieldAlert className="size-4" /> Tampered: the data no longer matches the anchored hash</p>
  );
}

export function VerifyFarmerDialog({ record, farmerId, open, onOpenChange }: { record: PayoutRecord; farmerId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { sim } = useSim();
  const [out, setOut] = useState<{ index: number; leaf: string; proof: ProofStep[]; ok: boolean } | null | "missing">(null);
  const farmer = sim.farmers.find((f) => f.id === farmerId);
  useEffect(() => {
    if (!open || !farmerId) return;
    setOut(null);
    void (async () => {
      const h = await sha256Hex(farmerId);
      const index = record.manifest.allocations.findIndex((a) => a.farmer_id_hash === h);
      if (index < 0) { setOut("missing"); return; }
      const leaves = await Promise.all(record.manifest.allocations.map(leafHash));
      const proof = await merkleProof(leaves, index);
      setOut({ index, leaf: leaves[index]!, proof, ok: await verifyProof(leaves[index]!, proof, record.merkle_root) });
    })();
  }, [open, farmerId, record]);
  const alloc = out && out !== "missing" ? record.manifest.allocations[out.index] : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Verify my payout</DialogTitle>
          <DialogDescription>{farmer?.name ?? "Farmer"} · checks this allocation against the anchored Merkle root.</DialogDescription>
        </DialogHeader>
        {out === null ? <Loader2 className="mx-auto size-5 animate-spin" /> : out === "missing" ? (
          <p className="text-sm text-muted-foreground">This farmer isn't in this payout batch.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="tabular">{fmtKes(alloc!.amount_kes_cents)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Share</span><span className="tabular">{alloc!.share_pct}%</span></div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Leaf</span><HashText value={out.leaf} /></div>
            <div>
              <p className="mb-1 text-muted-foreground">Proof path ({out.proof.length} steps)</p>
              <ol className="space-y-1">
                {out.proof.map((p, i) => <li key={i} className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{i + 1}. sibling on {p.position}</span><HashText value={p.sibling} /></li>)}
              </ol>
            </div>
            <div className="flex justify-between gap-2"><span className="text-muted-foreground">Root</span><HashText value={record.merkle_root} /></div>
            {out.ok ? (
              <p className="flex items-center gap-2 rounded-xl bg-sage/15 p-3 font-medium text-sage"><CheckCircle2 className="size-4" /> Your payout is in the anchored record</p>
            ) : (
              <p className="flex items-center gap-2 rounded-xl bg-destructive/15 p-3 font-medium text-destructive"><ShieldAlert className="size-4" /> Proof fails: this allocation was changed</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
