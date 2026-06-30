import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";
import { requireUser } from "../auth/require-user";
import { defaultTrust } from "@services/trust/trust";
import { canPause, canResume, canCancel } from "@services/rent-transitions";
import type { NewProvider, RentPatch } from "@services/registry/registry";
import type { Rent, RentSpec } from "@services/domain";

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
      userId: user.id,
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
