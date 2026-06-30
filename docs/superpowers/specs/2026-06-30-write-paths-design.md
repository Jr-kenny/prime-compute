# Write paths: provider registration, rent creation, pause/resume/cancel — Design

**Status:** approved (brainstormed 2026-06-30). Next: implementation plan via writing-plans.

**One-line contract:** Every write the frontend performs goes through the real `services/`
registry with server-verified identity; nothing simulates persistence client-side anymore.

This is the direct continuation of the live-data read-path work. That PR proved every read comes
from the registry; this one proves every write does too, scoped to exactly four things: provider
registration, rent creation, pause/resume/cancel, and removing the simulated state those three
flows left behind.

---

## Scope

**In scope:** `register.tsx`'s "List your server" wizard actually persists a provider.
`marketplace.index.tsx`'s `RentSheet` actually creates a rent. `dashboard.tsx`'s Pause/Resume/Stop
buttons actually mutate a rent's status, with the server as the authority on which transitions are
legal. All five "my X" server functions (the two reads from the prior PR, the three writes added
here) share one verified-identity model.

**Out of scope:** anything beyond those three flows. No always-on broker service, no payment
rails, no provider-side benchmarking. The system stays exactly as capable as it is today; this PR
just stops lying about what already happens versus what's simulated.

---

## 1. Server-side identity verification

New `src/lib/auth/require-user.ts`:

```ts
import { supabaseAdmin } from "../supabase/server";

export async function requireUser(accessToken: string): Promise<{ id: string; walletAddress: string }> {
  const { data, error } = await supabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) throw new Error("invalid or expired session");

  const walletAddress = data.user.user_metadata?.wallet_address as string | undefined;
  if (!walletAddress) throw new Error("authenticated user has no wallet_address in metadata");

  return { id: data.user.id, walletAddress };
}
```

Every server function that creates, mutates, or reveals private data takes `accessToken` instead
of a trusted `userId`/`ownerWallet`. If `wallet_address` is missing from the verified user's
metadata, `requireUser` fails closed immediately, no caller can register a provider (or do
anything else) with an undefined owner. This retrofits the two existing read functions
(`listMyRents`, `listMyProviders`) from the prior PR, which currently trust a client-supplied
parameter, so all five "my X" functions share one identity model.

---

## 2. Centralized rent transition rules

New `services/src/rent-transitions.ts` (pure functions, no I/O, additive to the domain layer the
same way `trust/trust.ts` already is):

```ts
import type { Rent, RentStatus } from "./domain";

const NON_TERMINAL: RentStatus[] = ["queued", "running", "paused"];

export function canPause(rent: Rent): boolean {
  return rent.status === "running";
}

export function canResume(rent: Rent): boolean {
  return rent.status === "paused";
}

export function canCancel(rent: Rent): boolean {
  return NON_TERMINAL.includes(rent.status);
}
```

This is the single source of truth for legal rent-status transitions. The server functions in
section 4 are the ones that *enforce* it (reject an illegal transition outright); the frontend
imports the same functions to decide whether to show a button as disabled, so the UI's mirroring
can never drift out of sync with what the server actually allows, there's only one place these
rules are written down.

---

## 3. `registerProvider`

New server fn in `src/lib/broker/server-fns.ts`:

```ts
export const registerProvider = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; provider: Omit<NewProvider, "ownerWallet" | "trust" | "online" | "avgLatencyMs" | "computeScore"> }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().registerProvider({
      ...data.provider,
      ownerWallet: user.walletAddress,
      trust: defaultTrust(),
      online: true,
      avgLatencyMs: 0,
    });
  });
```

`register.tsx` changes:
- Adds a required **Endpoint URL** field (step 1, alongside hardware), the broker needs a real
  address to route work to; nothing self-registered through this form is reachable without one.
- Drops **Always-on availability** and **Minimum job duration** entirely, neither has a backing
  column anywhere in the schema, persisting them would mean writing fields nobody reads.
- Replaces the "Connect wallet or authenticate" button and its "coming soon" dialog with the
  wallet address already known from the session, the user authenticated via passkey to reach this
  gated route, asking them to "connect" again was simulated state.
