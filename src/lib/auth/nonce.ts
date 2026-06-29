import { createHmac } from "node:crypto";

const TTL_MS = 5 * 60_000;
type Opts = { secret?: string; now?: number };
const secretOf = (o?: Opts) => o?.secret ?? process.env.AUTH_NONCE_SECRET!;
const nowOf = (o?: Opts) => o?.now ?? Date.now();

// nonce = `${address}.${ts}.${random}.${hmac}` — the signed message the wallet must sign is the
// whole `${address}.${ts}.${random}` prefix, so the signature is bound to this exact challenge.
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueNonce(address: string, opts?: Opts): string {
  const payload = `${address.toLowerCase()}.${nowOf(opts)}.${crypto.randomUUID()}`;
  return `${payload}.${sign(payload, secretOf(opts))}`;
}

export function verifyNonce(nonce: string, address: string, opts?: Opts): { ok: boolean } {
  const i = nonce.lastIndexOf(".");
  if (i < 0) return { ok: false };
  const payload = nonce.slice(0, i);
  const mac = nonce.slice(i + 1);
  if (sign(payload, secretOf(opts)) !== mac) return { ok: false };
  const [addr, tsStr] = payload.split(".");
  if (!addr || addr !== address.toLowerCase()) return { ok: false };
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || nowOf(opts) - ts > TTL_MS) return { ok: false };
  return { ok: true };
}

// The exact string the wallet signs to prove control of `address` for this challenge.
export function nonceMessage(nonce: string): string {
  return nonce.slice(0, nonce.lastIndexOf("."));
}
