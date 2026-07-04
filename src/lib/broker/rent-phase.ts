// src/lib/broker/rent-phase.ts
import type { Rent, Provider, RentStatus } from "@services/domain";

// Display shape derived purely from backend truth. phase mirrors the real RentStatus (including
// paused) so the mapping stays exhaustive; the sheet renders from this, no branching in JSX.
export type RentPhase = {
  phase: RentStatus;
  title: string;
  description: string;
  canConnect: boolean; // running AND we have a token AND the provider resolves
  terminal: boolean;
};

const TERMINAL: RentStatus[] = ["completed", "cancelled", "failed"];

export function rentPhase(rent: Rent, provider: Provider | undefined): RentPhase {
  const terminal = TERMINAL.includes(rent.status);
  switch (rent.status) {
    case "queued": {
      const pinned = !!rent.spec.preferredProviderId;
      return {
        phase: "queued",
        title: pinned ? "Getting your provider ready" : "Waiting for a provider",
        description: pinned
          ? `Starting your rental on ${provider?.alias ?? "your provider"}. Billing starts once it's running.`
          : "The broker is matching your rent to a provider. Billing starts once it's running.",
        canConnect: false,
        terminal: false,
      };
    }
    case "running":
      return {
        phase: "running",
        title: "Running",
        description: provider
          ? "Your lease is live and metering real USDC as it runs."
          : "Your lease is live, but its provider is unavailable right now.",
        canConnect: !!rent.leaseAccessToken && !!provider,
        terminal: false,
      };
    case "paused":
      return {
        phase: "paused",
        title: "Paused",
        description: "You paused this rent. Resume it from the dashboard to continue.",
        canConnect: false,
        terminal: false,
      };
    case "suspended":
      return {
        phase: "suspended",
        title: "Paused",
        // The worker records why it suspended (a funding/gateway error, a spend cap, a lost
        // provider). Show that truth when we have it; only fall back to the balance guess when we don't.
        description: rent.statusReason
          ? `Billing paused: ${rent.statusReason}`
          : "Billing paused. Check your spend wallet and resume from the dashboard.",
        canConnect: false,
        terminal: false,
      };
    case "completed":
      return { phase: "completed", title: "Completed", description: "This rent finished and billing stopped.", canConnect: false, terminal };
    case "cancelled":
      return { phase: "cancelled", title: "Cancelled", description: "You stopped this rent.", canConnect: false, terminal };
    case "failed":
      return { phase: "failed", title: "Couldn't start", description: "No provider matched this rent's requirements.", canConnect: false, terminal };
  }
}
