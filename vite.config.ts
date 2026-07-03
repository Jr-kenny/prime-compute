import { defineConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Plain TanStack Start config. This used to come from
// @lovable.dev/vite-tanstack-config; it's inlined here so the build doesn't
// depend on a vendor wrapper. Mirrors what that wrapper set up for a normal
// (non-sandbox) build: tailwind, tsconfig paths, TanStack Start, React, and
// nitro targeting Cloudflare for the production server build.
export default defineConfig(async ({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // src/server.ts is our SSR error wrapper; nitro builds from this.
      server: { entry: "server" },
    }),
  ];

  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ defaultPreset: "cloudflare-module" }));
  }

  plugins.push(viteReact());

  return {
    // Run Lightning CSS in dev as well as build so the preview matches the
    // built output (Vite otherwise only runs it at build time).
    css: { transformer: "lightningcss" as const },
    // `build:dev` keeps React in dev mode on the client only; a global NODE_ENV
    // flip would emit jsxDEV, which the react-server SSR runtime can't resolve.
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    resolve: {
      alias: {
        "@": `${process.cwd()}/src`,
        "@services": `${process.cwd()}/services/src`,
      },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    // These CJS helpers (pulled in via the Circle SDK's axios/form-data chain) get
    // externalized by Vite's SSR external detection, leaving bare require() calls the
    // Cloudflare runtime can't resolve ("No such module get-intrinsic"). Force-bundle them.
    ssr: {
      noExternal: [
        "get-intrinsic",
        "es-set-tostringtag",
        "has-tostringtag",
        "hasown",
        "es-errors",
        "debug",
        "call-bind-apply-helpers",
        "dunder-proto",
        "es-define-property",
        "es-object-atoms",
        "function-bind",
        "get-proto",
        "gopd",
        "has-symbols",
        "math-intrinsics",
        "ms",
        "supports-color",
        "has-flag",
      ],
    },
    server: { host: "::", port: 8080 },
    plugins,
  };
});
