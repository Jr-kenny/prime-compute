import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";
import { requireUser } from "../auth/require-user";
import { defaultTrust } from "@services/trust/trust";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { NewProvider, RentPatch } from "@services/registry/registry";
import type { Rent, RentSpec } from "@services/domain";
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

export const listMyRents = createServerFn({ method: "GET" })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().listRents({ userId: user.id });
  });

// One lease by id, but only if the caller owns it. Returns null (not a throw) for a missing or
// foreign rent so the poller can render a neutral "couldn't load" instead of erroring.
export const getMyRent = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string; rentId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    const rent = await getRegistry().getRent(data.rentId);
    if (!rent || rent.userId !== user.id) return null;
    return rent;
  });

export const listMyProviders = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { accessToken: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().listProviders({ ownerWallet: user.walletAddress });
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
    return getRegistry().registerProvider({
      ...data.provider,
      ownerWallet: user.walletAddress,
      trust: defaultTrust(),
      online: true,
      avgLatencyMs: 0,
    });
  });

export const createRent = createServerFn({ method: "POST" })
  .validator((d: { accessToken: string; name: string; spec: RentSpec; estimatedUsage?: number | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireUser(data.accessToken);
    return getRegistry().createRent({
      name: data.name,
      owner: { kind: "user", id: user.id, walletAddress: user.walletAddress },
      spec: data.spec,
      estimatedUsage: data.estimatedUsage ?? null,
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
  .handler(async ({ data }) =>
    transitionRent(data.accessToken, data.rentId, canCancel, "cancel", {
      status: "cancelled",
      endedAt: new Date().toISOString(),
    }),
  );

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
    let rentSummary: { count: number; rents: { name: string; status: string }[] } | undefined;
    if (data.accessToken) {
      try {
        const user = await requireUser(data.accessToken);
        const rents = await registry.listRents({ userId: user.id });
        signedIn = true;
        rentSummary = { count: rents.length, rents: rents.map((r) => ({ name: r.name, status: r.status })) };
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