- Renames the local `form.pricePerSecond` field to `form.pricePerCharge` to finish the terminology
  cleanup the read-path PR didn't touch (it was a local form field, not a mock-data read, so it
  was out of scope then; it's directly in scope now that this form gets rewired).
- Submit calls `registerProvider` with `accessToken` from `supabaseBrowser.auth.getSession()`. The
  success screen shows the real created provider's id instead of just a confetti animation.

---

## 4. `createRent`

```ts
export const createRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; name: string; spec: RentSpec; estimatedUsage?: number | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().createRent({
      name: data.name,
      userId: user.id,
      spec: data.spec,
      estimatedUsage: data.estimatedUsage ?? null,
    });
  });
```

Per the agreed call: never bound to the clicked provider. `RentSheet`'s submit creates a `queued`,
unmatched rent, `spec.resourceType`/`spec.region` pre-filled from the card that was clicked, as a
hint for the broker, not a guarantee, matching how the broker already expects to find work. No
`preferredProviderId` or similar gets invented for this PR since the domain model doesn't have
one; queued and unmatched is the correct, complete behavior here. Success copy: "Rent queued. It
will be matched when the broker processes the queue." instead of the old false claim that a
payment stream opens immediately.

---

## 5. Pause / Resume / Cancel

Three server fns, each follows the same shape: verify the caller, fetch the rent, confirm
ownership, check the transition is legal via the section-2 helpers, then `updateRent`.

```ts
export const pauseRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const registry = getRegistry();
    const rent = await registry.getRent(data.rentId);
    if (!rent) throw new Error("rent not found");
    if (rent.userId !== user.id) throw new Error("not your rent");
    if (!canPause(rent)) throw new Error(`cannot pause a rent with status "${rent.status}"`);
    return registry.updateRent(data.rentId, { status: "paused" });
  });
```

`resumeRent` mirrors this with `canResume` / `status: "running"`. `cancelRent` mirrors it with
`canCancel` / `status: "cancelled", endedAt: new Date().toISOString()`. The ownership check
(`rent.userId !== user.id`) is what actually closes the gap: today nothing stops a client from
canceling a rent it doesn't own just by knowing the id.

`dashboard.tsx`'s `ActiveRentCard` drops its local `paused` `useState` entirely, pause state comes
from `rent.status`. Buttons call the mutation, then invalidate the `rents` query so the real
status drives the UI. Pause/Resume/Stop buttons use `canPause`/`canResume`/`canCancel` (imported
from `@services/rent-transitions`, the same functions the server enforces with) to decide their
own disabled state, convenience only, the server is what actually rejects an illegal transition if
a button were somehow clicked anyway. This also finally wires "Stop," which has never had an
`onClick` at all, not even in the original mock.

---

## Testing

- `services/src/rent-transitions.ts` gets a small unit test file covering each function's
  true/false cases against every `RentStatus` value, no I/O, fast, exhaustive.
- `requireUser` isn't unit-testable without a live Supabase session; covered by manual
  verification (an expired/garbage token gets rejected, a valid one round-trips the right id and
  wallet).
- Manual verification per flow: register a provider, confirm the row's `owner_wallet` matches the
  signed-in wallet; create a rent, confirm it's `queued`/unmatched; pause/resume/cancel a rent you
  own, confirm the dashboard reflects the real status after refetch; confirm pausing a `queued`
  rent (illegal transition) is rejected server-side even if attempted directly.

---

## Resulting PR shape

1. `requireUser` (fails closed on missing `wallet_address`).
2. `services/src/rent-transitions.ts` (`canPause`/`canResume`/`canCancel`) + unit tests.
3. Five server fns: `registerProvider`, `createRent`, `pauseRent`, `resumeRent`, `cancelRent`, plus
   retrofitting `listMyRents`/`listMyProviders` onto `requireUser`.
4. `register.tsx`: endpoint URL field, drop two fields with no backing column, drop the fake
   wallet-connect dialog, real submit.
5. `marketplace.index.tsx`: `RentSheet` submit creates a real rent, honest success copy.
6. `dashboard.tsx`: `ActiveRentCard` pause/resume/stop wired to real mutations, no local fake
   state.
7. Explicit acknowledgment (already in the read-path PR, unchanged here): there's no always-on
   broker process, a rent sits `queued` until something processes it.
