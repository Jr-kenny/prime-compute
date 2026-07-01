// mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrimeClient } from "./client";

const baseUrl = process.env.PRIME_API_URL ?? "https://primecomputelive.vercel.app";
const apiKey = process.env.PRIME_API_KEY;
if (!apiKey) throw new Error("PRIME_API_KEY required (register once via POST /api/v1/agents)");
const client = new PrimeClient(baseUrl, apiKey);

const server = new McpServer({ name: "prime-compute", version: "1.0.0" });
const asText = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const resourceType = z.enum(["GPU", "CPU", "Storage", "Full Server"]);

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

await server.connect(new StdioServerTransport());
