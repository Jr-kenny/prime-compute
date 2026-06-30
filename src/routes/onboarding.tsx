import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { registerWallet, loginWallet, type WalletHandle } from "../lib/circle/wallet";
import { requestNonce, verifySession } from "../lib/auth/server-fns";
import { supabaseBrowser } from "../lib/supabase/client";
import { useSession } from "../lib/auth/session";

// Onboarding is a waypoint, not a destination: whoever sent the user here (a gated route's
// authGuard, a "Get Started" CTA) passes along where they were headed via `redirect`, and once
// authenticated we send them straight there instead of always dropping them on one fixed page.
export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    if (!search.redirect) return;
    const { data } = await supabaseBrowser.auth.getSession();
    if (data.session) throw redirect({ href: search.redirect });
  },
  component: Onboarding,
});

type Step = "anonymous" | "passkey" | "wallet" | "verifying" | "ready" | "error";

const LADDER: { key: Step; label: string }[] = [
  { key: "anonymous", label: "Anonymous" },
  { key: "passkey", label: "Passkey" },
  { key: "wallet", label: "Wallet created" },
  { key: "ready", label: "Authenticated" },
];

function Onboarding() {
  const { redirect: redirectTo } = Route.useSearch();
  const router = useRouter();
  const { session, loading, walletAddress, signOut } = useSession();
  const [step, setStep] = useState<Step>("anonymous");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Covers completing the passkey ceremony while sitting on this page: `session` flips to
  // truthy reactively (no navigation happens), so beforeLoad's redirect never gets a chance to
  // run again. This effect is what actually sends the user back where they were headed.
  useEffect(() => {
    if (session && redirectTo) router.navigate({ href: redirectTo, replace: true });
  }, [session, redirectTo, router]);

  async function run(make: (username: string) => Promise<WalletHandle>) {
    setError(null);
    setBusy(true);
    try {
      setStep("passkey");
      const wallet = await make("prime-compute");
      setStep("wallet");
      const { nonce, message } = await requestNonce({ data: { address: wallet.address } });
      const signature = await wallet.signMessage(message);
      setStep("verifying");
      const sess = await verifySession({
        data: { address: wallet.address, walletId: wallet.walletId, nonce, signature },
      });
      await supabaseBrowser.auth.setSession(sess);
      setStep("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Centered>Loading…</Centered>;

  if (session && redirectTo) return <Centered>Redirecting…</Centered>;

  if (session) {
    return (
      <Centered>
        <div className="w-full max-w-md rounded-xl border border-input bg-card p-8 text-center">
          <h1 className="text-xl font-semibold text-foreground">You're in</h1>
          <p className="mt-2 text-sm text-muted-foreground">Authenticated with your wallet.</p>
          <p className="mt-4 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
            {walletAddress ?? "(wallet address unavailable)"}
          </p>
          <Link
            to="/marketplace"
            className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse the marketplace
          </Link>
          <button
            onClick={() => signOut()}
            className="mt-3 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign out
          </button>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-md rounded-xl border border-input bg-card p-8">
        <h1 className="text-2xl font-semibold text-foreground">Welcome to Prime Compute</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a passkey-backed wallet. No password, no seed phrase.
        </p>

        <ol className="mt-6 flex items-center justify-between text-xs">
          {LADDER.map((s, i) => {
            const reached = currentIndex(step) >= i;
            return (
              <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${
                    reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i + 1}
                </span>
                <span className={reached ? "text-foreground" : "text-muted-foreground"}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 flex flex-col gap-3">
          <button
            disabled={busy}
            onClick={() => run(registerWallet)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Create account & wallet"}
          </button>
          <button
            disabled={busy}
            onClick={() => run(loginWallet)}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            Sign in with an existing passkey
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </div>
    </Centered>
  );
}

function currentIndex(step: Step): number {
  if (step === "anonymous" || step === "error") return 0;
  if (step === "passkey") return 1;
  if (step === "wallet" || step === "verifying") return 2;
  return 3; // ready
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4">{children}</div>;
}
