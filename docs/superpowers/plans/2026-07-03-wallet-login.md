# Wallet Login (RainbowKit + SIWE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Circle email/PIN login with RainbowKit wallet connect + SIWE signature, delete the Circle user-controlled path, and fund the spend wallet from the connected wallet.

**Architecture:** Wallet address stays the identity anchor (C1–C5 untouched). RainbowKit/wagmi handles connect on a custom Arc testnet chain; a SIWE message whose nonce is a stateless HMAC challenge is verified server-side with viem, then the existing `mintSessionForWallet` mints the Supabase session. The Circle Web SDK (and the node-polyfill machinery it forced into vite.config.ts) is deleted.

**Tech Stack:** wagmi v2, @rainbow-me/rainbowkit v2, viem/siwe (already a dep), TanStack Start server fns, bun test.

**Spec:** `docs/superpowers/specs/2026-07-03-wallet-login-design.md`

Conventions for every task: run commands from the repo root. `bun test src` runs the app tests. The repo uses `noUncheckedIndexedAccess` — guard index access. Env already has `AUTH_NONCE_SECRET`, `VITE_ARC_RPC_URL`, `VITE_ARC_CHAIN_ID` (5042002), `VITE_WALLETCONNECT_PROJECT_ID`, `USDC_ADDRESS` (+ `VITE_`-side below).

---

### Task 1: wagmi + RainbowKit providers on a custom Arc chain

**Files:**
- Create: `src/lib/wallet-connect/config.tsx`
- Modify: `src/routes/__root.tsx` (wrap the existing `QueryClientProvider` contents)
- Modify: `package.json` (two new deps)
- Modify: `.env.example` (document `VITE_WALLETCONNECT_PROJECT_ID`, `VITE_USDC_ADDRESS`)

- [ ] **Step 1: Install deps**

```bash
bun add wagmi @rainbow-me/rainbowkit
```

- [ ] **Step 2: Add `VITE_USDC_ADDRESS` to root `.env`** (same value as `USDC_ADDRESS`; the fund flow needs it in the browser):

```bash
grep -q '^VITE_USDC_ADDRESS=' .env || echo "VITE_USDC_ADDRESS=$(grep '^USDC_ADDRESS=' .env | cut -d= -f2)" >> .env
```

Also add to `.env.example` under the VITE block:

```
VITE_WALLETCONNECT_PROJECT_ID=   # cloud.reown.com project id (RainbowKit/WalletConnect)
VITE_USDC_ADDRESS=               # USDC token address on Arc (same as USDC_ADDRESS)
```

- [ ] **Step 3: Create `src/lib/wallet-connect/config.tsx`**

```tsx
// src/lib/wallet-connect/config.tsx
// wagmi + RainbowKit setup on the custom Arc testnet chain. This is the ONLY place the
// chain is defined; everything browser-side (connect, fund transfer, balance reads)
// hangs off this config.
import { defineChain } from "viem";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";

export const arcTestnet = defineChain({
  id: Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002),
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_ARC_RPC_URL as string] } },
  testnet: true,
});

export const usdcAddress = import.meta.env.VITE_USDC_ADDRESS as `0x${string}`;

export const wagmiConfig = getDefaultConfig({
  appName: "Prime Compute",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string,
  chains: [arcTestnet],
  ssr: true,
});

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={darkTheme({ accentColor: "#3b82f6" })} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
```

- [ ] **Step 4: Mount in `src/routes/__root.tsx`**

The root component currently renders:

```tsx
<QueryClientProvider client={queryClient}>
  {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
  <Outlet />
</QueryClientProvider>
```

Change to (WagmiProvider needs the query client to already be mounted, so it nests inside):

```tsx
<QueryClientProvider client={queryClient}>
  <WalletProviders>
    {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
    <Outlet />
  </WalletProviders>
</QueryClientProvider>
```

with `import { WalletProviders } from "../lib/wallet-connect/config";` added at the top.

- [ ] **Step 5: Verify SSR still works**

