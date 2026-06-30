import soulSrc from "../../../services/agent/broker.soul.md?raw";
import policySrc from "../../../services/agent/policy.md?raw";
import { parseSoul } from "@services/runtime/soul";
import { parsePolicy } from "@services/runtime/policy";
import type { Soul, Policy } from "@services/runtime/types";

// Frontend-side loader for the shipped broker agent. The markdown files in services/agent
// are the single source of truth; we import them as strings via Vite's `?raw` and parse
// with the same pure parsers the backend uses. This deliberately avoids the backend's
// loadBrokerAgent(), which reads the files with `Bun.file` — a runtime that isn't
// guaranteed in the app's server bundle.
export function loadBrokerAgent(): { soul: Soul; policy: Policy } {
  return { soul: parseSoul(soulSrc), policy: parsePolicy(policySrc) };
}
