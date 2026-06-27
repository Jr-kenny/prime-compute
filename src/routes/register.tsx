import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Cpu, Zap, HardDrive, Server, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";
import confetti from "canvas-confetti";
import { PageShell } from "@/components/site/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "List Your Server — Prime Compute" },
      { name: "description", content: "Register idle hardware on Prime Compute and earn streaming USDC per millisecond." },
    ],
  }),
  component: Register,
});

type ResType = "GPU" | "CPU" | "Storage" | "Full Server";
const resOptions: { id: ResType; icon: any; desc: string }[] = [
  { id: "GPU", icon: Zap, desc: "Single or multi-GPU rig" },
  { id: "CPU", icon: Cpu, desc: "High-core CPU server" },
  { id: "Storage", icon: HardDrive, desc: "Bulk SSD/NVMe" },
  { id: "Full Server", icon: Server, desc: "Everything in one box" },
];

function Register() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const [form, setForm] = useState({
    alias: "", type: "GPU" as ResType,
    cpu: 32, ram: 128, storage: 2000,
    gpu: "NVIDIA H100", vram: 80,
    region: "US-East", alwaysOn: true,
    pricePerSecond: 0.0000098, minDuration: 60,
    certified: false,
  });

  const steps = ["Hardware", "Pricing", "Verification", "Review"];

  function next() { setStep((s) => Math.min(steps.length - 1, s + 1)); }
  function prev() { setStep((s) => Math.max(0, s - 1)); }
  function submit() {
    setDone(true);
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.5 } });
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12">
        <div className="text-[11px] uppercase tracking-wider text-glow">Provider onboarding</div>
        <h1 className="mt-1 text-3xl md:text-4xl font-bold">List your server</h1>

        {/* progress */}
        <div className="mt-8 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={cn("h-1 rounded-full transition", i <= step ? "bg-glow" : "bg-border")} />
              <div className={cn("mt-2 text-[10px] uppercase tracking-wider", i <= step ? "text-foreground" : "text-muted-foreground")}>{s}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 glass-card p-6 md:p-8">
          {done ? (
            <div className="text-center py-10">
              <div className="mx-auto h-14 w-14 rounded-full bg-success/15 ring-1 ring-success/40 flex items-center justify-center text-success">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-2xl font-bold">Server submitted</h2>
              <p className="mt-2 text-sm text-muted-foreground">Your server is pending hardware verification. We'll notify you when the broker starts routing jobs.</p>
            </div>
          ) : step === 0 ? (
            <div className="space-y-5">
              <div>
                <Label>Server alias</Label>
                <Input className="mt-2 bg-card border-border" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="node-astral-7" />
              </div>
              <div>
                <Label>Resource type</Label>
                <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {resOptions.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setForm({ ...form, type: r.id })}
                      className={cn(
                        "rounded-lg border p-3 text-left transition",
                        form.type === r.id ? "border-glow bg-primary/10" : "border-border bg-card/60 hover:border-accent/50",
                      )}
                    >
                      <r.icon className="h-4 w-4 text-glow" />
                      <div className="mt-2 text-sm font-medium">{r.id}</div>
                      <div className="text-[10px] text-muted-foreground">{r.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="CPU cores" v={form.cpu} onChange={(v) => setForm({ ...form, cpu: +v })} />
                <Field label="RAM (GB)" v={form.ram} onChange={(v) => setForm({ ...form, ram: +v })} />
                <Field label="Storage (GB)" v={form.storage} onChange={(v) => setForm({ ...form, storage: +v })} />
              </div>
              {(form.type === "GPU" || form.type === "Full Server") && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>GPU model</Label>
                    <Input className="mt-2 bg-card border-border" value={form.gpu} onChange={(e) => setForm({ ...form, gpu: e.target.value })} />
                  </div>
                  <Field label="VRAM (GB)" v={form.vram} onChange={(v) => setForm({ ...form, vram: +v })} />
                </div>
              )}
            </div>
          ) : step === 1 ? (
            <div className="space-y-5">
              <div>
                <Label>Region</Label>
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                >
                  {["US-East", "US-West", "EU-West", "EU-Central", "Asia-Pacific", "South-America"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Always-on availability</Label>
                <Switch checked={form.alwaysOn} onCheckedChange={(v) => setForm({ ...form, alwaysOn: v })} />
              </div>
              <div>
                <Label>Price per second (USDC)</Label>
                <Input type="number" step="0.0000001" className="mt-2 bg-card border-border font-mono" value={form.pricePerSecond}
                  onChange={(e) => setForm({ ...form, pricePerSecond: +e.target.value })} />
                <p className="mt-2 text-xs text-muted-foreground">
                  At this rate, a 1-hour job costs <span className="text-foreground">${(form.pricePerSecond * 3600).toFixed(4)}</span>.
                </p>
              </div>
              <Field label="Minimum job duration (seconds)" v={form.minDuration} onChange={(v) => setForm({ ...form, minDuration: +v })} />
            </div>
          ) : step === 2 ? (
            <div className="space-y-5">
              <Button variant="ghost" className="border border-border w-full" onClick={() => setWalletOpen(true)}>
                Connect wallet or authenticate
              </Button>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={form.certified} onCheckedChange={(v) => setForm({ ...form, certified: !!v })} className="mt-0.5" />
                <span className="text-sm text-muted-foreground">
                  I certify these specs are accurate. The broker will benchmark this server and flag mismatches publicly on my Compute Score.
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <Review label="Alias" value={form.alias || "—"} />
              <Review label="Type" value={form.type} />
              <Review label="Hardware" value={`${form.cpu} cores · ${form.ram} GB RAM · ${form.storage} GB SSD`} />
              {(form.type === "GPU" || form.type === "Full Server") && <Review label="GPU" value={`${form.gpu} · ${form.vram} GB VRAM`} />}
              <Review label="Region" value={form.region} />
              <Review label="Price" value={`$${form.pricePerSecond.toFixed(7)} / sec`} />
              <Review label="Always on" value={form.alwaysOn ? "yes" : "scheduled"} />
            </div>
          )}

          {!done && (
            <div className="mt-8 flex justify-between">
              <Button variant="ghost" onClick={prev} disabled={step === 0} className="border border-border"><ArrowLeft className="h-4 w-4" />Back</Button>
              {step < steps.length - 1 ? (
                <Button onClick={next} className="bg-primary text-primary-foreground">Continue<ArrowRight className="h-4 w-4" /></Button>
              ) : (
                <Button onClick={submit} disabled={!form.certified} className="bg-primary text-primary-foreground">Submit server</Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={walletOpen} onOpenChange={setWalletOpen}>
        <DialogContent className="bg-surface border-border">
          <DialogHeader><DialogTitle>Wallet connection coming soon</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Wallet linking is wired up in the next release. You can still complete onboarding for the testnet preview.</p>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function Field({ label, v, onChange }: { label: string; v: number; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" className="mt-2 bg-card border-border" value={v} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}