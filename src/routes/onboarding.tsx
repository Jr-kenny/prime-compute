import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage, useChainId, useSwitchChain } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "../lib/wallet-connect/config";
import { getLoginNonce, completeSiweLogin } from "../lib/auth/siwe-fns";
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

type Step = "connect" | "prove" | "verifying" | "ready" | "error";

const LADDER: { key: Step; label: string }[] = [
  { key: "connect", label: "Connect wallet" },
  { key: "prove", label: "Prove ownership" },
  { key: "ready", label: "Authenticated" },
];

function Onboarding() {
  const { redirect: redirectTo } = Route.useSearch();
  const router = useRouter();
  const { session, loading, walletAddress, signOut } = useSession();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const [step, setStep] = useState<Step>("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== arcTestnet.id;

  // Get the wallet onto Arc, adding the chain if the wallet has never seen it. Returns true
  // once we're on Arc; false (with an error set) if the user waved the switch away.
  async function ensureArcChain(): Promise<boolean> {
    if (chainId === arcTestnet.id) return true;
    try {
      await switchChainAsync({ chainId: arcTestnet.id });
      return true;
    } catch (e) {
      const rejected = e instanceof Error && /User rejected|denied/i.test(e.message);
      setError(rejected ? "switch to the Arc network to sign in" : e instanceof Error ? e.message : "couldn't switch to Arc");
      setStep("error");
      return false;
    }
  }

  // Covers completing the ceremony while sitting on this page: `session` flips to truthy
  // reactively (no navigation happens), so beforeLoad's redirect never gets a chance to
  // run again. This effect is what actually sends the user back where they were headed.
  useEffect(() => {
    if (session && redirectTo) router.navigate({ href: redirectTo, replace: true });
  }, [session, redirectTo, router]);

  async function run() {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      // [0] SIWE binds to Arc's chain id, so the wallet has to be on Arc before it signs.
      // Auto-switch (and add the chain) rather than making the user do it by hand.
      if (!(await ensureArcChain())) return;

      // [1] Server-issued stateless nonce, bound to this address.
      const { nonce } = await getLoginNonce({ data: { address } });
      setStep("prove");

      // [2] Standard SIWE message; the wallet shows a structured sign-in prompt.
      const message = createSiweMessage({
        address,
        chainId: arcTestnet.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        statement: "Sign in to Prime Compute",
      });
      const signature = await signMessageAsync({ message });

      // [3] Verify server-side and mint the app session.
      setStep("verifying");
      const session = await completeSiweLogin({ data: { message, signature } });
      await supabaseBrowser.auth.setSession(session);
      setStep("ready");
    } catch (e) {
      const rejected = e instanceof Error && /User rejected|denied/i.test(e.message);
      setError(
        rejected
          ? "signature request declined — try again when you're ready"
          : e instanceof Error
            ? e.message
            : JSON.stringify(e),
      );
      setStep("error");
    } finally {
      setBusy(false);
    }
  }

  // Auto-trigger the proof once a wallet connects (and only while signed out).
  useEffect(() => {
    if (isConnected && address && !session && !busy && step === "connect") void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, session]);

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
          Sign in with your wallet. Your address is your identity; a signature proves it.
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

        <div className="mt-8 flex flex-col items-center gap-3">
          <ConnectButton showBalance={false} chainStatus="icon" />
          {wrongChain ? (
            <button
              onClick={() => void ensureArcChain()}
              className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Switch to Arc network
            </button>
          ) : (
            isConnected && step === "error" && (
              <button
                onClick={run}
                className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Try signing in again
              </button>
            )
          )}
          {wrongChain && (
            <p className="text-xs text-muted-foreground">Your wallet is on another network. Prime Compute runs on Arc.</p>
          )}
          {busy && <p className="text-xs text-muted-foreground">Check your wallet…</p>}
        </div>

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
      </div>
    </Centered>
  );
}

function currentIndex(step: Step): number {
  if (step === "connect" || step === "error") return 0;
  if (step === "prove" || step === "verifying") return 1;
  return 2; // ready
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-background px-4">{children}</div>;
}
