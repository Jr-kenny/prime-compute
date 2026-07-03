import { defineConfig } from "tsup";

// Bundle the server into a single self-contained Node ESM file with a shebang, so it runs under
// plain `npx` (no Bun, no monorepo checkout). The cross-package `serviceIds` import from
// `../../services` gets inlined at build time; only the two runtime deps stay external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  bundle: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  external: ["@modelcontextprotocol/sdk", "zod"],
});
