import { Link } from "@tanstack/react-router";
import { Boxes } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 mt-24 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 flex flex-wrap items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-glow ring-1 ring-primary/30">
            <Boxes className="h-4 w-4" />
          </span>
          <span className="font-semibold text-foreground">
            Prime <span className="text-glow">Compute</span>
          </span>
        </Link>
        <p className="text-sm text-muted-foreground">Powered by Circle Payments</p>
      </div>
      <div className="border-t border-border/40 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Prime Compute. Streaming nanopayments for the open compute
        layer.
      </div>
    </footer>
  );
}
