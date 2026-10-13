import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FastForward, FlaskConical, Play, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateTime } from "@/lib/format";
import { PRESETS, fastForward, resetSim, runFullDemo, runPreset, setRate, setSpeed, toggleTamper, useSim, type Speed } from "@/lib/sim/store";

export function SimulationPanel() {
  const { sim } = useSim();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const tampered = Boolean(sim.records[0]?.tamper);

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-5 z-40 h-11 rounded-full bg-card px-4 shadow-lift md:bottom-[5.5rem] md:right-6"
        aria-label="Open simulation panel"
      >
        <FlaskConical className="size-4 text-terracotta" /> Simulation
      </Button>
    );
  }

  return (
    <aside className="fixed inset-x-3 bottom-3 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lift sm:inset-x-auto sm:right-5 sm:w-[380px]" aria-label="Simulation panel">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 font-medium"><FlaskConical className="size-4 text-terracotta" /> Simulation panel</p>
        <Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Close simulation panel"><X className="size-4" /></Button>
      </header>
      <div className="space-y-5 overflow-y-auto p-4">
        <Button
          className="h-11 w-full"
          disabled={sim.demo_running}
          onClick={async () => {
            const tx = await runFullDemo();
            if (tx) void navigate({ to: "/receipt/$txHash", params: { txHash: tx } });
          }}
        >
          <Play className="size-4" /> {sim.demo_running ? "Demo running…" : "Run full demo"}
        </Button>

        <div>
          <Label className="mb-2 block">Scenario presets</Label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <Button key={p.id} size="sm" variant="outline" className="h-auto min-h-9 whitespace-normal py-1.5 text-xs" disabled={sim.demo_running} onClick={() => void runPreset(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm"><Label>USDC/KES rate</Label><span className="tabular">{sim.rate.toFixed(2)}</span></div>
          <Slider min={100} max={160} step={0.5} value={[sim.rate]} onValueChange={([v]) => setRate(v!)} aria-label="USDC to KES rate" />
        </div>

        <div className="space-y-2">
          <Label>Confirmation speed</Label>
          <ToggleGroup type="single" variant="outline" value={sim.speed} onValueChange={(v) => v && setSpeed(v as Speed)} className="w-full">
            {(["slow", "normal", "instant"] as const).map((s) => <ToggleGroupItem key={s} value={s} className="flex-1 capitalize">{s}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="tamper">Tamper with latest record</Label>
          <Switch id="tamper" checked={tampered} disabled={!sim.records.length} onCheckedChange={() => toggleTamper()} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => fastForward(30)}><FastForward className="size-4" /> +30 days</Button>
          <Button variant="outline" size="sm" onClick={resetSim} disabled={sim.demo_running}><RotateCcw className="size-4" /> Reset</Button>
        </div>
        {sim.offset_days > 0 && <p className="text-xs text-muted-foreground">Clock is {sim.offset_days} days ahead.</p>}

        <div>
          <Label className="mb-2 block">Activity log</Label>
          <ol className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border p-2 text-xs" aria-live="polite">
            {sim.log.map((l, i) => (
              <li key={i} className="flex gap-2"><span className="shrink-0 text-muted-foreground tabular">{formatDateTime(l.at).split(",").pop()}</span><span>{l.text}</span></li>
            ))}
          </ol>
        </div>
      </div>
    </aside>
  );
}
