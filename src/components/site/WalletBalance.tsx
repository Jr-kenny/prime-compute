import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance } from "@/lib/wallet/server-fns";

// Live spend-wallet balance. Polls so it visibly drops while the meter (plan 2) runs.
// When `onClick` is passed it renders as a button (the dashboard uses this to open the
// wallet sheet); otherwise it's a plain display chip (Lumen header).
export function WalletBalance({
  className = "",
  onClick,
}: {
  className?: string;
  onClick?: () => void;
}) {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });
  if (!accessToken) return null;

  const label = data?.usdcFormatted != null ? `$${data.usdcFormatted} USDC` : "…";
  const inner = (
    <>
      <Wallet className="h-4 w-4 text-glow" />
      {label}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Open wallet"
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 font-mono text-sm transition hover:border-primary/40 hover:bg-primary/5 ${className}`}
      >
        {inner}
      </button>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}>{inner}</span>
  );
}
