# Auth Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate dashboard, provider dashboard, register, and the "Deploy" action behind auth — redirecting anonymous users to `/onboarding`. Keep the marketplace and landing page publicly browsable.

**Architecture:** Add a lightweight TanStack Router `beforeLoad` auth guard that checks Supabase's persisted session (localStorage, <1ms) and redirects to `/onboarding` with `throw redirect`. Apply it to `/dashboard`, `/provider`, `/register`. For the marketplace "Deploy" flow, intercept the deploy button click and check auth before showing the deploy sheet.

**Tech Stack:** TanStack React Start, Supabase Browser SDK, TanStack Router `beforeLoad` / `redirect`

---

### File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/auth/guard.ts` | **Create** | Reusable `beforeLoad` function + `checkSession()` helper for inline use |
| `src/routes/dashboard.tsx` | **Edit** | Add `beforeLoad: authGuard` |
| `src/routes/provider.tsx` | **Edit** | Add `beforeLoad: authGuard` |
| `src/routes/register.tsx` | **Edit** | Add `beforeLoad: authGuard` |
| `src/routes/marketplace.tsx` | **No change** | Layout stays public |
| `src/routes/marketplace.index.tsx` | **No change** | Stays public |
| `src/routes/marketplace.$id.tsx` | **No change** | Stays public |
| `src/routes/onboarding.tsx` | **No change** | Already has full passkey + auth flow |

---

### Task 1: Auth Guard

**Files:**
- Create: `src/lib/auth/guard.ts`

```ts
import { redirect } from "@tanstack/react-router";
import { supabaseBrowser } from "../lib/supabase/client";

/**
 * TanStack Router beforeLoad hook. Checks Supabase session (persisted in
 * localStorage, no network call) and redirects to /onboarding if absent.
 *
 * Usage: beforeLoad: authGuard
 */
export async function authGuard() {
  const { data } = await supabaseBrowser.auth.getSession();

  if (!data.session) {
    throw redirect({ to: "/onboarding" });
  }
}
```

### Task 2: Dashboard auth gate

**File:** `src/routes/dashboard.tsx` (lines 1–5, around the `Route` definition)

**Change:** Add `beforeLoad: authGuard` to the route.

```tsx
import { authGuard } from "../lib/auth/guard";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: authGuard,
  // ... rest stays the same
  head: () => ({
    meta: [
      { title: "Consumer Dashboard — Prime Compute" },
      { name: "description", content: "Monitor your active jobs, history, and streaming spend." },
    ],
  }),
  component: Dashboard,
});
```

### Task 3: Provider dashboard auth gate

**File:** `src/routes/provider.tsx`

**Change:** Add `beforeLoad: authGuard` to the route.

```tsx
import { authGuard } from "../lib/auth/guard";

export const Route = createFileRoute("/provider")({
  beforeLoad: authGuard,
  // ... rest stays the same
  head: () => ({
    meta: [
      { title: "Provider Dashboard — Prime Compute" },
      { name: "description", content: "Manage your servers, jobs, and earnings as a Prime Compute provider." },
    ],
  }),
  component: ProviderDash,
});
```

### Task 4: Register auth gate

**File:** `src/routes/register.tsx`

**Change:** Add `beforeLoad: authGuard` to the route.

```tsx
import { authGuard } from "../lib/auth/guard";

export const Route = createFileRoute("/register")({
  beforeLoad: authGuard,
  // ... rest stays the same
  head: () => ({
    meta: [
      { title: "List Your Server — Prime Compute" },
      { name: "description", content: "Register idle hardware on Prime Compute and earn streaming USDC per millisecond." },
    ],
  }),
  component: Register,
});
```

### Task 5: Marketplace deploy sheet auth check

**File:** `src/routes/marketplace.index.tsx`

**Change:** In the `DeploySheet` component's `submit` function, check session before showing the sheet. Also in the `ProviderCard` "Deploy" button callback.

When an anonymous user clicks a provider's "Deploy" button in the provider card, instead of opening the deploy sheet, navigate to `/onboarding`.

```tsx
// In the provider card's "Deploy" button click handler
function onDeployClick() {
  supabaseBrowser.auth.getSession().then(({ data }) => {
    if (!data.session) {
      // redirect to /onboarding
      window.location.href = "/onboarding";
      return;
    }
    // Open the deploy sheet
    setDeployFor(provider);
  });
}
```

Or better — use TanStack Router's `navigate`:

```tsx
import { useRouter } from "@tanstack/react-router";
const router = useRouter();
// In click handler:
router.navigate({ to: "/onboarding" });
```

### Verification

After each task:
- `beforeLoad` runs on route entry → check supabaseBrowser auth.getSession()
- If no session → `redirect` → URL changes to `/onboarding`
- If session exists → component renders normally

Run: navigate to `/dashboard` without a session → should see `/onboarding` instead of dashboard
Run: navigate to `/provider` without a session → `/onboarding`
Run: navigate to `/register` without a session → `/onboarding`
Run: navigate to `/marketplace` without a session → still see marketplace (no gate)
Run: navigate to `/` → landing page (no gate)

### Edge Cases

1. **Supabase session is expired / invalid** → `getSession()` returns `null` → redirect works
2. **SSR navigation** → TanStack Start handles `beforeLoad` on server too
3. **Already on `/onboarding`** → no infinite redirect loop (no guard on that route)
4. **After successful onboarding** → supabase sets session in localStorage → subsequent navigation to gated routes works