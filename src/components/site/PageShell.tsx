import type { ReactNode } from "react";
import { Footer } from "./Footer";

/**
 * Clean shell for marketing/flow pages (landing, register). No top navbar —
 * the landing hero's "Browse compute" CTA is the entry point into the app,
 * which uses AppShell (sidebar) instead. Footer remains for SEO/links.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
