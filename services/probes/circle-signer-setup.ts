// One-time setup helper for probe:circle-signer. Two steps, run it twice:
//
//   1. No CIRCLE_ENTITY_SECRET set  -> prints a freshly generated entity secret.
//      Put it in services/.env as CIRCLE_ENTITY_SECRET (never commit it).
//   2. CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET set -> registers the secret with Circle
//      (required once before any signing call works) and writes the recovery file
//      next to this repo. After this, `bun run probe:circle-signer` is live.
//
// Run: bun run probe:circle-signer:setup

import { generateEntitySecret, registerEntitySecretCiphertext } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

if (!entitySecret) {
  console.log("Step 1: here is a fresh entity secret — put it in services/.env as CIRCLE_ENTITY_SECRET, then run this again:\n");
  generateEntitySecret(); // prints the hex secret to stdout
  process.exit(0);
}

if (!apiKey) {
  console.error("CIRCLE_API_KEY is missing. Create a TEST API key (Web3 Services) at https://console.circle.com and put it in services/.env.");
  process.exit(1);
}

const res = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: "./",
});
console.log("Entity secret registered. Recovery file:", JSON.stringify(res.data ?? res, null, 2));
console.log("Keep the recovery file somewhere safe and OUT of git. You can now run: bun run probe:circle-signer");
