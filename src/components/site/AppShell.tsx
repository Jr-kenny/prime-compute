import { useState } from "react";
import type { ReactNode } from "react";
import { Sidebar, MobileTopBar, BottomTabBar } from "./Sidebar";
import { Footer } from "./Footer";
import { LumenOverlay, LumenFab } from "./LumenOverlay";
import { WalletSheet } from "./WalletSheet";
import { useSession } from "@/lib/auth/session";

/**
 * App shell for the authenticated/product pages (marketplace, dashboard,
 * provider, docs). Renders a fixed left sidebar on desktop and a slim top bar
 * + bottom tab bar on mobile. The landing page and register page keep using
 * PageShell (no header) so the marketing hero stays full-bleed.
 *
 * Also mounts the Lumen AI assistant overlay, summonable from the sidebar
 * entry or the floating action button on every app page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [lumenOpen, setLumenOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const { session } = useSession();

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Desktop: fixed left sidebar */}
      <Sidebar onOpenLumen={() => setLumenOpen(true)} onOpenWallet={() => setWalletOpen(true)} />

      {/* Mobile: slim top bar (logo + connect) */}
      <MobileTopBar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Bottom padding on mobile so the fixed bottom tab bar never covers content */}
        <main className="flex-1 pb-16 md:pb-0">{children}</main>
        <Footer />
      </div>

      {/* Lumen AI assistant: floating button + overlay drawer */}
      <LumenFab onClick={() => setLumenOpen(true)} />
      <LumenOverlay open={lumenOpen} onOpenChange={setLumenOpen} />

      {/* Wallet sheet, summonable from the sidebar Wallet entry on every app page */}
      <WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} accessToken={session?.access_token} />

      {/* Mobile: fixed bottom tab bar */}
      <BottomTabBar />
    </div>
  );
}
