import { Link } from "@tanstack/react-router";
import { Check, Circle } from "lucide-react";
import { SimBadge } from "@/components/sim/SimUi";
import { Skeleton } from "@/components/ui/skeleton";
import { displayStatus, fmtKes, fmtUsdc, useSim } from "@/lib/sim/store";
import { cn } from "@/lib/utils";

/** KPI cards and Invoice → Advance → Settlement → Conversion → Payout → Onchain record timeline. */
export function MoneyFlow() {
  const { sim, ready } = useSim();
  if (!ready) return <Skeleton className="mt-6 h-48 w-full rounded-2xl" />;

  const buyerSt = sim.settlements.filter((s) => s.source === "buyer" && s.stage >= 4);
  const paidOut = sim.settlements.reduce((a, s) => a + (s.waterfall?.farmers_kes_cents ?? 0), 0);
  const durations = sim.settlements.filter((s) => s.record_tx).map((s) => {
    const r = sim.records.find((x) => x.tx === s.record_tx);
    return r ? (Date.parse(r.block_time) - Date.parse(s.created_at)) / 1000 : 0;
  });
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const kpis = [
    ["USDC settled", fmtUsdc(buyerSt.reduce((a, s) => a + s.amount_cents, 0))],
    ["KES paid out", fmtKes(paidOut)],
    ["Farmers paid", String(paidOut > 0 ? sim.farmers.length : 0)],
    ["Avg payout time", durations.length ? `${avg.toFixed(1)} s` : "—"],
    ["Total financed", fmtUsdc(sim.invoices.reduce((a, i) => a + (i.advance?.principal_cents ?? 0), 0))],
    ["Records anchored", String(sim.records.length)],
  ];

  const inv = sim.invoices.find((i) => i.settlement_ids.length) ?? sim.invoices[0];
  const sts = inv ? sim.settlements.filter((s) => s.invoice_id === inv.id) : [];
  const buyer = sts.find((s) => s.source === "buyer");
  const last = sts.find((s) => s.record_tx);
  const steps = inv ? [
    { label: "Invoice", detail: `${inv.reference} · ${displayStatus(inv, sim)}`, done: Boolean(inv.issued_at), to: "/coop/financing" as const },
    { label: "Advance", detail: inv.advance ? fmtUsdc(inv.advance.principal_cents) : "Not financed", done: Boolean(inv.advance), to: "/coop/financing" as const },
    { label: "Settlement", detail: buyer ? fmtUsdc(buyer.amount_cents, buyer.token) : "Waiting for buyer", done: Boolean(buyer && buyer.stage >= 2), to: "/coop/settlements" as const },
    { label: "Conversion", detail: buyer && buyer.stage >= 3 ? fmtKes(buyer.kes_cents) : "—", done: Boolean(buyer && buyer.stage >= 3), to: "/coop/settlements" as const },
    { label: "Payout", detail: buyer?.waterfall ? fmtKes(buyer.waterfall.farmers_kes_cents) : "—", done: Boolean(buyer?.waterfall), to: "/coop/settlements" as const },
    { label: "Onchain record", detail: last?.record_tx ? `${last.record_tx.slice(0, 8)}…` : "—", done: Boolean(buyer?.record_tx), to: "/coop/records" as const },
  ] : [];

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-display text-xl">Stablecoin money flow</h2>
        <SimBadge />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase text-muted-foreground">{k}</p>
            <p className="text-display mt-1 text-lg tabular">{v}</p>
          </div>
        ))}
      </div>
      {inv && (
        <ol className="grid gap-2 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
          {steps.map((s) => (
            <li key={s.label}>
              <Link to={s.to} className="flex h-full gap-2 rounded-xl p-2 hover:bg-secondary">
                {s.done ? <Check className="mt-0.5 size-4 shrink-0 text-lime" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span>
                  <span className={cn("block text-sm font-medium", !s.done && "text-muted-foreground")}>{s.label}</span>
                  <span className="block text-xs capitalize text-muted-foreground tabular">{s.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
