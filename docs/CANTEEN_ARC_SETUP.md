# Running Prime Compute on the Canteen Arc RPC

Prime Compute settles real USDC on Arc testnet. For the Agora Agents hackathon, Arc access is
handed out through Canteen's `arc-canteen` CLI, which gives you a tokenized Arc RPC endpoint. This
app is built so that endpoint drops straight in: every Arc call (the broker's Gateway settlement,
the per-user spend wallets, and passkey ownership verification) reads one env var, `ARC_RPC_URL`.
Point it at your Canteen endpoint and the whole app runs on the host's RPC.

## 1. Get a tokenized Arc RPC from Canteen

Follow Canteen's setup ([reference](https://github.com/Mrgtee/precall/blob/main/docs/AGORA_ARC_SETUP.md)):

```bash
# install the CLI (uv)
uv tool install arc-canteen

# log in and sync your Arc context
arc-canteen login

# sanity check connectivity (should return the Arc chain id, 0x4cef52 = 5042002)
arc-canteen rpc eth_chainId
```

That prints (or configures) your tokenized RPC URL. Copy it.

## 2. Point Prime Compute at it

Set `ARC_RPC_URL` to the Canteen endpoint in **both** env files (the web app reads root `.env`, the
broker/worker and scripts read `services/.env`):

```bash
# .env and services/.env
ARC_RPC_URL=<your arc-canteen tokenized RPC URL>
ARC_CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

That single value now flows everywhere Arc is touched:

- **Gateway settlement** (`services/src/settlement/gateway.ts`): the `GatewaySettlementAdapter` takes
  an optional `rpcUrl`, and the roundtrip scripts pass `process.env.ARC_RPC_URL`, so on-chain
  deposits/balances/withdrawals go through Canteen. (The batched `pay()` itself still goes through
  the Circle Gateway facilitator at `X402_FACILITATOR_URL`.)
- **Per-user spend wallets** (`services/src/wallet/onchain.ts`): USDC balance reads and withdrawals
  on Arc use `ARC_RPC_URL`.
- **Passkey ownership verification** (`src/lib/auth/verify-ownership.ts`): the ERC-6492 check reads
  `ARC_RPC_URL`.

## 3. Verify

```bash
cd services
bun run settlement:roundtrip     # fund/pay/reconcile on Arc via the Canteen RPC
bun run integration:roundtrip     # full provider -> broker -> settlement loop
```

If the Canteen token expires, re-run `arc-canteen login` and update `ARC_RPC_URL`. Nothing else in
the app needs to change.
