import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ArrowLeft, ArrowRight, Check, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSpendWalletBalance, withdrawFromSpendWallet, getGatewayBalanceFn, reclaimGatewayFloat } from "@/lib/wallet/server-fns";
import { listMySpend } from "@/lib/wallet/history-fns";
import { erc20Abi, parseUnits, formatUnits } from "viem";
import { useAccount, useWriteContract, useReadContract } from "wagmi";
import { usdcAddress, explorerAddressUrl } from "@/lib/wallet-connect/config";

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
        <Button
          variant="ghost"
          size="icon"
          className="border border-border shrink-0"
          asChild
        >
          <a
            href={address.startsWith("0x") ? explorerAddressUrl(address) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-label={`View ${label} on the Arc explorer`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
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
          </div>

          <GatewayFloatCard accessToken={accessToken} />

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

          <FundSpendWalletFlow spendWalletAddress={data?.address} />

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

/* Fund the spend wallet straight from the connected wallet: a plain USDC transfer the
   wallet itself confirms. USDC has 6 decimals on Arc. */
function FundSpendWalletFlow({ spendWalletAddress }: { spendWalletAddress: string | undefined }) {
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { data: fundingBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const amountValid = /^\d+(\.\d{1,6})?$/.test(amount.trim()) && Number(amount) > 0;

  async function send() {
    if (!spendWalletAddress) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "transfer",
        args: [spendWalletAddress as `0x${string}`, parseUnits(amount.trim(), 6)],
      });
      setTxHash(hash);
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      const rejected = e instanceof Error && /User rejected|denied/i.test(e.message);
      setError(rejected ? "transfer declined in the wallet" : e instanceof Error ? e.message : "transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <h3 className="font-semibold text-sm">Fund spend wallet</h3>
      <p className="text-xs text-muted-foreground">
        Sends USDC from your connected wallet to the spend wallet. Your wallet asks you to confirm.
      </p>
      {txHash ? (
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-success/15 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Sent
          </div>
          <div className="text-center text-xs text-muted-foreground">
            Tx <span className="font-mono text-foreground">{txHash.slice(0, 12)}…</span>
          </div>
          <Button variant="ghost" className="w-full border border-border" onClick={() => { setTxHash(null); setAmount(""); }}>
            New transfer
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label className="text-xs">Amount (USDC)</Label>
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
              disabled={fundingBalance == null}
              onClick={() => fundingBalance != null && setAmount(formatUnits(fundingBalance, 6))}
            >
              Balance: {fundingBalance != null ? `${formatUnits(fundingBalance, 6)} USDC` : "…"}
            </button>
          </div>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono bg-card border-border" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy || !amountValid || !isConnected || !spendWalletAddress}
            onClick={send}
          >
            {busy ? "Confirm in wallet…" : "Send from wallet"}
          </Button>
          {!isConnected && (
            <p className="text-xs text-muted-foreground">Connect your wallet on Onboarding first.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* The Gateway float: the prepaid balance rentals stream against. Deposits into it are one-way
   today, so unused float would be stranded; this reads it and reclaims it back to the spend wallet.
   Warns first if a lease is running, since auto-topup would just re-fund a reclaimed buffer. */
function GatewayFloatCard({ accessToken }: { accessToken: string | undefined }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["gateway-float", accessToken],
    queryFn: () => getGatewayBalanceFn({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });

  async function reclaim() {
    if (!accessToken) return;
    if (
      (data?.activeLeaseCount ?? 0) > 0 &&
      !confirm(
        "You have a running rental. Reclaiming won't stop it (it just re-funds itself); cancel the rental to actually stop spending. Reclaim anyway?",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await reclaimGatewayFloat({ data: { accessToken } });
      setMsg(r.txHash ? `Reclaimed $${(Number(r.amountAtomic) / 1_000_000).toFixed(6)} (tx ${r.txHash.slice(0, 10)}…)` : "Nothing to reclaim");
      await queryClient.invalidateQueries({ queryKey: ["gateway-float"] });
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "reclaim failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-card p-5 space-y-2">
      <h3 className="font-semibold text-sm">Gateway float</h3>
      <p className="text-xs text-muted-foreground">
        Prepaid balance your rentals stream against. Reclaim what's unused back to your spend wallet.
      </p>
      <div className="text-lg font-mono">${data?.formatted ?? "…"} USDC</div>
      <Button
        variant="ghost"
        className="w-full border border-border"
        disabled={busy || !accessToken}
        onClick={reclaim}
      >
        {busy ? "Reclaiming…" : "Reclaim to wallet"}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
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
