// AES-256-GCM via Web Crypto so the SAME code runs in the Cloudflare Worker web
// runtime and the Bun metering worker. node:crypto is NOT available in CF Workers.
// SPEND_WALLET_ENC_KEY is a base64-encoded 32-byte key.

const enc = new TextEncoder();
const dec = new TextDecoder();

// The TS DOM lib types Web Crypto inputs as BufferSource over ArrayBuffer, while the
// newer Uint8Array is generic over ArrayBufferLike. A Uint8Array is a BufferSource at
// runtime, so this assertion just bridges that lib mismatch.
const bufferSource = (u: Uint8Array): BufferSource => u as BufferSource;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = b64decode(base64Key);
  if (raw.length !== 32) throw new Error("SPEND_WALLET_ENC_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", bufferSource(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// Returns base64(iv[12] || ciphertext+tag).
export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, bufferSource(enc.encode(plaintext))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptSecret(blob: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const bytes = b64decode(blob);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, bufferSource(ct)); // throws on tamper/wrong key
  return dec.decode(pt);
}

// Convenience for tests and one-off key generation (print to set SPEND_WALLET_ENC_KEY).
export async function generateEncKey(): Promise<string> {
  return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}
