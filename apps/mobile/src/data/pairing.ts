// Pairing: the machine mints a short-lived code, this phone claims it once
// and keeps the token it gets back. The QR encodes the same two facts the
// machine prints beside it — a base URL this phone can reach, and the code.

import * as Device from "expo-device";
import { Platform } from "react-native";

import type { MendConfig } from "@/data/live";
import { saveConfig } from "@/data/live";
import type { PairPayload } from "@/data/pairing-code";
import { CODE_LENGTH, normalizeBaseUrl, normalizeCode } from "@/data/pairing-code";

export * from "@/data/pairing-code";

export interface PairedUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export type PairOutcome =
  | { readonly state: "paired"; readonly config: MendConfig; readonly user: PairedUser }
  | { readonly state: "refused"; readonly reason: string };

const readString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** What the machine will list this device as. */
export const deviceLabel = (): string =>
  Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`;

export const devicePlatform = (): "ios" | "android" | "web" | "other" =>
  Platform.OS === "ios"
    ? "ios"
    : Platform.OS === "android"
      ? "android"
      : Platform.OS === "web"
        ? "web"
        : "other";

interface PairResponse {
  readonly token: string;
  readonly deviceName: string | null;
  readonly user: PairedUser;
}

const readPairResponse = (value: unknown): PairResponse | null => {
  if (typeof value !== "object" || value === null) return null;
  const token = "token" in value ? readString(value.token) : null;
  if (token === null) return null;
  const device = "device" in value && typeof value.device === "object" ? value.device : null;
  const deviceName = device !== null && "name" in device ? readString(device.name) : null;
  const user = "user" in value && typeof value.user === "object" ? value.user : null;
  if (user === null) return null;
  const id = "id" in user ? readString(user.id) : null;
  const name = "name" in user ? readString(user.name) : null;
  const email = "email" in user ? readString(user.email) : null;
  if (id === null) return null;
  return {
    token,
    deviceName,
    user: { id, name: name ?? "", email: email ?? "" },
  };
};

/**
 * Claim a code. On success the token is saved with the URL that just proved
 * it works — the phone keeps talking to the address it reached, not one the
 * machine guessed for it.
 */
export const claimPairing = async (payload: PairPayload): Promise<PairOutcome> => {
  const base = normalizeBaseUrl(payload.url);
  const code = normalizeCode(payload.code);
  if (base === "") return { state: "refused", reason: "enter the server URL shown on the machine" };
  if (code.length !== CODE_LENGTH) {
    return { state: "refused", reason: `the code is ${CODE_LENGTH} characters` };
  }
  const name = deviceLabel();
  let response: Response;
  try {
    response = await fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name, platform: devicePlatform() }),
    });
  } catch {
    return {
      state: "refused",
      reason: `${base} unreachable — check the URL, port, firewall, same network`,
    };
  }
  if (response.status === 404) {
    return { state: "refused", reason: "code not found — check it against the machine" };
  }
  if (response.status === 410) {
    return { state: "refused", reason: "code expired — generate a new one on the machine" };
  }
  if (response.status === 429) {
    return { state: "refused", reason: "too many attempts — wait a minute, then try again" };
  }
  if (!response.ok) {
    return { state: "refused", reason: `server answered ${response.status} on /api/pair` };
  }
  const body = readPairResponse(await response.json().catch(() => null));
  if (body === null) return { state: "refused", reason: "server answered an unreadable body" };
  const config: MendConfig = {
    url: base,
    token: body.token,
    deviceName: body.deviceName ?? name,
    pairedAt: new Date().toISOString(),
  };
  await saveConfig(config);
  return { state: "paired", config, user: body.user };
};
