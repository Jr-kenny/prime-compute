import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

/* ---------- main shell ---------- */

export function WorkspaceShell({
  path,
  sidebar,
  status,
  children,
}: {
  /** URL path shown in the browser-bar (e.g. "/dashboard") */
  path: string;
  /** Page-specific sidebar content (sections + items) */
  sidebar: ReactNode;
  /** Page-specific status line content (spans) */
  status: ReactNode;
  /** The actual page content (tabs, cards, forms, etc.) */
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 md:py-8">
          <div className="rounded-2xl overflow-hidden border border-border/60 bg-[#0a0e1f] shadow-[0_0_60px_-20px_rgba(91,140,255,0.25)]">
            {/* Browser chrome (decorative) */}
            <div
              aria-hidden="true"
              className="flex items-center gap-1.5 px-4 py-3 border-b border-white/8 bg-white/2"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-[11px] text-white/40 font-mono">
                primecompute.app{path}
              </span>
            </div>

            {/* Body: sidebar + main */}
            <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-3 p-3 bg-[#050a18]">
              <nav
                aria-label="Workspace navigation"
                className="rounded-lg bg-[#0f1530] border border-white/5 p-3 order-2 lg:order-1"
              >
                {sidebar}
              </nav>

              <div className="rounded-lg border border-white/5 bg-[radial-gradient(circle_at_30%_30%,rgba(37,99,235,0.08),transparent_60%)_#0a0e1f] p-4 order-1 lg:order-2 min-h-[400px]">
                {children}
              </div>
            </div>

            {/* Status bar */}
            <div
              role="status"
              aria-live="polite"
              className="mx-3 mb-3 px-3 py-2.5 rounded-lg bg-primary/10 border border-primary/15 font-mono text-[11px] text-[#8aa3c7] flex items-center gap-2"
            >
              <span aria-hidden="true" className="text-[#7fffaf]">
                ▸
              </span>
              {status}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/* ---------- inline sub-components ---------- */

export function WorkspaceSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mb-2.5">{label}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

export function WorkspaceItem({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <div
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs ${
        active ? "bg-primary/20 text-white" : "text-[#8aa3c7]"
      }`}
    >
      <span aria-hidden="true">{active ? "●" : "○"}</span>
      <span>{label}</span>
    </div>
  );
}

export function JobItem({ name, provider }: { name: string; provider: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs text-[#cfe0ff]">
      <span className="flex items-center gap-2">
        <span className="text-[#7fffaf]">●</span>
        <span>{name}</span>
      </span>
      <span className="text-[10px] text-white/40">on {provider}</span>
    </div>
  );
}

export function WalletCard({
  balance,
  currency = "USDC",
  note,
}: {
  balance: string;
  currency?: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg bg-primary/8 border border-primary/15 p-3">
      <div className="text-[10px] text-white/40 uppercase tracking-wider">Balance</div>
      <div className="text-base text-[#7fffaf] font-mono mt-1">{balance}</div>
      <div className="text-[10px] text-white/40 mt-1">{note ?? `${currency} streaming`}</div>
    </div>
  );
}
