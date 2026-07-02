// services/scripts/circle-setup.ts
// One-time: create the production wallet set + the platform treasury wallet, print ids.
import { makeCircleClient } from "../src/wallet/circle";

const client = makeCircleClient();
const set: any = await client.createWalletSet({ name: "prime-compute" });
const walletSetId = set.data?.walletSet?.id;
if (!walletSetId) throw new Error(`createWalletSet gave no id: ${JSON.stringify(set.data)}`);
console.log("CIRCLE_WALLET_SET_ID=" + walletSetId);

const created: any = await client.createWallets({
  walletSetId, blockchains: ["ARC-TESTNET"] as any, accountType: "EOA", count: 1,
});
const treasury = created.data?.wallets?.[0];
if (!treasury) throw new Error(`createWallets gave no wallet: ${JSON.stringify(created.data)}`);
console.log(`PLATFORM_TREASURY_ADDRESS=${treasury.address}  # wallet id ${treasury.id}`);
console.log("Put both in services/.env (and root .env for the app).");
