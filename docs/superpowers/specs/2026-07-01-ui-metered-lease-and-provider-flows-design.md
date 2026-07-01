# UI: metered-lease + provider flows

**Goal:** Make the frontend honestly surface the two flows the metering worker now makes real: listing a
server (adding a service) and renting one. The UI never predicts state, it only renders what the backend
reports. `createRent` creates the lease, the worker advances it and meters billing, React Query reflects
that truth, and the rent sheet purely displays the current state.

This follows the metering worker (`plans/2026-06-30-metering-worker.md`, merged): leases are created
`queued`, the worker provisions them to `running` (minting a `leaseAccessToken`), meters real USDC charges,
and can move a lease to `suspended` on a balance stall. The dashboard rent sheet already shows connect
credentials + real charged cost on a running lease; this spec brings the *creation* and *provider-listing*
surfaces up to the same standard.

## The gaps

1. **Adding a service is unreachable in-app.** `/register` (list a server) is fully wired to the real
   `registerProvider` server-fn, but it's only linked from the public landing page (`index.tsx`). The
   authenticated app shell (Sidebar: Marketplace / Dashboard / Provider) has no entry, and the Provider
   dashboard has no "add a server" action.
2. **Renting is half-wired and dishonest about the lifecycle.** The marketplace *index* has a working
   `RentSheet` that calls the real `createRent`, but it ends in a confetti "done" screen that implies the
   rent is instantly live. The marketplace *detail* page (`marketplace.$id.tsx:70`) has a **dead "Rent"
   button** with no handler. Neither reflects that a rent starts `queued` and only becomes `running` (with
   connect credentials + real metered cost) once the worker provisions it.

## Design

### Adding a service
- Add a **"List a server"** item to the Sidebar (`src/components/site/Sidebar.tsx`), next to Marketplace /
  Dashboard / Provider, linking to `/register` (same auth guard `/register` already enforces).
- Add a primary **"List a server"** button on the Provider dashboard (`provider.tsx`) header, and surface it
  in the zero-servers empty state so the first action is obvious.
- No change to `register.tsx` itself.

### Renting a service (live, honest)
- **Extract** the working `RentSheet` from `marketplace.index.tsx` into a shared
  `src/components/site/RentSheet.tsx`. One rent flow, one place to reason about it. The marketplace grid and
  the detail page both use it.
- **Wire** the dead "Rent" button on `marketplace.$id.tsx` to open the shared `RentSheet` for that provider.
- After `createRent` returns the created rent, the sheet switches from a form to a **live tracking view** that
  polls the lease and renders its real phase. No confetti-as-truth.

### Data flow
- `RentSheet.submit()` calls the existing `createRent` server-fn (which returns the created rent). Immediately
  seed the cache so the tracking view renders with no wait:
  ```ts
  queryClient.setQueryData(["rent", rent.id], rent);
  ```
- Track with `useQuery(["rent", rentId], () => getMyRent({ data: { accessToken, rentId } }))`, using a
  **dynamic, self-stopping** poll:
  ```ts
  refetchInterval: (query) => {
    const rent = query.state.data;
    if (!rent) return 5000;
    switch (rent.status) {
      case "queued":
      case "running":
      case "suspended":
        return 3000;
      default:
        return false; // terminal: completed / cancelled / failed
    }
  }
  ```
  Polling stops on terminal states through the return value alone, no extra effects.
- New owner-scoped server-fn **`getMyRent(accessToken, rentId)`** in `src/lib/broker/server-fns.ts`: verifies
  the caller owns the rent (via `requireUser`), returns the single `Rent` or `null`. Reads one lease per tick
  instead of the whole list.
- Connect credentials come straight off the polled rent (`leaseAccessToken`) and its provider (`endpointUrl`),
  identical to the dashboard sheet. No duplicate API.
- **The worker is the only thing that advances state.** If it isn't running (e.g. local dev without
  `bun run worker`), the lease honestly sits at `queued` and the sheet says so. The frontend never simulates
  progress.

### Phase model (declarative rendering)
A pure `rentPhase(rent, provider)` helper returns a display object so the sheet JSX has no scattered branching:
```ts
{
  phase: "queued" | "running" | "suspended" | "completed" | "failed" | "cancelled",
  title: string,        // e.g. "Waiting for a provider"
  description: string,
  canConnect: boolean,  // running AND leaseAccessToken present AND provider resolves
  terminal: boolean,
}
```
The sheet becomes:
```tsx
const phase = rentPhase(rent, provider);
<StatusTitle>{phase.title}</StatusTitle>
<Text>{phase.description}</Text>
{phase.canConnect && <ConnectInfo endpoint={provider.endpointUrl} token={rent.leaseAccessToken} />}
```
Copy per phase: `queued` → matching a provider; `running` → connect creds + real charged-so-far
(`totalCost / 1e6`); `suspended` → balance stalled, top up to resume (pointer to the wallet); `failed` → the
reason (no provider matched); `completed`/`cancelled` → summary.

### Edge handling
- **Provider disappeared** (rent exists, provider deleted / endpoint gone): `canConnect` is false and the
  connect area shows "Cannot connect / Provider unavailable". The rent stays visible, because the rent still
  exists.
- **Signed-out rent attempt:** unchanged, redirects to `/onboarding` with a return path.
- **`getMyRent` for a missing or non-owned rent:** returns `null`; the sheet shows a neutral "couldn't load
  this rent" instead of throwing.
- **Sidebar "List a server":** same auth guard as `/register`.

## Testing
- **Unit:** `rentPhase(rent, provider)` is pure and covers every status plus the provider-gone case
  (`canConnect` false when the provider is absent even while `running`).
- **Type + build:** `tsc --noEmit` clean; Cloudflare-worker build green (the app deploys as a CF Worker).
- **Manual:** routes SSR server-side; the full passkey/WebAuthn click-through is a browser handoff (can't run
  headless), same as the wallet sheet.

## Ownership (why this stays deterministic)
- `createRent` → creates the lease.
- Worker → advances lease state and meters billing.
- React Query → reflects backend truth.
- `RentSheet` → purely renders the current state.

The frontend never predicts transitions; it only displays what the backend reports.

## Out of scope
- Realtime (Supabase subscriptions) for rents: polling is enough here; the realtime read path is its own
  sub-project.
- Any change to the metering worker, the registry, or `register.tsx`.
- Wallet top-up flow itself (the suspended copy just points at the existing wallet sheet).
