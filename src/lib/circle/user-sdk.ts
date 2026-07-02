// src/lib/circle/user-sdk.ts
// The browser half of the Circle user-controlled ceremony. One W3SSdk instance drives the
// email OTP modal and PIN challenges. The Circle session triple is kept in sessionStorage:
// it's what treasury actions authenticate with (the PIN challenge still gates every funds
// movement, so a leaked triple alone can't move money).
import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const appId = import.meta.env.VITE_CIRCLE_APP_ID as string;

export type CircleSession = { userToken: string; encryptionKey: string; refreshToken?: string };

const STORAGE_KEY = "prime-circle-session";
export function saveCircleSession(s: CircleSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
export function loadCircleSession(): CircleSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CircleSession) : null;
  } catch {
    return null;
  }
}
export function clearCircleSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

let sdk: W3SSdk | null = null;
function getSdk(): W3SSdk {
  if (!appId) throw new Error("VITE_CIRCLE_APP_ID is not set");
  if (!sdk) sdk = new W3SSdk({ appSettings: { appId } });
  return sdk;
}

export function getDeviceId(): Promise<string> {
  return getSdk().getDeviceId();
}

// Opens Circle's OTP modal; resolves with the Circle session once the emailed code checks out.
export function runEmailOtp(login: { deviceToken: string; deviceEncryptionKey?: string; otpToken?: string }): Promise<CircleSession> {
  return new Promise((resolve, reject) => {
    const s = getSdk();
    s.updateConfigs(
      {
        appSettings: { appId },
        loginConfigs: {
          deviceToken: login.deviceToken,
          deviceEncryptionKey: login.deviceEncryptionKey ?? "",
          otpToken: login.otpToken,
        },
      },
      (error, result) => {
        if (error || !result) return reject(new Error(error?.message ?? "email login failed"));
        const session: CircleSession = {
          userToken: result.userToken,
          encryptionKey: result.encryptionKey,
          refreshToken: (result as { refreshToken?: string }).refreshToken,
        };
        saveCircleSession(session);
        resolve(session);
      },
    );
    s.verifyOtp();
  });
}

// Runs a Circle challenge (PIN setup + wallet creation, or a transfer approval).
export function executeChallenge(challengeId: string, session: CircleSession): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = getSdk();
    s.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });
    s.execute(challengeId, (error) => {
      if (error) return reject(new Error(error.message));
      resolve();
    });
  });
}
