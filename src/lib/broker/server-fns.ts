import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";
import { requireUser } from "../auth/require-user";
import { defaultTrust } from "@services/trust/trust";
import { canPause, canResume } from "@services/rent-transitions";
import type { NewProvider, RentPatch } from "@services/registry/registry";
import type { Principal, Rent, RentSpec } from "@services/domain";
import {
  createRentFor, listRentsFor, getRentFor, cancelRentFor, registerProviderFor, listMyProvidersFor,
  setProviderOnlineFor, delistProviderFor,
} from "@/lib/marketplace/service";
import { tallyRentsByProvider } from "@/lib/marketplace/rent-counts";
import { parseProviderBody } from "@/lib/agents/validate";

// Humans are just one principal type; resolve the session to a Principal and use the shared service.
function userPrincipal(user: { id: string; walletAddress: string }): Principal {
  return { kind: "user", id: user.id, walletAddress: user.walletAddress };
}
import { loadBrokerAgent } from "./agent";
import { decide, makeDecideClient, type DecideClient } from "@services/runtime/decide";
import type { DecisionContext } from "@services/runtime/types";
import { CHAT_ACTIONS, chatFallback, shapeChatResult, type ChatResult } from "./lumen-chat";

// `Provider.specs` is `Record<string, unknown>` (it's a jsonb column with no fixed shape), which
// is genuinely JSON-serializable at runtime but TanStack Start's static serializability check
// can't prove that for an `unknown`-valued index signature. `strict: { output: false }` skips
// that static check for these three; everything they return still goes over the wire as plain
// JSON the same as any other server function.
export const listProviders = createServerFn({ method: "GET", strict: { output: false } }).handler(async () => {
  return getRegistry().listProviders();
});

export const getProviderById = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => getRegistry().getProvider(data.id));

// Public: how many rents each provider has served, as a { providerId: count } map. Only the tally
// crosses the wire, never anyone's rent rows, so this is safe to call unauthenticated like listProviders.
export const getRentCountsByProvider = createServerFn({ method: "GET" }).handler(async () => {
  return tallyRentsByProvider(await getRegistry().listRents());
});

export const listMyRents = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return listRentsFor(getRegistry(), userPrincipal(user));
  });

// One lease by id, but only if the caller owns it. Returns null (not a throw) for a missing or
// foreign rent so the poller can render a neutral "couldn't load" instead of erroring.
export const getMyRent = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRentFor(getRegistry(), userPrincipal(user), data.rentId);
  });

export const listMyProviders = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return listMyProvidersFor(getRegistry(), userPrincipal(user));
  });

export const listProviderRents = createServerFn({ method: "GET" })
  .validator((d: { providerId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ providerId: data.providerId }));

// Everything registerProvider needs except what the server derives itself (ownerWallet) or
// defaults (trust, online, avgLatencyMs).
type NewProviderInput = Omit<NewProvider, "ownerWallet" | "trust" | "online" | "avgLatencyMs" | "computeScore">;

// `specs` (and therefore the whole `provider` input) carries the same unknown-valued index
// signature as the read side, so both input and output serializability checks need skipping here.
export const registerProvider = createServerFn({ method: "POST", strict: false })
  .validator((d: { accessToken: string; provider: NewProviderInput }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    // Same bouncer as the REST door: endpoint URL must be a real, public http(s) address (the
    // metering worker pays whatever this URL serves, so it can't be blank or point inward),
    // price must be positive, and specs must match the service type. The dashboard form used
    // to skip all of this, which let endpoint-less listings into the marketplace.
    const parsed = parseProviderBody(data.provider);
    if (!parsed.ok) throw new Error(parsed.message);
    return registerProviderFor(getRegistry(), userPrincipal(user), {
      ...parsed.value,
      trust: defaultTrust(),
      online: true,
      avgLatencyMs: 0,
    });
  });

export const setProviderOnline = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; providerId: string; online: boolean }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    await setProviderOnlineFor(getRegistry(), userPrincipal(user), data.providerId, data.online);
  });

export const delistProvider = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; providerId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    await delistProviderFor(getRegistry(), userPrincipal(user), data.providerId);
  });

