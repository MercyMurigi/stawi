import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { InvoiceStatusBadge, RiskBadge, SimNotice, SimulatePaymentDialog } from "@/components/sim/SimUi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/features/shared/DashboardShell";
import { formatDate } from "@/lib/format";
import {
  FINANCING_LIMIT_CENTS, acceptAdvance, advanceTerms, buyerOf, createInvoice, displayStatus, feePct, fmtKes, fmtUsdc,
  issueInvoice, outstandingCents, quote, riskOf, useSim, type SimInvoice,
} from "@/lib/sim/store";

export const Route = createFileRoute("/coop/financing")({
  head: () => ({
    meta: [
      { title: "Invoice financing — Stawi co-op" },
      { name: "description", content: "Simulated invoice advances so farmers are paid before the buyer settles." },
      { property: "og:title", content: "Invoice financing — Stawi co-op" },
      { property: "og:description", content: "Get an advance on buyer invoices and pay farmers early (simulated)." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Financing,
});

function Financing() {
  const { sim, ready } = useSim();
  const [offer, setOffer] = useState<SimInvoice | null>(null);
  const [payFor, setPayFor] = useState<SimInvoice | null>(null);
  const [creating, setCreating] = useState(false);
  if (!ready) return <Skeleton className="h-96 w-full rounded-2xl" />;

  const financed = sim.invoices.filter((i) => i.advance);
  const total = financed.reduce((a, i) => a + i.advance!.principal_cents, 0);
  const outstanding = financed.reduce((a, i) => a + outstandingCents(i.advance!), 0);
  const fees = financed.reduce((a, i) => a + Math.min(i.advance!.fee_cents, Math.max(0, i.advance!.repaid_cents - i.advance!.principal_cents)), 0);
  const repaid = financed.filter((i) => i.advance!.repaid_at);
  const avgDays = repaid.length ? repaid.reduce((a, i) => a + (Date.parse(i.advance!.repaid_at!) - Date.parse(i.advance!.at)) / 86_400_000, 0) / repaid.length : null;
  const util = Math.min(100, (outstanding / FINANCING_LIMIT_CENTS) * 100);

  return (
    <div>
      <PageHeader title="Financing" description="Get an advance on an issued invoice so farmers are paid before the buyer pays." action={<Button className="h-11" onClick={() => setCreating(true)}><Plus className="size-4" /> New invoice</Button>} />
      <SimNotice>Financing is simulated. Advances come from a demo liquidity pool and are repaid automatically from the buyer's stablecoin settlement.</SimNotice>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Total financed", fmtUsdc(total)], ["Outstanding", fmtUsdc(outstanding)], ["Fees earned", fmtUsdc(fees)], ["Avg days to repay", avgDays === null ? "—" : avgDays.toFixed(1)]].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">{k}</p><p className="text-display mt-1 text-lg tabular">{v}</p></div>
        ))}
      </div>
      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 flex justify-between text-sm"><span>Facility utilisation</span><span className="tabular text-muted-foreground">{fmtUsdc(outstanding)} of {fmtUsdc(FINANCING_LIMIT_CENTS)}</span></div>
        <Progress value={util} />
      </div>

      <ul className="space-y-3">
        {sim.invoices.map((i) => {
          const st = displayStatus(i, sim);
          const buyer = buyerOf(i, sim);
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div>
                <p className="font-medium">{i.reference} · {buyer.name}</p>
                <p className="text-sm text-muted-foreground tabular">{fmtUsdc(i.amount_cents)} · {i.tenor} days{i.due_at ? ` · due ${formatDate(i.due_at)}` : ""}{i.paid_cents > 0 && i.paid_cents < i.amount_cents ? ` · ${fmtUsdc(i.paid_cents)} paid` : ""}</p>
                {i.advance && <p className="text-xs text-muted-foreground tabular">Advance {fmtUsdc(i.advance.principal_cents)} · owed {fmtUsdc(outstandingCents(i.advance))}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RiskBadge risk={riskOf(buyer, sim)} />
                <InvoiceStatusBadge status={st} />
                {st === "draft" && <Button size="sm" onClick={() => { issueInvoice(i.id); toast.success(`${i.reference} issued`); }}>Issue</Button>}
                {(st === "issued" || st === "overdue") && !i.advance && <Button size="sm" onClick={() => setOffer(i)}>Get advance</Button>}
                {i.issued_at && i.paid_cents < i.amount_cents && <Button size="sm" variant="outline" onClick={() => setPayFor(i)}>Receive stablecoin</Button>}
              </div>
            </li>
          );
        })}
      </ul>

      {offer && <OfferDialog invoice={offer} onClose={() => setOffer(null)} />}
      {payFor && <SimulatePaymentDialog invoice={payFor} open onOpenChange={(o) => !o && setPayFor(null)} />}
      <NewInvoiceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function OfferDialog({ invoice, onClose }: { invoice: SimInvoice; onClose: () => void }) {
  const { sim } = useSim();
  const [busy, setBusy] = useState(false);
  const t = advanceTerms(invoice.amount_cents, invoice.tenor);
  const kes = quote(t.principal_cents, sim.rate).kes_cents;
  const rows: [string, string][] = [
    ["Invoice value", fmtUsdc(invoice.amount_cents)],
    ["Advance rate", "80%"],
    ["Advance", fmtUsdc(t.principal_cents)],
    [`Flat fee (${feePct(invoice.tenor).toFixed(2)}% for ${invoice.tenor} days)`, fmtUsdc(t.fee_cents)],
    ["Net advance in KES", fmtKes(kes)],
    ["Repay", fmtUsdc(t.principal_cents + t.fee_cents)],
    ["Repayment source", "Auto-deducted from buyer stablecoin settlement"],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Financing offer · {invoice.reference}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">{buyerOf(invoice, sim).name} <RiskBadge risk={riskOf(buyerOf(invoice, sim), sim)} /></DialogDescription>
        </DialogHeader>
        <dl className="space-y-1.5 text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular">{v}</dd></div>)}
        </dl>
        <Button
          className="h-11 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const p = acceptAdvance(invoice.id);
            onClose();
            toast.success("Advance accepted. Funds are on the way from the liquidity pool.");
            await p.catch((e: Error) => toast.error(e.message));
          }}
        >
          Accept advance
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function NewInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { sim } = useSim();
  const [buyer, setBuyer] = useState(sim.buyers[0]!.id);
  const [amount, setAmount] = useState("15000");
  const [tenor, setTenor] = useState<"30" | "60" | "90">("60");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New invoice (simulated)</DialogTitle><DialogDescription>Drafts an invoice in USDC. Issue it to start the clock.</DialogDescription></DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const cents = Math.round(Number(amount) * 100);
            if (!(cents > 0)) { toast.error("Enter an amount above zero"); return; }
            createInvoice({ buyer_id: buyer, amount_cents: cents, tenor: Number(tenor) as 30 | 60 | 90 });
            toast.success("Invoice drafted");
            onOpenChange(false);
          }}
        >
          <div className="space-y-1.5"><Label>Buyer</Label>
            <Select value={buyer} onValueChange={setBuyer}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sim.buyers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="ni-amt">Amount (USDC)</Label><Input id="ni-amt" type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Due in</Label>
            <Select value={tenor} onValueChange={(v) => setTenor(v as "30" | "60" | "90")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["30", "60", "90"].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent></Select>
          </div>
          <Button type="submit" className="h-11 w-full">Create draft</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
