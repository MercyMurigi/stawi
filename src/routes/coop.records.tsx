import { createFileRoute, Link } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/stawi/EmptyState";
import { HashText, SimNotice } from "@/components/sim/SimUi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { formatDateTime } from "@/lib/format";
import { fmtKes, useSim } from "@/lib/sim/store";

export const Route = createFileRoute("/coop/records")({
  head: () => ({
    meta: [
      { title: "Payout records — Stawi co-op" },
      { name: "description", content: "Every farmer payout batch anchored onchain with a verifiable manifest hash and Merkle root (simulated)." },
      { property: "og:title", content: "Payout records — Stawi co-op" },
      { property: "og:description", content: "Verifiable onchain payout records (simulated)." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Records,
});

function Records() {
  const { sim, ready } = useSim();
  if (!ready) return <Skeleton className="h-96 w-full rounded-2xl" />;
  return (
    <div>
      <PageHeader title="Payout records" description="Each payout batch is anchored onchain so anyone can check it wasn't changed." />
      <SimNotice>Anchoring is simulated: hashes and Merkle roots are real SHA-256, but signatures and slots are generated, not on a real chain.</SimNotice>
      {sim.records.length === 0 ? (
        <EmptyState icon={ScrollText} title="No records yet" description="Run a settlement or the full demo from the simulation panel." />
      ) : (
        <ul className="space-y-3">
          {sim.records.map((r) => {
            const total = r.manifest.allocations.reduce((a, x) => a + x.amount_kes_cents, 0);
            return (
              <li key={r.tx} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium">{r.manifest.invoice_reference} · {r.manifest.kind === "early_payout" ? "Early payout from advance" : "Settlement waterfall"}</p>
                    <p className="text-sm text-muted-foreground tabular">{fmtKes(total)} to {r.manifest.allocations.length} farmers{r.manifest.lender_repayment_kes_cents ? ` · ${fmtKes(r.manifest.lender_repayment_kes_cents)} to lender` : ""} · slot {r.slot.toLocaleString()} · {formatDateTime(r.block_time)}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Tx <HashText value={r.tx} /></span>
                      <span>Hash <HashText value={r.manifest_hash} /></span>
                      <span>Root <HashText value={r.merkle_root} /></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.tamper && <span className="rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">Tampered</span>}
                    <Button asChild size="sm"><Link to="/receipt/$txHash" params={{ txHash: r.tx }}>Open receipt</Link></Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