export const createRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; name: string; spec: RentSpec; estimatedUsage?: number | null; maxSpendAtomic?: number | null; expiresAt?: string | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return createRentFor(getRegistry(), userPrincipal(user), {
      name: data.name,
      spec: data.spec,
      estimatedUsage: data.estimatedUsage ?? null,
      maxSpendAtomic: data.maxSpendAtomic ?? null,
      expiresAt: data.expiresAt ?? null,
    });
  });

async function transitionRent(
  accessToken: string,
  rentId: string,
  canTransition: (rent: Rent) => boolean,
  verb: string,
  patch: RentPatch,
) {
  const user = await requireUser(accessToken);
  const registry = getRegistry();
  const rent = await registry.getRent(rentId);
  if (!rent) throw new Error("rent not found");
  if (rent.userId !== user.id) throw new Error("not your rent");
  if (!canTransition(rent)) throw new Error(`cannot ${verb} a rent with status "${rent.status}"`);
  return registry.updateRent(rentId, patch);
}

export const pauseRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canPause, "pause", { status: "paused" }),
  );

export const resumeRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canResume, "resume", { status: "running" }),
  );

export const cancelRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return cancelRentFor(getRegistry(), userPrincipal(user), data.rentId);
  });

// Build the model client, or null if LLM_* isn't configured. makeDecideClient() throws
// eagerly on missing config (loadConfig throws), which would 500 the chat before decide()'s
// own fallback can engage — so a missing/broken model degrades to a deterministic answer.
function tryMakeDecideClient(): DecideClient | null {
  try {
    return makeDecideClient();
  } catch {
    return null;
  }
}

// One conversational turn, driven by the real broker soul + decide() runtime over real
// registry data. The model only proposes; the recommend_provider result is the user's to
// confirm, and creation still goes through the real createRent server-fn. Uses
// `strict: { output: false }` because the returned Provider carries the same unknown-valued
// `specs` jsonb index signature as the other provider-returning fns.
export const brokerChat = createServerFn({ method: "POST", strict: { output: false } })
  .validator((d: { accessToken?: string; message: string }) => d)
  .handler(async ({ data }): Promise<ChatResult> => {
    const registry = getRegistry();
    const { soul, policy } = loadBrokerAgent();
    const providers = await registry.listProviders();

    // Identity-bound context, only when a token actually verifies.
    let signedIn = false;
    let rentSummary:
      | {
          count: number;
          walletAddress: string;
          rents: {
            name: string;
            status: string;
            resourceType: string;
            region: string | null;
            providerId: string | null;
            totalCost: number;
            createdAt: string;
          }[];
        }
      | undefined;
    if (data.accessToken) {
      try {
        const user = await requireUser(data.accessToken);
        const rents = await registry.listRents({ userId: user.id });
        signedIn = true;
        rentSummary = {
          count: rents.length,
          walletAddress: user.walletAddress,
          rents: rents.map((r) => ({
            name: r.name,
            status: r.status,
            resourceType: r.spec.resourceType,
            region: r.spec.region,
            providerId: r.providerId,
            totalCost: r.totalCost,
            createdAt: r.createdAt,
          })),
        };
      } catch {
        signedIn = false; // invalid/expired token → treat as signed-out, never break the chat
      }
    }

    const context: DecisionContext = {
      objective: data.message,
      candidates: providers.map((p) => ({
        id: p.id,
        alias: p.alias,
        resourceType: p.resourceType,
        region: p.region,
        pricePerCharge: p.pricePerCharge,
        computeScore: p.computeScore,
        avgLatencyMs: p.avgLatencyMs,
        online: p.online,
        tier: p.trust.tier,
      })),
      telemetry: rentSummary,
      constraints: { signedIn },
    };

    const client = tryMakeDecideClient();
    const decision = client
      ? await decide({ soul, policy, context, actions: CHAT_ACTIONS, client, fallback: chatFallback })
      : { proposals: chatFallback(), soulVersion: soul.version, policyVersion: policy.version, decisionId: crypto.randomUUID(), usedFallback: true };

    return shapeChatResult(decision, providers);
  });
