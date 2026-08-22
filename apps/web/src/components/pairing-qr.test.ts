import { describe, expect, it } from "vitest";

import { countdown, groupCode, pairingPayload, pairingUrls } from "./pairing-qr.tsx";

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const pairing = (urls: ReadonlyArray<string>) => ({
  code: "ABCDEFGH",
  expiresAt: "2026-08-22T10:10:00.000Z",
  urls,
});

describe("pairingUrls", () => {
  it("leads with the origin this page was served from", () => {
    expect(pairingUrls(pairing(["http://100.84.1.2:3105"]), "http://mymachine:3105")).toEqual([
      "http://mymachine:3105",
      "http://100.84.1.2:3105",
    ]);
  });

  it("keeps the detected addresses when the origin is one of them", () => {
    expect(
      pairingUrls(
        pairing(["http://100.84.1.2:3105", "http://192.168.1.9:3105"]),
        "http://100.84.1.2:3105",
      ),
    ).toEqual(["http://100.84.1.2:3105", "http://192.168.1.9:3105"]);
  });

  it("leaves a loopback origin out — it is no route for a phone", () => {
    expect(pairingUrls(pairing(["http://100.84.1.2:3105"]), "http://localhost:3105")).toEqual([
      "http://100.84.1.2:3105",
    ]);
    expect(pairingUrls(pairing([]), "http://127.0.0.1:3105")).toEqual(["http://127.0.0.1:3105"]);
  });
});

describe("the QR payload", () => {
  it("encodes the URL and the code the phone reads back", () => {
    expect(pairingPayload("http://100.84.1.2:3105", "ABCDEFGH")).toBe(
      "mend://pair?u=http%3A%2F%2F100.84.1.2%3A3105&c=ABCDEFGH",
    );
    expect(groupCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });

  it("counts down to the expiry and then says nothing", () => {
    expect(countdown("2026-08-22T10:10:00.000Z", at("2026-08-22T10:04:19.000Z"))).toBe("5:41");
    expect(countdown("2026-08-22T10:10:00.000Z", at("2026-08-22T10:10:00.000Z"))).toBeNull();
  });
});
