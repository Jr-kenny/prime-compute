import { Link, useRouterState } from "@tanstack/react-router";
import { Boxes, LayoutDashboard, Store, Server, BookOpen, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LumenSidebarEntry } from "./LumenOverlay";

/** Primary navigation shared across the desktop sidebar and mobile tab bar. */
export const navLinks = [
  { to: "/marketplace", label: "Marketplace", icon: Store },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/provider", label: "Provider", icon: Server },
  { to: "/docs", label: "Docs", icon: BookOpen },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2 group">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30 group-hover:ring-primary/60 transition">
        <Boxes className="h-4 w-4" />
      </span>
      {!compact && (
        <span className="font-semibold tracking-tight text-white">
          Prime <span className="text-glow">Compute</span>
        </span>
      )}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Desktop sidebar                                                            */
/* -------------------------------------------------------------------------- */

export function Sidebar({ onOpenLumen }: { onOpenLumen?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col sticky top-0 h-screen border-r border-sidebar-border bg-sidebar">
      <div className="h-16 flex items-center px-5 border-b border-sidebar-border">
        <Brand />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1" aria-label="Primary">
        {navLinks.map((l) => {
          const active = pathname === l.to || pathname.startsWith(l.to + "/");
          const Icon = l.icon;
          return (
            <Link
              key={l.to}
              to={l.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                active
                  ? "bg-sidebar-accent text-white ring-1 ring-inset ring-primary/30"
                  : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/5",
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", active && "text-glow")} />
              <span>{l.label}</span>
            </Link>
          );
        })}

        {/* Lumen AI assistant entry */}
        {onOpenLumen && (
          <div className="mt-2 pt-2 border-t border-sidebar-border/50">
            <LumenSidebarEntry onClick={onOpenLumen} />
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/70 hover:text-white"
        >
          <Wallet className="h-4 w-4" />
          Connect Wallet
        </Button>
        <Button
          asChild
          size="sm"
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_24px_-6px_color-mix(in_oklab,var(--color-glow)_60%,transparent)]"
        >
          <Link to="/onboarding" search={{ redirect: pathname }}>
            Get Started
          </Link>
        </Button>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile: slim top bar (logo + connect)                                      */
/* -------------------------------------------------------------------------- */

export function MobileTopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="md:hidden sticky top-0 z-40 h-14 flex items-center justify-between px-4 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <Brand compact />
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="text-white/70 hover:text-white px-2">
          <Wallet className="h-4 w-4" />
          Connect
        </Button>
        <Button asChild size="sm" className="bg-primary text-primary-foreground">
          <Link to="/onboarding" search={{ redirect: pathname }}>
            Start
          </Link>
        </Button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile: bottom tab bar                                                     */
/* -------------------------------------------------------------------------- */

export function BottomTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-border/60 bg-background/90 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {navLinks.map((l) => {
        const active = pathname === l.to || pathname.startsWith(l.to + "/");
        const Icon = l.icon;
        return (
          <Link
            key={l.to}
            to={l.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition",
              active ? "text-white" : "text-white/55",
            )}
          >
            <Icon className={cn("h-5 w-5", active && "text-glow")} />
            <span>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
