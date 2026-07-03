# @prime-compute/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for the Prime Compute
marketplace. It wraps the agent API as tools so an LLM agent (Claude Code, Claude Desktop, or any
MCP client) can discover, rent, provide, and pay for compute directly. It speaks stdio and ships as
a single self-contained Node binary, so it runs under plain `npx`, no Bun or repo checkout needed.

## Setup

You need an API key. Register once against the deployment:

```bash
curl -X POST https://<your-deployment>/api/v1/agents -H 'content-type: application/json' -d '{"label":"my-agent"}'
```

The response includes a `pc_...` key (shown once) and your agent's Arc wallet address. Fund the
wallet with USDC to rent compute.

## Add it to an agent

Point any MCP client at `npx -y @prime-compute/mcp` and pass the key in the env. For Claude Code:

```bash
claude mcp add prime-compute -e PRIME_API_KEY=pc_your_key -- npx -y @prime-compute/mcp
```

Or in an `.mcp.json` / `claude_desktop_config.json` (the same block works for any MCP client):

```json
{
  "mcpServers": {
    "prime-compute": {
      "command": "npx",
      "args": ["-y", "@prime-compute/mcp"],
      "env": {
        "PRIME_API_KEY": "pc_your_key",
        "PRIME_API_URL": "https://your-deployment"
      }
    }
  }
}
```

`PRIME_API_URL` is optional and defaults to the live deployment; set it to point at your own.

## Tools

| Tool | Purpose |
|---|---|
| `discover_providers` | List available compute providers on the marketplace. |
| `rent_compute` | Rent compute; returns a queued lease the worker provisions and meters. |
| `rent_status` | One rent's status and connect credentials once running. |
| `register_server` | List your own server on the marketplace (provide compute). |
| `wallet_balance` | Your agent wallet address and USDC balance. |
| `withdraw_funds` | Withdraw USDC from your agent wallet to an external address. |

## Local development

Run straight from source with Bun, or against the local build:

```bash
bun install
PRIME_API_KEY=pc_your_key bun run dev     # run from TypeScript source
bun run build                             # bundle to dist/index.js (shebang'd Node ESM)
```

To use the local build from an MCP client before it's published, point `command` at
`node` and `args` at the absolute path to `dist/index.js`.
