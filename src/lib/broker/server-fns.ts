import { createServerFn } from "@tanstack/react-start";
import { getRegistry } from "./registry";

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
  .validator((d: { userId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ userId: data.userId }));

export const listMyProviders = createServerFn({ method: "GET", strict: { output: false } })
  .validator((d: { ownerWallet: string }) => d)
  .handler(async ({ data }) => getRegistry().listProviders({ ownerWallet: data.ownerWallet }));

export const listProviderRents = createServerFn({ method: "GET" })
  .validator((d: { providerId: string }) => d)
  .handler(async ({ data }) => getRegistry().listRents({ providerId: data.providerId }));
