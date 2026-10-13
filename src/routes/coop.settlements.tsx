import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Coins } from "lucide-react";
import { EmptyState } from "@/components/stawi/EmptyState";
import { QrCode } from "@/components/stawi/QrCode";
import { Breakdown, HashText, SettlementStepper, SimNotice, SimulatePaymentDialog, WaterfallChart } from "@/components/sim/SimUi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { formatDateTime } from "@/lib/format";
import { STAGES, buyerOf, displayStatus, fmtKes, fmtUsdc, useSim, type SimInvoice } from "@/lib/sim/store";

export const Route = createFileRoute("/coop/settlements")({
  head: () => ({
    meta: [
      { title: "Stablecoin settlements — Stawi co-op" },
      { name: "description", content: "Simulated USDC/USDT buyer settlements converted to KES for the co-op payout pool." },
      { property: "og:title", content: "Stablecoin settlements — Stawi co-op" },
      { property: "og:description", content: "Simulated stablecoin settlement into the co-op pool." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settlements,
});

function Settlements() {
  const { sim, ready } = useSim();
  const [payFor, setPayFor] = useState<SimInvoice | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!ready) return <Skeleton className="h-96 w-full rounded-2xl" />;
  const open = sim.invoices.filter((i) => i.issued_at && i.paid_cents < i.amount_cents);
  const selected = sim.settlements.find((s) => s.id === openId) ?? sim.settlements[0];

  return (
    <div>
      <PageHeader title="Settlements" description="Buyers pay in stablecoin; it converts to KES and lands in the co-op pool." />
      <SimNotice>Blockchain and FX are simulated. No wallets, keys or real stablecoin are used. Addresses and signatures are generated for the demo.</SimNotice>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_260px]">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-medium">Receive stablecoin</h2>
          <p className="mt-1 text-sm text-muted-foreground">{sim.coop.name} settlement address · Solana (simulated)</p>
          <HashText value={sim.coop.address} head={10} tail={10} className="mt-2 text-sm" />
          <ul className="mt-4 divide-y divide-border">
            {open.length === 0 && <li className="py-3 text-sm text-muted-foreground">No issued invoices waiting for payment.</li>}
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium">{i.reference} · {buyerOf(i, sim).name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{displayStatus(i, sim)} · {fmtUsdc(i.amount_cents - i.paid_cents)} due</p>
                </div>
                <Button size="sm" onClick={() => setPayFor(i)}>Simulate buyer payment</Button>
              </li>
            ))}
          </ul>
        </section>
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-5">
          <QrCode value={`solana:${sim.coop.address}`} />
          <p className="text-xs text-muted-foreground">QR placeholder (simulated)</p>
        </div>
      </div>

      {selected && (
        <section className="mb-6 grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-3">
          <div><h3 className="mb-3 text-sm font-medium">Status</h3><SettlementStepper s={selected} /></div>
          <div><h3 className="mb-3 text-sm font-medium">Before / after</h3><Breakdown s={selected} /></div>
          <div><h3 className="mb-3 text-sm font-medium">Waterfall</h3>{selected.waterfall ? <WaterfallChart w={selected.waterfall} /> : <p className="text-sm text-muted-foreground">Runs once the KES is in the pool.</p>}</div>
        </section>
      )}

      <h2 className="mb-3 font-medium">Settlement history</h2>
      {sim.settlements.length === 0 ? (
        <EmptyState icon={Coins} title="No settlements yet" description="Simulate a buyer payment on an issued invoice." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase text-muted-foreground">
              <tr>{["Date", "Invoice", "From", "Status", "Tx", "Amount", "KES received", "Rate"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {sim.settlements.map((s) => (
                <tr key={s.id} onClick={() => setOpenId(s.id)} className={`cursor-pointer border-t border-border hover:bg-secondary/40 ${selected?.id === s.id ? "bg-secondary/40" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.created_at)}</td>
                  <td className="px-3 py-2">{sim.invoices.find((i) => i.id === s.invoice_id)?.reference}</td>
                  <td className="px-3 py-2">{s.source === "liquidity" ? "Liquidity pool" : "Buyer"}{s.partial ? " · partial" : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2">{s.stage === 1 ? `Confirming ${s.confirmations}/32` : STAGES[s.stage]}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><HashText value={s.signature} /></td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{fmtUsdc(s.amount_cents, s.token)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular">{s.stage >= 3 ? fmtKes(s.kes_cents) : "—"}</td>
                  <td className="px-3 py-2 tabular">{s.rate.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {payFor && <SimulatePaymentDialog invoice={payFor} open onOpenChange={(o) => !o && setPayFor(null)} />}
    </div>
  );
}
