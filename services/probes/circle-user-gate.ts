// probes/circle-user-gate.ts
// Gate zero for the user-controlled wallet gate (Identity v2 spec,
// specs/2026-07-02-user-controlled-wallet-gate-design.md). Probes, against our REAL
// Circle account, everything that can be proven without a browser:
//
//   [1] ARC-TESTNET is in the user-controlled SDK's Blockchain enum (static).
//   [2] The account has an App ID (the Web SDK's handle; answers "does one account
//       carry both the entity-secret setup AND user-controlled config").
//   [3] createUser + createUserToken work with our API key.
//   [4] createUserPinWithWallets accepts blockchains: ["ARC-TESTNET"] and returns a
//       challengeId — Circle-side acceptance of Arc wallet creation. (EXECUTING the
//       challenge is a browser ceremony via the Web SDK: handoff.)
//   [5] Server-side token verification: getUserStatus(userToken) maps a live token to
//       a user; listWallets(userToken) is the wallet lookup the bridge will use.
//   [6] Email-OTP device token: createDeviceTokenForEmailLogin with our key — proves
//       the endpoint/console config exists (the deviceId is normally minted by the Web
//       SDK, so a synthetic one may be rejected; any response OTHER than "email login
//       not configured" counts as config-present).
//
// Not probeable headless (browser handoff): PIN setup, challenge execution, the live
// PIN-approved USDC transfer + its gas model. Those land in the plan as acceptance.
//
// Run: cd services && bun run probe:circle-user-gate
import { randomUUID } from "node:crypto";
import { initiateUserControlledWalletsClient, Blockchain } from "@circle-fin/user-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) throw new Error("CIRCLE_API_KEY missing (services/.env)");

const results: { step: string; verdict: "PASS" | "FAIL" | "INFO"; detail: string }[] = [];
const log = (step: string, verdict: "PASS" | "FAIL" | "INFO", detail: string) => {
  results.push({ step, verdict, detail });
  console.log(`[${verdict}] ${step}: ${detail}`);
};
const errText = (e: unknown) => {
  const r = (e as { response?: { status?: number; data?: unknown } }).response;
  return r ? `${r.status} ${JSON.stringify(r.data)}` : e instanceof Error ? e.message : String(e);
};

// [1] static enum check
log("arc-in-enum", Blockchain.ArcTestnet === "ARC-TESTNET" ? "PASS" : "FAIL",
  `Blockchain.ArcTestnet = ${Blockchain.ArcTestnet}`);

// [2] app id (the Web SDK needs this; raw REST since the client doesn't wrap it)
try {
  const res = await fetch("https://api.circle.com/v1/w3s/config/entity", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const body = (await res.json()) as { data?: { appId?: string } };
  log("app-id", body.data?.appId ? "PASS" : "FAIL", `GET /config/entity -> ${res.status}, appId=${body.data?.appId ?? "none"}`);
} catch (e) {
  log("app-id", "FAIL", errText(e));
}

const client = initiateUserControlledWalletsClient({ apiKey });

// [3] user + token
const userId = `probe-gate-${randomUUID()}`;
let userToken = "";
try {
  await client.createUser({ userId });
  const tok = await client.createUserToken({ userId });
  userToken = tok.data?.userToken ?? "";
  log("create-user+token", userToken ? "PASS" : "FAIL",
    `userId=${userId}, userToken=${userToken ? "issued" : "MISSING"}, encryptionKey=${tok.data?.encryptionKey ? "issued" : "MISSING"}`);
} catch (e) {
  log("create-user+token", "FAIL", errText(e));
}

// [4] PIN + ARC-TESTNET wallet challenge
if (userToken) {
  try {
    const ch = await client.createUserPinWithWallets({
      userToken, blockchains: ["ARC-TESTNET"], accountType: "EOA",
    });
    log("arc-wallet-challenge", ch.data?.challengeId ? "PASS" : "FAIL",
      `challengeId=${ch.data?.challengeId ?? "none"} (execution = browser handoff)`);
  } catch (e) {
    log("arc-wallet-challenge", "FAIL", errText(e));
  }

  // [5] server-side token verification
  try {
    const status = await client.getUserStatus({ userToken });
    const wallets = await client.listWallets({ userToken });
    log("verify-token", "PASS",
      `getUserStatus -> id=${status.data?.id}, pinStatus=${status.data?.pinStatus}; listWallets -> ${wallets.data?.wallets?.length ?? 0} wallets (0 expected pre-challenge)`);
  } catch (e) {
    log("verify-token", "FAIL", errText(e));
  }
}

// [6] email-OTP device token (synthetic deviceId; config presence check, not a login)
try {
  const dt = await client.createDeviceTokenForEmailLogin({
    deviceId: randomUUID(), email: "probe@example.com", idempotencyKey: randomUUID(),
  });
  log("email-otp-config", "PASS", `deviceToken issued (${dt.data?.deviceToken ? "token" : "no token"}) — email login configured`);
} catch (e) {
  const t = errText(e);
  // A validation complaint about the synthetic deviceId still proves the endpoint is
  // enabled for this account; "not configured/enabled" style errors are the real FAIL.
  const configMissing = /not (configured|enabled)|forbidden/i.test(t);
  log("email-otp-config", configMissing ? "FAIL" : "INFO", t);
}

console.log("\n=== gate zero summary ===");
for (const r of results) console.log(`  ${r.verdict.padEnd(4)} ${r.step}`);
const failed = results.filter((r) => r.verdict === "FAIL");
if (failed.length > 0) {
  console.log(`\n❌ ${failed.length} FAIL — per the spec, stop and re-design rather than work around.`);
  process.exit(1);
}
console.log("\n✅ headless gate passed. Browser handoff remains: PIN setup + challenge execution + PIN-approved Arc USDC transfer (gas model).");