```bash
bun run dev & sleep 8; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/; kill %1
```

Expected: `200`. If SSR chokes on RainbowKit CSS or window access, move the `WalletProviders` mount behind a `typeof window` guard is NOT the fix — `getDefaultConfig({ ssr: true })` handles it; check the import error instead.

- [ ] **Step 6: tsc + commit**

```bash
bunx tsc --noEmit
git add -A && git commit -m "feat(identity): wagmi + rainbowkit providers on the arc testnet chain"
```

---

### Task 2: the pure SIWE core (`siwe.ts`) — TDD

**Files:**
- Create: `src/lib/auth/siwe.ts`
- Test: `src/lib/auth/siwe.test.ts`

SIWE (EIP-4361) requires an **alphanumeric nonce, min 8 chars** — the Phase-0 base64url nonce fails that, so the resurrected design is hex-only: `nonce = tsHex(8+) + hmacHex(64)`, HMAC-SHA256 over `${address.toLowerCase()}.${tsHex}` keyed by `AUTH_NONCE_SECRET`. Stateless, address-bound, 5-minute TTL. (Replay within TTL is accepted, same posture as Phase 0.)

- [ ] **Step 1: Write the failing tests (`src/lib/auth/siwe.test.ts`)**

```ts
import { describe, test, expect } from "bun:test";
import { issueLoginNonce, checkLoginNonce } from "./siwe";

const opts = { secret: "test-secret", now: 1_700_000_000_000 };
const addr = "0xAbC0000000000000000000000000000000000001";

describe("login nonce", () => {
  test("round-trips for the issuing address", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(nonce).toMatch(/^[a-f0-9]{16,}$/); // SIWE-legal: alphanumeric, >8 chars
    expect(checkLoginNonce(nonce, addr, opts)).toBe(true);
  });

  test("rejects a different address", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(checkLoginNonce(nonce, "0x" + "9".repeat(40), opts)).toBe(false);
  });

  test("address check is case-insensitive", () => {
    const nonce = issueLoginNonce(addr.toLowerCase(), opts);
    expect(checkLoginNonce(nonce, addr.toUpperCase().replace("0X", "0x"), opts)).toBe(true);
  });

  test("expires after the TTL", () => {
    const nonce = issueLoginNonce(addr, opts);
    expect(checkLoginNonce(nonce, addr, { ...opts, now: opts.now + 5 * 60_000 + 1 })).toBe(false);
  });

  test("rejects a tampered mac", () => {
    const nonce = issueLoginNonce(addr, opts);
    const bad = nonce.slice(0, -1) + (nonce.endsWith("0") ? "1" : "0");
    expect(checkLoginNonce(bad, addr, opts)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test src/lib/auth/siwe.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/auth/siwe.ts`**

```ts
// src/lib/auth/siwe.ts
// Stateless HMAC login nonce for SIWE. EIP-4361 nonces must be alphanumeric (>=8 chars),
// so the format is hex-only: `${tsHex}${macHex}` where mac = HMAC-SHA256(secret,
// `${address}.${tsHex}`). No nonce table; the TTL bounds the replay window (Phase-0 posture).
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;
const MAC_HEX = 64; // sha256 hex length

type Opts = { secret?: string; now?: number };
const secretOf = (o?: Opts) => o?.secret ?? process.env.AUTH_NONCE_SECRET!;
const nowOf = (o?: Opts) => o?.now ?? Date.now();

function mac(address: string, tsHex: string, secret: string): string {
  return createHmac("sha256", secret).update(`${address.toLowerCase()}.${tsHex}`).digest("hex");
}

export function issueLoginNonce(address: string, opts?: Opts): string {
  const tsHex = nowOf(opts).toString(16);
  return `${tsHex}${mac(address, tsHex, secretOf(opts))}`;
}

export function checkLoginNonce(nonce: string, address: string, opts?: Opts): boolean {
  if (!/^[a-f0-9]+$/.test(nonce) || nonce.length <= MAC_HEX) return false;
  const tsHex = nonce.slice(0, -MAC_HEX);
  const got = nonce.slice(-MAC_HEX);
  const want = mac(address, tsHex, secretOf(opts));
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return false;
  const ts = parseInt(tsHex, 16);
  return Number.isFinite(ts) && nowOf(opts) - ts <= TTL_MS;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/lib/auth/siwe.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/siwe.ts src/lib/auth/siwe.test.ts
git commit -m "feat(identity): stateless hex hmac nonce for siwe login"
```

