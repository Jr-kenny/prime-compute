import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { AppShell } from "@/components/site/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authGuard } from "@/lib/auth/guard";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance, withdrawFromSpendWallet } from "@/lib/wallet/server-fns";
import { listMySpend } from "@/lib/wallet/history-fns";

export const Route = createFileRoute("/wallet")({
  beforeLoad: authGuard,
  head: () => ({ meta: [{ title: "Wallet - Prime Compute" }] }),
  component: WalletPage,
});

function WalletPage() {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const queryClient = useQueryClient();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["spend-history", accessToken],
    queryFn: () => listMySpend({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });

  async function withdraw() {
    if (!accessToken) return;
    setBusy(true);
    setMsg(null);
    try {
      const { txHash } = await withdrawFromSpendWallet({ data: { accessToken, toAddress: to, amount } });
      setMsg(`Sent. Tx ${txHash.slice(0, 10)}…`);
      setTo("");
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["spend-wallet"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "withdraw failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-glow">Wallet</div>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">Your spend wallet</h1>
        </div>

        <div className="glass-card p-6">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Balance</div>
          <div className="mt-2 text-3xl font-bold font-mono">${data?.usdcFormatted ?? "…"} USDC</div>
          <div className="mt-3 flex items-center gap-2">
            <Input readOnly value={data?.address ?? ""} className="font-mono bg-card border-border text-xs" />
            <Button
              variant="ghost"
              size="icon"
              className="border border-border"
              onClick={() => data && navigator.clipboard.writeText(data.address)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="glass-card p-6 space-y-2">
          <h3 className="font-semibold">Deposit</h3>
          <p className="text-sm text-muted-foreground">
            Send USDC on Arc to the address above to fund streaming. Need testnet USDC?{" "}
            <a className="text-glow underline" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
              Circle faucet
            </a>
            .
          </p>
        </div>

        <div className="glass-card p-6 space-y-4">
          <h3 className="font-semibold">Withdraw</h3>
          <div className="space-y-2">
            <Label>Destination address</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" className="font-mono bg-card border-border" />
          </div>
          <div className="space-y-2">
            <Label>Amount (USDC)</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono bg-card border-border" />
          </div>
          <Button onClick={withdraw} disabled={busy || !to || !amount} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {busy ? "Sending…" : "Withdraw"}
          </Button>
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </div>

        <div className="glass-card p-6">
          <h3 className="font-semibold">Spend history</h3>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground text-left">
                <th className="py-2">Rent</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((c, i) => (
                <tr key={i}>
                  <td className="py-2">{c.rentName}</td>
                  <td className="font-mono">${(c.amountAtomic / 1_000_000).toFixed(6)}</td>
                  <td className={c.settled ? "text-success" : "text-muted-foreground"}>
                    {c.settled ? "settled" : "pending"}
                  </td>
                  <td className="text-muted-foreground text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No charges yet. Rent some compute and the stream shows up here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
