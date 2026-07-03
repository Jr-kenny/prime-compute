import { defineConfig, type Plugin, type PluginOption, type UserConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// The Circle Web SDK (@circle-fin/w3s-pw-web-sdk) bundles jsonwebtoken/safe-buffer/
// crypto-browserify, which reach for Node's buffer/crypto/stream/... in the browser. Without
// these polyfills the SDK crashes at import. But the polyfills must stay out of the server
// build: the plugin's config hook returns top-level resolve.alias entries (node:buffer -> a
// browser shim), which Vite applies to every environment, so the nitro/Cloudflare SSR bundle
// fails with "node:buffer is not exported by .../shims/buffer". We scope the whole plugin to
// the client environment: applyToEnvironment keeps its resolve/transform hooks off the SSR
// pipeline, and the config output (Buffer/global/process injection, optimizeDeps) is moved
// under environments.client so the server keeps resolving the real node builtins.
// The aliases need special handling: Vite only honors resolve.alias at the ROOT config level
// (per-environment alias is silently ignored), so putting them under environments.client
// makes the client resolve `buffer` to Vite's empty browser-external stub and the Circle SDK
// dies at import with "Cannot read properties of undefined (reading 'from')". Instead we
// capture the plugin's alias map and replay it through a client-only resolveId hook, which
// IS environment-scoped.
const clientOnlyNodePolyfills = (): PluginOption[] => {
  const plugins = [
    nodePolyfills({ globals: { Buffer: true, global: true, process: true }, protocolImports: true }),
  ].flat() as Plugin[];
  const aliasMap: Record<string, string> = {};
  for (const plugin of plugins) {
    plugin.applyToEnvironment = (environment) => environment.name === "client";
    const originalConfig = plugin.config;
    if (originalConfig) {
      // Mutate in place (no spread copies): the plugin's pieces share closures and
      // mutate each other from inside this hook.
      plugin.config = async function (userConfig, env) {
        const handler = typeof originalConfig === "function" ? originalConfig : originalConfig.handler;
        const result = await handler.call(this, userConfig, env);
        if (!result) return result;
        const { resolve, optimizeDeps, build, ...rest } = result as UserConfig;
        Object.assign(aliasMap, (resolve?.alias as Record<string, string>) ?? {});
        return {
          ...rest,
          environments: { client: { optimizeDeps, build } },
        };
      };
    }
  }
  plugins.push({
    name: "client-node-polyfill-resolver",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "client",
    resolveId: {
      async handler(id, importer, options) {
        const target = aliasMap[id];
        if (!target) return;
        return this.resolve(target, importer, { ...options, skipSelf: true });
      },
    },
  });
  return plugins;
};

// Plain TanStack Start config. This used to come from
// @lovable.dev/vite-tanstack-config; it's inlined here so the build doesn't
// depend on a vendor wrapper. Mirrors what that wrapper set up for a normal
// (non-sandbox) build: tailwind, tsconfig paths, TanStack Start, React, and
// nitro targeting Cloudflare for the production server build.
export default defineConfig(async ({ command, mode }) => {
  const isDevBuild = command === "build" && mode === "development";

  const plugins: PluginOption[] = [
    tailwindcss(),
    ...clientOnlyNodePolyfills(),
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
