// src/lib/agents/keys.ts
// Opaque bearer tokens for agents. We store only the SHA-256 hash; the plaintext is shown once at
// creation. Web Crypto so the same code runs in the Cloudflare-Worker app and any Bun context.
export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `pc_${b64}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
