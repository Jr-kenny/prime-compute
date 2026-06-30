import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { useSession } from "@/lib/auth/session";
import { getSpendWalletBalance } from "@/lib/wallet/server-fns";

// Live spend-wallet balance. Polls so it visibly drops while the meter (plan 2) runs.
export function WalletBalance({ className = "" }: { className?: string }) {
  const { session } = useSession();
  const accessToken = session?.access_token;
  const { data } = useQuery({
    queryKey: ["spend-wallet", accessToken],
    queryFn: () => getSpendWalletBalance({ data: { accessToken: accessToken! } }),
    enabled: !!accessToken,
    refetchInterval: 5000,
  });
  if (!accessToken) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}>
      <Wallet className="h-4 w-4 text-glow" />
      {data ? `$${data.usdcFormatted} USDC` : "…"}
    </span>
  );
}
