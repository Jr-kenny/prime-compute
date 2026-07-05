// mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrimeClient } from "./client";
import { resolveCredentials, credentialsPath, type ResolvedCreds } from "./credentials";
import { serviceIds } from "../../services/src/services/registry";

const baseUrl = process.env.PRIME_API_URL ?? "https://primecompute.vercel.app";

// No human in the loop: the agent gets its own identity + wallet automatically. An env key pins a
// known agent; otherwise we reuse the saved identity, or self-register on first run and persist it.
const creds: ResolvedCreds = await resolveCredentials(baseUrl).catch((e): ResolvedCreds => {
  console.error(`prime-compute-mcp: couldn't obtain an agent identity from ${baseUrl}: ${e instanceof Error ? e.message : e}`);
  console.error("prime-compute-mcp: check PRIME_API_URL is a reachable deployment, or set PRIME_API_KEY to use an existing agent.");
  process.exit(1);
});
const client = new PrimeClient(baseUrl, creds.apiKey);

if (creds.source === "registered") {
  console.error(`prime-compute-mcp: registered a new agent (${creds.agentId}). Fund its Arc wallet with USDC to rent compute: ${creds.walletAddress}`);
  console.error(`prime-compute-mcp: identity saved to ${credentialsPath()} and reused automatically on restart.`);
} else if (creds.source === "file") {
  console.error(`prime-compute-mcp: using the saved agent identity (${creds.agentId}) from ${credentialsPath()}.`);
}

const server = new McpServer({ name: "prime-compute", version: "1.0.0" });
const asText = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
// Derived from the service registry so a new service type is offered by the MCP tools automatically.
// z.enum needs a non-empty tuple, hence the [first, ...rest] shape.
const ids = serviceIds();
const resourceType = z.enum([ids[0]!, ...ids.slice(1)]);

server.registerTool(
  "discover_providers",
  { description: "List available compute providers on the marketplace", inputSchema: {} },
  async () => asText(await client.discoverProviders()),
);

server.registerTool(
  "rent_compute",
  {
    description: "Rent compute; returns a queued lease that the worker provisions and meters. The lease runs continuously until you stop it, or until an optional cap is hit.",
    inputSchema: {
      name: z.string(), resourceType, region: z.string().optional(), estimatedUsage: z.number().optional(),
      maxSpendUsdc: z.string().optional().describe("Optional: stop the lease after this much USDC is charged, e.g. \"0.50\""),
      durationMs: z.number().optional().describe("Optional: stop the lease this many milliseconds from now"),
    },
  },
  async (a) => asText(await client.rentCompute(a)),
);

server.registerTool(
  "rent_status",
  { description: "Get one rent's status and connect credentials when running", inputSchema: { id: z.string() } },
  async (a) => asText(await client.rentStatus(a.id)),
);

server.registerTool(
  "register_server",
  {
    description: "List your own server on the marketplace",
    inputSchema: {
      alias: z.string(), endpointUrl: z.string(), resourceType, region: z.string(),
      pricePerCharge: z.number(), specs: z.record(z.string(), z.unknown()).optional(),
    },
  },
  async (a) => asText(await client.registerServer(a)),
);

server.registerTool(
  "register_agent",
  {
    description: "Show this agent's identity and the Arc wallet address to fund. The agent self-provisions on first run with no human and no API key; this reports who it is and where to send USDC.",
    inputSchema: {},
  },
  async () => asText({ agentId: creds.agentId, identitySource: creds.source, credentialsPath: credentialsPath(), wallet: await client.walletBalance() }),
);

server.registerTool(
  "wallet_balance",
  { description: "Your agent wallet address and USDC balance; fund by sending USDC to the address", inputSchema: {} },
  async () => asText(await client.walletBalance()),
);

server.registerTool(
  "withdraw_funds",
  {
    description: "Withdraw USDC from your agent wallet to an external address",
    inputSchema: { toAddress: z.string(), amount: z.string() },
  },
  async (a) => asText(await client.withdraw(a.toAddress, a.amount)),
);

server.registerTool(
  "reclaim",
  { description: "Reclaim your unused prepaid Gateway float back into your agent wallet", inputSchema: {} },
  async () => asText(await client.reclaim()),
);

await server.connect(new StdioServerTransport());
