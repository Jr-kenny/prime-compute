// src/lib/auth/siwe.ts
// Stateless HMAC login nonce for SIWE. EIP-4361 nonces must be alphanumeric (>=8 chars),
// so the format is hex-only: `${tsHex}${macHex}` where mac = HMAC-SHA256(secret,
// `${address}.${tsHex}`). No nonce table; the TTL bounds the replay window (Phase-0 posture).
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 5 * 60_000;
const MAC_HEX = 64; // sha256 hex length

type Opts = { secret?: string; now?: number };
const secretOf = (o?: Opts) => o?.secret ?? process.env.AUTH_NONCE_SECRET!;
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
