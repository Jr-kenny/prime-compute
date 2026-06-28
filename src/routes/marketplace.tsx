import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/site/AppShell";

/**
 * Layout route for /marketplace. Renders the AppShell (sidebar + footer)
 * and yields to the index listing or the $id detail page via <Outlet />.
 *
 * - /marketplace        → marketplace.index.tsx (listing)
 * - /marketplace/:id    → marketplace.$id.tsx   (provider detail)
 */
export const Route = createFileRoute("/marketplace")({
  head: () => ({
    meta: [
      { title: "Compute Marketplace — Prime Compute" },
      {
        name: "description",
        content: "Browse live providers offering GPUs, CPUs, and storage with per-second pricing.",
      },
    ],
  }),
  component: MarketplaceLayout,
});

function MarketplaceLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