---

### Task 3: the login bridge (`completeSiweLogin`) — TDD on the pure part

**Files:**
- Modify: `src/lib/auth/siwe.ts` (add `siweLogin` pure bridge)
- Modify: `src/lib/auth/siwe.test.ts`
- Create: `src/lib/auth/siwe-fns.ts`

The verifier and session-mint are injected so the bridge is unit-testable offline; the server fn wires the real viem client + `mintSessionForWallet`.

- [ ] **Step 1: Add failing bridge tests to `src/lib/auth/siwe.test.ts`**

```ts
import { siweLogin, type SiweLoginDeps } from "./siwe";
import { parseSiweMessage } from "viem/siwe";

const now = 1_700_000_000_000;
function makeMessage(a: string, nonce: string): string {
  // Minimal valid EIP-4361 message; parseSiweMessage must read address+nonce out of it.
  return [
    "primecompute.vercel.app wants you to sign in with your Ethereum account:",
    a,
    "",
    "Sign in to Prime Compute",
    "",
    "URI: https://primecompute.vercel.app",
    "Version: 1",
    "Chain ID: 5042002",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now).toISOString()}`,
  ].join("\n");
}

describe("siweLogin bridge", () => {
  const address = "0x52908400098527886E0F7030069857D2E4169EE7"; // EIP-55 valid
  const deps = (ok: boolean): SiweLoginDeps => ({
    verify: async () => ok,
    mint: async (input) => {
      expect(input.address).toBe(address.toLowerCase());
      return { access_token: "at", refresh_token: "rt" };
    },
  });
  const o = { secret: "test-secret", now };

  test("valid signature mints a session for the lower-cased address", async () => {
    const nonce = issueLoginNonce(address, o);
    const r = await siweLogin(deps(true), { message: makeMessage(address, nonce), signature: "0xsig" }, o);
    expect(r).toEqual({ access_token: "at", refresh_token: "rt" });
  });

  test("bad signature throws with the address named", async () => {
    const nonce = issueLoginNonce(address, o);
    await expect(
      siweLogin(deps(false), { message: makeMessage(address, nonce), signature: "0xsig" }, o),
    ).rejects.toThrow(/signature didn't verify/);
  });

  test("nonce for another address throws", async () => {
    const nonce = issueLoginNonce("0x" + "1".repeat(40), o);
    await expect(
      siweLogin(deps(true), { message: makeMessage(address, nonce), signature: "0xsig" }, o),
    ).rejects.toThrow(/nonce/);
  });

  test("sanity: viem parses the test message", () => {
    const nonce = issueLoginNonce(address, o);
    const parsed = parseSiweMessage(makeMessage(address, nonce));
    expect(parsed.address).toBe(address);
    expect(parsed.nonce).toBe(nonce);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test src/lib/auth/siwe.test.ts
```

Expected: FAIL (`siweLogin` not exported).

- [ ] **Step 3: Add to `src/lib/auth/siwe.ts`**

```ts
import { parseSiweMessage } from "viem/siwe";

export type SiweLoginDeps = {
  verify(input: { message: string; signature: `0x${string}`; address: `0x${string}` }): Promise<boolean>;
  mint(input: { address: string; walletId: string }): Promise<{ access_token: string; refresh_token: string }>;
};

// Verify a SIWE login end to end: parse -> nonce check -> signature verify -> session mint.
// Every failure names its cause (the "sign-in failed" outage taught us that lesson).
export async function siweLogin(
  deps: SiweLoginDeps,
  input: { message: string; signature: `0x${string}` | string },
  opts?: Opts,
): Promise<{ access_token: string; refresh_token: string }> {
  const parsed = parseSiweMessage(input.message);
  if (!parsed.address) throw new Error("SIWE message has no address");
  if (!parsed.nonce || !checkLoginNonce(parsed.nonce, parsed.address, opts)) {
    throw new Error("login nonce is invalid or expired — request a new one and try again");
  }
  const ok = await deps.verify({
    message: input.message,
    signature: input.signature as `0x${string}`,
    address: parsed.address,
  });
  if (!ok) throw new Error(`signature didn't verify for ${parsed.address}`);
  const address = parsed.address.toLowerCase();
  return deps.mint({ address, walletId: address });
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/lib/auth/siwe.test.ts
```

Expected: all pass (9 total).

- [ ] **Step 5: Create `src/lib/auth/siwe-fns.ts`** (thin wiring, no unit test)

```ts
// src/lib/auth/siwe-fns.ts
// Identity v3 server-fns: issue the SIWE nonce, verify the signed message, mint the session.
import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, http } from "viem";
import { issueLoginNonce, siweLogin } from "./siwe";
import { mintSessionForWallet } from "./mint-session";

export const getLoginNonce = createServerFn({ method: "POST" })
  .validator((d: { address: string }) => d)
  .handler(async ({ data }) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(data.address)) throw new Error("invalid address");
    return { nonce: issueLoginNonce(data.address) };
  });

export const completeSiweLogin = createServerFn({ method: "POST" })
  .validator((d: { message: string; signature: string }) => d)
  .handler(async ({ data }) => {
    // verifySiweMessage on a public client handles EOAs and ERC-6492 smart accounts alike.
    const client = createPublicClient({ transport: http(process.env.ARC_RPC_URL) });
    return siweLogin(
      {
        verify: ({ message, signature }) => client.verifySiweMessage({ message, signature }),
        mint: (input) => mintSessionForWallet(input),
      },
      data,
    );
  });
```

- [ ] **Step 6: tsc + commit**

```bash
bunx tsc --noEmit
git add src/lib/auth/siwe.ts src/lib/auth/siwe.test.ts src/lib/auth/siwe-fns.ts
git commit -m "feat(identity): siwe login bridge + server fns"
```

---

### Task 4: onboarding rewrite

**Files:**
- Modify: `src/routes/onboarding.tsx` (full component replacement below; keep the route options — `validateSearch`, `beforeLoad`, the redirect `useEffect`, and the signed-in card exactly as they are)

- [ ] **Step 1: Replace imports and the ceremony**

Remove these imports:

```ts
import { getDeviceId, runEmailOtp, executeChallenge, type CircleSession } from "../lib/circle/user-sdk";
import { startEmailLogin, completeCircleLogin } from "../lib/auth/circle-fns";
```

Add:

```ts
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "../lib/wallet-connect/config";
import { getLoginNonce, completeSiweLogin } from "../lib/auth/siwe-fns";
```

Replace the `Step` type, `LADDER`, and `run()`:

```tsx
type Step = "connect" | "prove" | "verifying" | "ready" | "error";

const LADDER: { key: Step; label: string }[] = [
  { key: "connect", label: "Connect wallet" },
  { key: "prove", label: "Prove ownership" },
  { key: "ready", label: "Authenticated" },
];

// inside Onboarding():
const { address, isConnected } = useAccount();
const { signMessageAsync } = useSignMessage();

async function run() {
  if (!address) return;
  setError(null);
  setBusy(true);
  try {
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
```

Replace the email input + button block in the JSX with:

```tsx
<div className="mt-8 flex flex-col items-center gap-3">
  <ConnectButton showBalance={false} chainStatus="icon" />
  {isConnected && step === "error" && (
    <button
      onClick={run}
      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Try signing in again
    </button>
  )}
  {busy && <p className="text-xs text-muted-foreground">Check your wallet…</p>}
</div>
```

Update `currentIndex` for the new steps:

```ts
function currentIndex(step: Step): number {
  if (step === "connect" || step === "error") return 0;
  if (step === "prove" || step === "verifying") return 1;
  return 2; // ready
}
```

Also update the intro copy: `Sign in with your wallet. Your address is your identity; a signature proves it.`

- [ ] **Step 2: Verify in the browser preview**

```bash
# dev server on :8080, then check /onboarding SSRs and hydrates without console errors
```

Use the preview tools: load `http://localhost:8080/onboarding`, confirm the ConnectButton renders and the console is clean. (Full wallet click-through is the user's browser handoff at the end.)

- [ ] **Step 3: tsc + commit**

```bash
bunx tsc --noEmit
git add src/routes/onboarding.tsx
git commit -m "feat(identity): onboarding connects a wallet and signs in with siwe"
```

---

### Task 5: WalletSheet funds from the connected wallet

**Files:**
- Modify: `src/components/site/WalletSheet.tsx`

- [ ] **Step 1: Swap the treasury flow for a wagmi transfer**

Remove these imports and everything that uses them (`getTreasuryBalance`, `treasuryTransferChallenge`, `loadCircleSession`, `executeChallenge`, the `treasury` query, and the whole `TreasuryTransferFlow` component):

```ts
import { getTreasuryBalance, treasuryTransferChallenge } from "@/lib/auth/circle-fns";
import { loadCircleSession, executeChallenge } from "@/lib/circle/user-sdk";
```

Add:

```ts
import { erc20Abi, parseUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { usdcAddress } from "@/lib/wallet-connect/config";
```

Replace the "Treasury (Circle wallet)" `AddressRow` with the connected wallet (the identity anchor from the session — same address the user connected):

```tsx
<AddressRow
  label="Your wallet"
  hint="identity + funding source"
  address={walletAddress ?? "…"}
/>
```

Replace `<TreasuryTransferFlow …/>` with `<FundSpendWalletFlow spendWalletAddress={data?.address} />` and add:

```tsx
/* Fund the spend wallet straight from the connected wallet: a plain USDC transfer the
   wallet itself confirms. USDC has 6 decimals on Arc. */
function FundSpendWalletFlow({ spendWalletAddress }: { spendWalletAddress: string | undefined }) {
  const queryClient = useQueryClient();
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
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
          <Label className="text-xs">Amount (USDC)</Label>
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
```

Also update the `useSession()` comment on line 48: the wallet is now the connected external wallet, not "the modular (passkey) wallet".

- [ ] **Step 2: tsc + commit**

```bash
bunx tsc --noEmit
git add src/components/site/WalletSheet.tsx
git commit -m "feat(identity): fund the spend wallet straight from the connected wallet"
```

---

### Task 6: rip out the Circle user-controlled path (and the polyfills it forced)

**Files:**
- Delete: `src/lib/circle/user-sdk.ts`, `src/lib/auth/circle-fns.ts`, `src/lib/auth/circle-bridge.ts`, `src/lib/auth/circle-bridge.test.ts`
- Modify: `package.json` (drop `@circle-fin/w3s-pw-web-sdk`, drop `vite-plugin-node-polyfills`)
- Modify: `vite.config.ts` (delete `clientOnlyNodePolyfills` and its call; KEEP `ssr.noExternal`)
- Maybe delete: `services/src/wallet/circle-user.ts` + its test (only if the sweep shows no remaining importer)

- [ ] **Step 1: Delete the files and deps**

```bash
git rm src/lib/circle/user-sdk.ts src/lib/auth/circle-fns.ts src/lib/auth/circle-bridge.ts src/lib/auth/circle-bridge.test.ts
bun remove @circle-fin/w3s-pw-web-sdk vite-plugin-node-polyfills
```

- [ ] **Step 2: Clean `vite.config.ts`**

Delete the `import { nodePolyfills } ...` line, the whole `clientOnlyNodePolyfills` function (comment block included), and the `...clientOnlyNodePolyfills(),` entry in `plugins`. Keep the `ssr.noExternal` block and its comment (other services deps still pull the axios/CJS chain into SSR — verify in Step 5's build).

- [ ] **Step 3: Sweep exhaustively** (per the terminology-sweep rule — every form, whole tree)

```bash
grep -rn "w3s-pw-web-sdk\|user-sdk\|circle-fns\|circle-bridge\|userToken\|CircleSession\|loadCircleSession\|executeChallenge\|VITE_CIRCLE_APP_ID\|treasuryTransferChallenge\|getTreasuryBalance\|CircleUserGate\|circle-user" \
  src services/src docs README.md .env.example services/.env.example mcp 2>/dev/null | grep -v node_modules
```

For each hit: dead import → remove; docs/copy still describing email/PIN login → rewrite to wallet login; `circle-user.ts` importers — if the ONLY importers were the deleted `circle-fns.ts`, also `git rm services/src/wallet/circle-user.ts services/src/wallet/circle-user.test.ts` (check the test filename with `ls services/src/wallet/`). `WALLET_BACKEND`/`circle.ts` (dev-controlled custody) are a DIFFERENT subsystem — do not touch.

- [ ] **Step 4: Check `mint-session.ts` circleUserId param**

`mintSessionForWallet`'s optional `circleUserId` input and the `profiles.circle_user_id` stamp become dead code — remove the parameter and the update block (the column stays in the DB; no migration).

- [ ] **Step 5: Full gates**

```bash
bun test src
bunx tsc --noEmit
bun run build
python3 -c "
import glob
bad = [f for f in glob.glob('.output/public/assets/*.js') if 'polyfill' in open(f, encoding='utf8', errors='replace').read()]
print('polyfill refs in client bundle:', bad or 'none')
"
```

Expected: tests pass, tsc clean, build green, `none`. If the build now fails on the SSR CJS externals differently (the polyfill plugin's removal changes resolution), adjust `ssr.noExternal` — do not reintroduce the polyfills.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(identity): retire the circle email/PIN login path

The wallet is the login now, so the user-controlled web sdk goes, and with it
the entire node-polyfill apparatus in vite.config.ts that existed only to make
that sdk load in the browser."
```

---

### Task 7: end-to-end verification + deploy

**Files:** none (verification only)

- [ ] **Step 1: Full local gates once more**

```bash
bun test src && bunx tsc --noEmit && bun run build
```

- [ ] **Step 2: Browser preview pass**

Dev server up; check `/onboarding` (ConnectButton renders, console clean), `/dashboard` (redirects signed-out), `/` (renders). Screenshot for the user.

- [ ] **Step 3: Push to deploy**

```bash
git push origin main
```

Vercel auto-builds. Then confirm production: `/onboarding` 200 + clean console via the browser tools.

- [ ] **Step 4: Hand off the wallet click-through**

Ask the user to: connect a real wallet on `primecompute.vercel.app/onboarding` (approve the Arc chain add), sign the SIWE message, confirm they land authenticated, then fund the spend wallet from the sheet with a small USDC amount. Wallet extensions can't be driven headless, so this step is theirs.

---

## Self-review notes

- Spec coverage: flow (T1–T4), funding (T5), deletions + sweep (T6), env (T1 + already-set Vercel vars), error copy (T4/T5), tests (T2/T3), gates + handoff (T7). `getTreasuryBalance` removal covered by T5+T6.
- Types: `siweLogin` deps' `mint` matches `mintSessionForWallet({address, walletId})` after T6 Step 4 removes `circleUserId`. Nonce fns take `Opts` consistently.
- The `VITE_USDC_ADDRESS`/`VITE_WALLETCONNECT_PROJECT_ID` Vercel env: `VITE_WALLETCONNECT_PROJECT_ID` is already set (both envs); `VITE_USDC_ADDRESS` must be added before the deploy in T7 — do it in T1 Step 2:
  `printf '<value>' | npx vercel env add VITE_USDC_ADDRESS production --force` (and preview).
