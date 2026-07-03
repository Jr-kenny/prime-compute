// mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrimeClient } from "./client";
import { serviceIds } from "../../services/src/services/registry";

const baseUrl = process.env.PRIME_API_URL ?? "https://primecomputelive.vercel.app";
const apiKey = process.env.PRIME_API_KEY;
if (!apiKey) {
  // Fail fast with a clean message on stderr (an MCP client shows this when the server won't start),
  // not a stack trace. Register once via POST /api/v1/agents to get a key.
  console.error("prime-compute-mcp: PRIME_API_KEY is required. Register once via POST /api/v1/agents, then set PRIME_API_KEY (and PRIME_API_URL for a non-default deployment).");
  process.exit(1);
}
const client = new PrimeClient(baseUrl, apiKey);

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
    description: "Rent compute; returns a queued lease that the worker provisions and meters",
    inputSchema: { name: z.string(), resourceType, region: z.string().optional(), estimatedUsage: z.number().optional() },
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

await server.connect(new StdioServerTransport());
