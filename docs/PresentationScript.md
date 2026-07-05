# Prime Compute: Submission & Demo Script

This script is designed to help you present **Prime Compute** for hackathon submissions, demo videos, or live presentations. It is split into a **Pre-demo Checklist**, a **3-Minute Video Script (Visuals + Audio)**, and a **Technical Deep-Dive/Q&A Cheat Sheet**.

---

## 📋 Pre-Demo Preparation Checklist

Before recording or presenting, ensure the following are configured and running:

1. **Environment Setup**:
   - Copy `services/.env.example` to `services/.env` and ensure `ARC_RPC_URL` and `LLM_API_KEY` (OpenAI-compatible) are configured.
   - Run `bun install` at the root and inside the `services/` directory.

2. **Funding the Demo Wallets**:
   - Ensure the account associated with `BROKER_WALLET_PRIVATE_KEY` has some testnet USDC on Arc to cover gas and streaming payments. You can get testnet USDC from the Circle Faucet (select Arc network).
   - Funding link: [Circle Faucet](https://faucet.circle.com) (Switch to Arc Testnet).

3. **Running the Local Servers**:
   - **Frontend**: Run `bun run dev` in the root directory. This spins up the UI at `http://localhost:8080` (or the local dev port).
   - **Backend Seed**: In the `services/` directory, run `bun run seed` to populate the registry with demo providers (specs, regions, prices).
   - **Integration Script**: Keep the command `bun run integration:roundtrip` ready in a terminal split to showcase the autonomous migration flow.

4. **MCP Server Demo Prep**:
   - Ensure you have Claude Code or a compatible MCP client ready.
   - Command to test: `npx -y @prime-compute/mcp` or `bun run mcp:start` (from the `mcp/` directory).

---

## 🎥 The 3-Minute Video Script (Visuals + Voiceover)

This is a time-coded, high-impact script designed for a standard 3-minute hackathon video. 

*Tip: Speak naturally, pacing yourself with the visual actions.*

| Time | Visual on Screen | Voiceover / Speech |
| :--- | :--- | :--- |
| **0:00 - 0:35** | **Landing Page (`/`)**<br>- Show the sleek dark-mode homepage of Prime Compute.<br>- Scroll down to show the architecture overview diagram. | "Renting compute today is lumpy, rigid, and trust-heavy. You commit to long contracts, pay for whole blocks of time whether you use them or not, and if the provider's machine degrades, it's your problem.<br><br>Welcome to **Prime Compute**—a decentralized marketplace where you rent idle compute, pay by the second of actual use, and settle in USDC on Arc. If a machine starts flaking out, an AI broker instantly and autonomously migrates your workload and payment stream to the next best provider." |
| **0:35 - 1:10** | **Onboarding Page (`/onboarding`) & Marketplace (`/marketplace`)**<br>- Click "Get Started" to go to `/onboarding`. <br>- Connect your Web3 wallet (via WalletConnect / SIWE).<br>- Show the user dashboard and the pre-funded Arc spend wallet.<br>- Click over to the **Marketplace** page, showing the registry of providers (CPU, GPU, H100 specs, Compute Scores, and price per second). | "We start by onboarding. Users sign in using SIWE (Sign-In with Ethereum). The platform automatically provisions an Arc spend wallet—an EOA that handles the streaming payments.<br><br>Here on the Marketplace dashboard, you can see live compute providers. Each provider has a verified **Compute Score** representing their actual reliability, uptime, and latency, backed by historical telemetry." |
| **1:10 - 1:55** | **Creating a Rent & Streaming USDC**<br>- Click "Rent Compute" on a GPU provider or select custom requirements.<br>- Start the rent.<br>- Show the active rent UI ticking up second-by-second.<br>- Point out the active USDC stream settling on Arc via x402. | "Let's rent a GPU. When I start a rent, **Lumen**, our AI broker, steps in. Lumen doesn't use a hardcoded weight formula. Instead, it reads a written soul and platform policy, and reasons over the candidates to find the best match.<br><br>Once matched, Lumen opens a streaming payment channel. Settled through Circle's x402 batching on Arc, USDC is streamed per second. You only pay for what you actually use. If you cancel, the stream closes instantly, and unused funds are reconciled right back to your wallet." |
| **1:55 - 2:30** | **Autonomous Migration Demo**<br>- Switch to a split terminal screen.<br>- Run `bun run integration:roundtrip`. Show the logs: Provider A runs, gets dropped, and the broker autonomously switches to Provider B.<br>- Point out the UI reflecting the provider change without stopping the rent. | "But what happens if a provider goes offline or degrades? We've simulated this in our integration tests. Here, Provider A is serving compute. When A suddenly drops, Lumen's monitoring worker instantly detects the degradation, pauses the payment stream, selects Provider B, and re-points the stream on-chain.<br><br>The renter's workload continues seamlessly, protected by code-enforced guardrails that the AI broker cannot bypass." |
| **2:30 - 2:50** | **Agent-to-Agent Economy (MCP Server)**<br>- Show a terminal running an MCP tool call (e.g., in Claude Code using `rent_compute`).<br>- Show the tool parameters and the response. | "Prime Compute isn't just for humans. It features a developer API and a Model Context Protocol (MCP) server. Autonomous AI agents can run `npx @prime-compute/mcp` to provision their own wallets, search for compute, and rent GPUs without a human in the loop, creating a fully autonomous agent-to-agent economy." |
| **2:50 - 3:00** | **Outro / Summary**<br>- Show the repository structure or deployment link.<br>- Conclude with a strong finish. | "By combining Circle's nanopayments stack, Arc's gas-free USDC settlement, and a soul-driven AI broker, Prime Compute makes renting compute flexible, secure, and pay-by-the-second. Try it out at `primecompute.vercel.app`. Thank you!" |

---

## 🛠️ Technical Deep-Dive / Q&A Cheat Sheet

If you are presenting live or answering questions from judges, here are the key technical concepts and architectural decisions to highlight:

### 1. The Circle Nanopayments Stack & x402
*   **How it works**: The provider runs an x402 seller endpoint using Express middleware (`createGatewayMiddleware`). The buyer (Lumen broker) interacts via `@circle-fin/x402-batching/client`.
*   **Why Arc?**: Arc testnet uses USDC directly for gas, making micropayments incredibly efficient because you don't need a separate native token (like ETH) to execute transactions.
*   **Reconciliation**: The system uses a `last_charged_at` timestamp and a sequential `seq` counter. If the metering worker restarts mid-rent, it resumes exactly where it left off, avoiding double-charging or missing charges.

### 2. Lumen: The Soul-Driven Broker
*   **No Hardcoding**: Conventional brokers use static scoring (e.g., `0.6 * price + 0.4 * latency`). Lumen uses an LLM (via the Vercel AI SDK) that reasons dynamically based on:
    *   **Soul Document** (`broker.soul.md`): Defines the broker's personality, goals, and matching philosophy.
    *   **Policy Document** (`policy.md`): Hard platform constraints.
*   **Guardrails in Code**: The AI's decisions are subject to strict code-level validators. Lumen *cannot* choose a provider that violates the rent's budget, trust tier, or hard requirements. If the LLM goes offline, the system gracefully falls back to a deterministic scoring function.

### 3. Developer Friction Log (`docs/Feedback.md`)
*   If asked about what was difficult or what feedback you have for Circle:
    *   **Wallet Composability**: The x402 `GatewayClient` expects a raw private key, which made it difficult to compose with Circle’s developer-controlled Smart Wallets/Passkeys.
    *   **Async Batching UUIDs**: Batched settlements return a UUID reference instead of an immediate transaction hash, requiring custom polling to verify that money has landed.
    *   **SDK Polyfills**: The Web SDK had heavy Node dependency imports that required custom bundler configurations to run in clean React environments.

---

## 🚀 Commands to Run During Live Demos

Keep these copy-pasteable commands handy during your presentation:

*   **To run the local backend tests and showcase the full broker simulation**:
    ```bash
    cd services && bun run integration:roundtrip
    ```
*   **To show the LLM tool-calling capabilities of the broker**:
    ```bash
    cd services && bun run probe:llm
    ```
*   **To start the MCP server for agent testing**:
    ```bash
    npx -y @prime-compute/mcp
    ```
