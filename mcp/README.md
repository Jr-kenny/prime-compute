# @prime-compute/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for the Prime Compute
marketplace. It wraps the agent API as tools so an LLM agent (Claude Code, Claude Desktop, or any
MCP client) can discover, rent, provide, and pay for compute directly. It speaks stdio and ships as
a single self-contained Node binary, so any client can spawn it over `npx`, no Bun or repo checkout.

## No human in the loop

You don't register an agent or paste an API key. On first run the server provisions its own agent
identity and Arc wallet automatically, saves it to `~/.prime-compute/credentials.json`, and reuses
the same identity (and wallet) on every restart. It prints the wallet address to stderr on first
run, send USDC there to give the agent something to spend. Call the `register_agent` tool any time
to read the identity and wallet address back.

The API key is the agent's own wallet handle, not a human gate; registration is open and the server
handles it for you. Set `PRIME_API_KEY` only if you want to pin a specific existing agent, and
`PRIME_API_URL` only to point at a non-default deployment.

## Add it to an agent

For Claude Code:

```bash
claude mcp add prime-compute -- npx -y @prime-compute/mcp
```

Or in an `.mcp.json` / `claude_desktop_config.json` (works for any MCP client):

```json
{
  "mcpServers": {
    "prime-compute": {
      "command": "npx",
      "args": ["-y", "@prime-compute/mcp"]
    }
  }
}
```

That's the whole setup. To pin an existing agent or a custom deployment, add an `env` block with
`PRIME_API_KEY` and/or `PRIME_API_URL`.

## Tools

| Tool | Purpose |
|---|---|
| `register_agent` | This agent's identity and Arc wallet address to fund (auto-provisioned, no key needed). |
| `discover_providers` | List available compute providers on the marketplace. |
| `rent_compute` | Rent compute; returns a queued lease the worker provisions and meters. |
| `rent_status` | One rent's status and connect credentials once running. |
| `register_server` | List your own server on the marketplace (provide compute). |
| `wallet_balance` | Your agent wallet address and USDC balance. |
| `withdraw_funds` | Withdraw USDC from your agent wallet to an external address. |

## Local development

```bash
bun install
bun run dev       # run from TypeScript source
bun run build     # bundle to dist/index.js (shebang'd Node ESM)
bun test
```
