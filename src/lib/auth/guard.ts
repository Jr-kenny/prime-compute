import { redirect } from "@tanstack/react-router";
import { supabaseBrowser } from "../supabase/client";

/**
 * TanStack Router beforeLoad hook — checks Supabase session.
 *
 * Uses the browser client (reads from localStorage where Supabase stores
 * the session after `setSession` is called during onboarding). On SSR,
 * this calls through to the same client — which reads from the in-memory
 * Supabase store (empty during SSR since localStorage doesn't exist).
 *
 * Either way: if no session is found, redirect to /onboarding, carrying the page the user was
 * trying to reach as a `redirect` search param so onboarding can send them straight back once
 * they've signed in.
 *
 * Usage: beforeLoad: authGuard
 */
export async function authGuard({ location }: { location: { href: string } }) {
  const { data } = await supabaseBrowser.auth.getSession();

  if (!data.session) {
    throw redirect({ to: "/onboarding", search: { redirect: location.href } });
  }
}