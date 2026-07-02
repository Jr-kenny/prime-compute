import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance, withdrawFromSpendWallet } from "@/lib/wallet/server-fns";
import { listMySpend } from "@/lib/wallet/history-fns";
import { getTreasuryBalance, treasuryTransferChallenge } from "@/lib/auth/circle-fns";
import { loadCircleSession, executeChallenge } from "@/lib/circle/user-sdk";

function AddressRow({ label, hint, address }: { label: string; hint?: string; address: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input readOnly value={address} className="font-mono bg-card border-border text-xs" />
        <Button
          variant="ghost"
          size="icon"
          className="border border-border shrink-0"
          onClick={() => address && navigator.clipboard.writeText(address)}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// The wallet details, opened as a side sheet from the dashboard balance chip. Shows the
// live balance + address, deposit guidance, a multi-step withdraw flow, and spend history.
export function WalletSheet({
  open,
  onClose,
  accessToken,
}: {
  open: boolean;
  onClose: () => void;
  accessToken: string | undefined;
}) {
  const { walletAddress } = useSession(); // the modular (passkey) wallet = identity
  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken && open,
    refetchInterval: 5000,
  });
  const { data: history = [] } = useQuery({
    queryKey: ["spend-history", accessToken],
    queryFn: () => listMySpend({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken && open,
    refetchInterval: 5000,
  });
  const { data: treasury } = useQuery({
    queryKey: ["treasury-wallet", accessToken],
    queryFn: () => getTreasuryBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken && open,
    refetchInterval: 5000,
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface border-border w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Wallet</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="glass-card p-5 space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Spend wallet balance
              </div>
              <div className="mt-1 text-3xl font-bold font-mono">
                ${data?.usdcFormatted ?? "…"} USDC
              </div>
            </div>
            <AddressRow
              label="Spend wallet (EOA)"
              hint="streams your rentals"
              address={data?.address ?? "…"}
            />
            <AddressRow
              label="Treasury (Circle wallet)"
              hint={treasury?.usdcFormatted ? `$${treasury.usdcFormatted} USDC` : "identity + treasury"}
              address={treasury?.address ?? walletAddress ?? "…"}
            />
          </div>

          <div className="glass-card p-5 space-y-1.5">
            <h3 className="font-semibold text-sm">Deposit</h3>
            <p className="text-xs text-muted-foreground">
              Fund the spend wallet so it can stream rentals. Send USDC on Arc to the EOA
              address above. Need testnet USDC?{" "}
              <a className="text-glow underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Circle faucet
              </a>
              .
            </p>
          </div>

          <TreasuryTransferFlow accessToken={accessToken} spendWalletAddress={data?.address} />

          <WithdrawFlow accessToken={accessToken} />

          <div className="glass-card p-5">
            <h3 className="font-semibold text-sm">Spend history</h3>
            <div className="mt-3 space-y-2">
              {history.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">{c.rentName}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono">${(c.amountAtomic / 1_000_000).toFixed(6)}</span>
                    <span className={c.settled ? "text-success" : "text-muted-foreground"}>
                      {c.settled ? "settled" : "pending"}
                    </span>
                  </span>
                </div>
              ))}
              {history.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No charges yet. Rent some compute and the stream shows up here.
                </p>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Treasury transfer: amount -> PIN challenge. Funds the spend wallet by       */
/* default; "someone else" reveals a destination field for external withdraws. */
/* -------------------------------------------------------------------------- */

function TreasuryTransferFlow({
  accessToken,
  spendWalletAddress,
}: {
  accessToken: string | undefined;
  spendWalletAddress: string | undefined;
}) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [external, setExternal] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const destination = external ? to.trim() : (spendWalletAddress ?? "");
  const destinationValid = /^0x[0-9a-fA-F]{40}$/.test(destination);

  async function send() {
    if (!accessToken) return;
    const circle = loadCircleSession();
    if (!circle) {
      setError("Circle session expired — sign in again from Onboarding to approve transfers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { challengeId } = await treasuryTransferChallenge({
        data: { accessToken, userToken: circle.userToken, amount: amount.trim(), destinationAddress: destination },
      });
      await executeChallenge(challengeId, circle); // Circle's PIN UI approves the move
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ["treasury-wallet"] });
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">Fund spend wallet</h3>
      <p className="text-xs text-muted-foreground">
        Moves USDC from your treasury. You approve with your Circle PIN.
      </p>
      {done ? (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Approved
          </div>
          <Button variant="ghost" className="w-full border border-border" onClick={() => { setDone(false); setAmount(""); }}>
            New transfer
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Label className="text-xs">Amount (USDC)</Label>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono bg-card border-border" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
            Send somewhere else instead
          </label>
          {external && (
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Destination address (0x…)" className="font-mono bg-card border-border" />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy || !amount.trim() || !destinationValid}
            onClick={send}
          >
            {busy ? "Waiting for PIN…" : "Approve with PIN"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Multi-step withdraw: paste address -> amount -> send                       */
/* -------------------------------------------------------------------------- */

type Step = "address" | "amount" | "done";

function WithdrawFlow({ accessToken }: { accessToken: string | undefined }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("address");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addressValid = /^0x[0-9a-fA-F]{40}$/.test(to.trim());

  function reset() {
    setStep("address");
    setTo("");
    setAmount("");
    setError(null);
    setTxHash(null);
  }

  async function send() {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withdrawFromSpendWallet({
        data: { accessToken, toAddress: to.trim(), amount: amount.trim() },
      });
      setTxHash(res.txHash);
      setStep("done");
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Withdraw</h3>
        <StepDots step={step} />
      </div>

      {step === "address" && (
        <div className="space-y-3">
          <Label className="text-xs">Destination address</Label>
          <Input
            autoFocus
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="Paste wallet address (0x…)"
            className="font-mono bg-card border-border"
          />
          <Button
            disabled={!addressValid}
            onClick={() => setStep("amount")}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === "amount" && (
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            To <span className="font-mono text-foreground">{to.slice(0, 10)}…{to.slice(-6)}</span>
          </div>
          <Label className="text-xs">Amount (USDC)</Label>
          <Input
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="font-mono bg-card border-border"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1 border border-border" onClick={() => setStep("address")} disabled={busy}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={busy || !amount.trim()}
              onClick={send}
            >
              {busy ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Sent
          </div>
          {txHash && (
            <div className="text-center text-xs text-muted-foreground">
              Tx <span className="font-mono text-foreground">{txHash.slice(0, 12)}…</span>
            </div>
          )}
          <Button variant="ghost" className="w-full border border-border" onClick={reset}>
            New withdrawal
          </Button>
        </div>
      )}
    </div>
  );
}

function StepDots({ step }: { step: Step }) {
  const order: Step[] = ["address", "amount", "done"];
  const idx = order.indexOf(step);
  return (
    <span className="flex items-center gap-1">
      {order.map((_, i) => (
        <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= idx ? "bg-primary" : "bg-border"}`} />
      ))}
    </span>
  );
}
