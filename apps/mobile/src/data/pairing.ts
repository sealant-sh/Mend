// Native pairing composition. The arrival URL carries the claim; the server
// selects the configured URL saved with the resulting bearer token.

import * as Device from "expo-device";
import { Platform } from "react-native";

import { saveConfig } from "@/data/live";
import type { PairOutcome } from "@/data/pairing-client";
import { HttpPairingClient } from "@/data/pairing-client";
import type { PairPayload } from "@/data/pairing-code";

export type { PairedUser, PairOutcome } from "@/data/pairing-client";
export * from "@/data/pairing-code";

/** What the machine will list this device as. */
export const deviceLabel = (): string =>
  Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`;

/** Translate React Native's platform into the pairing protocol. */
export const devicePlatform = (): "ios" | "android" | "web" | "other" =>
  Platform.OS === "ios"
    ? "ios"
    : Platform.OS === "android"
      ? "android"
      : Platform.OS === "web"
        ? "web"
        : "other";

const pairing = new HttpPairingClient({ saveConfig });

/** Claim a code and save the validated server-selected URL with its bearer token. */
export const claimPairing = (payload: PairPayload): Promise<PairOutcome> =>
  pairing.claim(payload, { name: deviceLabel(), platform: devicePlatform() });
