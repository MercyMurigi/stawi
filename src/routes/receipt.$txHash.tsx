import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Loader2, Printer, ShieldCheck } from "lucide-react";
import { HashText, SimBadge, VerifyFarmerDialog, VerifyResult } from "@/components/sim/SimUi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { canonicalJson, fmtKes, useSim, verifyRecord } from "@/lib/sim/store";
import { sha256Hex } from "@/lib/merkle";
import { useEffect } from "react";

export const Route = createFileRoute("/receipt/$txHash")({
  head: () => ({
    meta: [
      { title: "Payout receipt — Stawi" },
      { name: "description", content: "Verify a Stawi farmer payout record against its anchored manifest hash and Merkle root." },
      { property: "og:title", content: "Payout receipt — Stawi" },
      { property: "og:description", content: "Independently verify a Stawi payout record." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Receipt,
});

function Receipt() {
  const { txHash } = Route.useParams();
  const { sim, ready } = useSim();
  const [result, setResult] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [farmer, setFarmer] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const rec = sim.records.find((r) => r.tx === txHash);

  useEffect(() => {
    void Promise.all(sim.farmers.map(async (f) => [await sha256Hex(f.id), f.id] as const)).then((p) => setHashes(Object.fromEntries(p)));
  }, [sim.farmers]);
  useEffect(() => setResult(null), [rec?.tamper]);

  if (!ready) return <main className="mx-auto max-w-3xl px-4 py-10"><Skeleton className="h-96 w-full rounded-2xl" /></main>;
  if (!rec) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-display text-3xl">Record not found</h1>
        <p className="mt-2 text-muted-foreground">This simulated record isn't stored on this device. Simulated records live in the browser that created them.</p>
        <Button asChild className="mt-6"><Link to="/">Back to Stawi</Link></Button>
      </main>
    );
  }
  const m = rec.manifest;
  const rows: [string, React.ReactNode][] = [
    ["Status", <span className="font-medium text-lime">Finalized</span>],
    ["Tx signature", <HashText value={rec.tx} head={10} tail={10} />],
    ["Slot", rec.slot.toLocaleString()],
    ["Block time", formatDateTime(rec.block_time)],
    ["Manifest hash (SHA-256)", <HashText value={rec.manifest_hash} head={10} tail={10} />],
    ["Merkle root", <HashText value={rec.merkle_root} head={10} tail={10} />],
    ["Memo", <span className="font-mono text-xs">{rec.memo}</span>],
    ["Batch", <span className="font-mono text-xs">{m.batch_id}</span>],
    ["Invoice", m.invoice_reference],
    ["Lender repayment", m.lender_repayment_kes_cents ? fmtKes(m.lender_repayment_kes_cents) : "None"],
    ["Fees", fmtKes(m.fees_kes_cents)],
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 print:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-display text-2xl">Stawi</Link>
        <SimBadge />
      </div>
      <h1 className="text-display mt-6 text-3xl">Payout receipt</h1>
      <p className="mt-1 text-sm text-muted-foreground">Kiambu Coffee Growers · {m.kind === "early_payout" ? "early payout from invoice advance" : "settlement waterfall"} · Solana (simulated)</p>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="tabular">{v}</dd></div>)}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2 print:hidden">
          <Button disabled={busy} onClick={async () => { setBusy(true); setResult((await verifyRecord(rec)).ok); setBusy(false); }}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Verify
          </Button>
          <Button variant="outline" onClick={() => {
            const blob = new Blob([JSON.stringify({ ...rec, manifest_canonical: canonicalJson(m) }, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `stawi-receipt-${rec.tx.slice(0, 12)}.json`; a.click();
          }}><Download className="size-4" /> JSON</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="size-4" /> Print / PDF</Button>
        </div>
        <div className="mt-4"><VerifyResult result={result} /></div>
      </section>

      <section className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Farmer</th><th className="px-3 py-2">ID hash</th><th className="px-3 py-2 text-right">Share</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 print:hidden" /></tr>
          </thead>
          <tbody>
            {m.allocations.map((a, i) => {
              const fid = hashes[a.farmer_id_hash];
              return (
                <tr key={a.farmer_id_hash} className={`border-t border-border ${rec.tamper?.index === i ? "bg-destructive/10" : ""}`}>
                  <td className="px-3 py-2">{sim.farmers.find((f) => f.id === fid)?.name ?? "—"}</td>
                  <td className="px-3 py-2"><HashText value={a.farmer_id_hash} /></td>
                  <td className="px-3 py-2 text-right tabular">{a.share_pct}%</td>
                  <td className="px-3 py-2 text-right tabular">{fmtKes(a.amount_kes_cents)}</td>
                  <td className="px-3 py-2 text-right print:hidden">{fid && <Button size="sm" variant="ghost" onClick={() => setFarmer(fid)}>Verify my payout</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <VerifyFarmerDialog record={rec} farmerId={farmer} open={Boolean(farmer)} onOpenChange={(o) => !o && setFarmer(null)} />
    </main>
  );
}
