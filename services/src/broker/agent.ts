import { parseSoul } from "../runtime/soul";
import { parsePolicy } from "../runtime/policy";
import type { Soul, Policy } from "../runtime/types";

// Load the shipped agent: the broker soul + the platform policy. Resolved relative to this
// file so it works regardless of the process cwd.
export async function loadBrokerAgent(): Promise<{ soul: Soul; policy: Policy }> {
  const soulSrc = await Bun.file(new URL("../../agent/broker.soul.md", import.meta.url)).text();
  const policySrc = await Bun.file(new URL("../../agent/policy.md", import.meta.url)).text();
  return { soul: parseSoul(soulSrc), policy: parsePolicy(policySrc) };
}
