// src/lib/auth/siwe.ts
// Stateless HMAC login nonce for SIWE. EIP-4361 nonces must be alphanumeric (>=8 chars),
// so the format is hex-only: `${tsHex}${macHex}` where mac = HMAC-SHA256(secret,
// `${address}.${tsHex}`). No nonce table; the TTL bounds the replay window (Phase-0 posture).
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseSiweMessage } from "viem/siwe";

const TTL_MS = 5 * 60_000;
const MAC_HEX = 64; // sha256 hex length

type Opts = { secret?: string; now?: number };
const secretOf = (o?: Opts) => {
  const secret = o?.secret ?? process.env.AUTH_NONCE_SECRET;
  if (!secret) throw new Error("AUTH_NONCE_SECRET is not set — the login nonce can't be signed");
  return secret;
};
const nowOf = (o?: Opts) => o?.now ?? Date.now();

function mac(address: string, tsHex: string, secret: string): string {
  return createHmac("sha256", secret).update(`${address.toLowerCase()}.${tsHex}`).digest("hex");
}

export function issueLoginNonce(address: string, opts?: Opts): string {
  const tsHex = nowOf(opts).toString(16);
  return `${tsHex}${mac(address, tsHex, secretOf(opts))}`;
}

export function checkLoginNonce(nonce: string, address: string, opts?: Opts): boolean {
  if (!/^[a-f0-9]+$/.test(nonce) || nonce.length <= MAC_HEX) return false;
  const tsHex = nonce.slice(0, -MAC_HEX);
  const got = nonce.slice(-MAC_HEX);
  const want = mac(address, tsHex, secretOf(opts));
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return false;
  const ts = parseInt(tsHex, 16);
  return Number.isFinite(ts) && nowOf(opts) - ts <= TTL_MS;
}

export type SiweLoginDeps = {
  verify(input: { message: string; signature: `0x${string}`; address: `0x${string}` }): Promise<boolean>;
  mint(input: { address: string; walletId: string }): Promise<{ access_token: string; refresh_token: string }>;
};

// Verify a SIWE login end to end: parse -> nonce check -> signature verify -> session mint.
// Every failure names its cause (the "sign-in failed" outage taught us that lesson).
export async function siweLogin(
  deps: SiweLoginDeps,
  input: { message: string; signature: `0x${string}` | string },
  opts?: Opts,
): Promise<{ access_token: string; refresh_token: string }> {
  const parsed = parseSiweMessage(input.message);
  if (!parsed.address) throw new Error("SIWE message has no address");
  if (!parsed.nonce || !checkLoginNonce(parsed.nonce, parsed.address, opts)) {
    throw new Error("login nonce is invalid or expired — request a new one and try again");
  }
  const ok = await deps.verify({
    message: input.message,
    signature: input.signature as `0x${string}`,
    address: parsed.address,
  });
  if (!ok) throw new Error(`signature didn't verify for ${parsed.address}`);
  const address = parsed.address.toLowerCase();
  return deps.mint({ address, walletId: address });
}
