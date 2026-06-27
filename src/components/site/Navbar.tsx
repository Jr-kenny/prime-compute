import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X, Boxes, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { to: "/marketplace", label: "Marketplace" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/provider", label: "Provider" },
  { to: "/docs", label: "Docs" },
] as const;

export function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30 group-hover:ring-primary/60 transition">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="font-semibold tracking-tight text-white">
            Prime <span className="text-glow">Compute</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.to || pathname.startsWith(l.to + "/");
            return (
              <Link
                key={l.to}
                to={l.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md transition",
                  active ? "text-white bg-white/8" : "text-white/60 hover:text-white",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white/60 hover:text-white">
            <Wallet className="h-4 w-4" /> Connect Wallet
          </Button>
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_24px_-6px_color-mix(in_oklab,var(--color-glow)_60%,transparent)]"
          >
            Get Started
          </Button>
        </div>

        <button
          className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-white"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
          aria-controls="mobile-nav-panel"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div
          id="mobile-nav-panel"
          className="md:hidden border-t border-border/60 bg-surface/95 backdrop-blur-xl"
        >
          <div className="px-4 py-3 flex flex-col gap-1">
            {links.map((l) => {
              const active = pathname === l.to || pathname.startsWith(l.to + "/");
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "px-3 py-2 text-sm rounded-md",
                    active ? "text-white bg-white/8" : "text-white/70 hover:text-white",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
            <div className="pt-2 flex gap-2">
              <Button variant="ghost" size="sm" className="flex-1 text-white">
                <Wallet className="h-4 w-4" />
                Wallet
              </Button>
              <Button size="sm" className="flex-1 bg-primary text-primary-foreground">
                Get Started
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
