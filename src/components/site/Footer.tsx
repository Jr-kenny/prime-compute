import { Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 mt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid gap-8 md:grid-cols-3 items-center">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="font-semibold">Prime Compute</span>
        </Link>
        <nav className="flex justify-center gap-6 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/marketplace" className="hover:text-foreground">Marketplace</Link>
          <Link to="/dashboard" className="hover:text-foreground">Dashboard</Link>
          <Link to="/docs" className="hover:text-foreground">Docs</Link>
        </nav>
        <p className="text-sm text-muted-foreground md:text-right">Powered by Circle Payments</p>
      </div>
      <div className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Prime Compute. Streaming nanopayments for the open compute layer.
      </div>
    </footer>
  );
}