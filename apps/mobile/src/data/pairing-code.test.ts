import { describe, expect, it } from "vitest";

import {
  formatCode,
  normalizeBaseUrl,
  normalizeCode,
  parsePairParams,
  parsePairUrl,
  parseScanned,
} from "./pairing-code";

describe("normalizeCode", () => {
  it("uppercases, drops the dash, and stops at eight", () => {
    expect(normalizeCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeCode(" ab cd ef gh ij ")).toBe("ABCDEFGH");
  });
});

describe("formatCode", () => {
  it("groups the way the machine prints it", () => {
    expect(formatCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(formatCode("ABC")).toBe("ABC");
  });
});

describe("normalizeBaseUrl", () => {
  it("assumes http for a bare host and drops trailing slashes", () => {
    expect(normalizeBaseUrl("192.168.1.245:3105/")).toBe("http://192.168.1.245:3105");
    expect(normalizeBaseUrl("https://mend.example.com//")).toBe("https://mend.example.com");
    expect(normalizeBaseUrl("   ")).toBe("");
  });
});

describe("parsePairUrl", () => {
  it("reads the url and the code out of the deep link", () => {
    const payload = parsePairUrl(
      `mend://pair?u=${encodeURIComponent("http://100.126.133.49:3105")}&c=ABCDEFGH`,
    );
    expect(payload).toEqual({ url: "http://100.126.133.49:3105", code: "ABCDEFGH" });
  });

  it("refuses a short code, a missing url, and anything not a mend link", () => {
    expect(parsePairUrl("mend://pair?u=http%3A%2F%2Fx%3A1&c=ABC")).toBeNull();
    expect(parsePairUrl("mend://pair?c=ABCDEFGH")).toBeNull();
    expect(parsePairUrl("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
  });
});

describe("parseScanned", () => {
  it("claims a full pairing link", () => {
    const scanned = parseScanned(
      `mend://pair?u=${encodeURIComponent("http://192.168.1.245:3105")}&c=ABCD-EFGH`,
    );
    expect(scanned).toEqual({
      kind: "pairing",
      payload: { url: "http://192.168.1.245:3105", code: "ABCDEFGH" },
    });
  });

  it("reads the installer's bare server URL as an address, not a failure", () => {
    expect(parseScanned("http://192.168.1.245:3105")).toEqual({
      kind: "server",
      url: "http://192.168.1.245:3105",
    });
  });

  it("still refuses a QR that is neither", () => {
    expect(parseScanned("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    expect(parseScanned("")).toBeNull();
  });
});

describe("parsePairParams", () => {
  it("reads the deep link the phone's own camera opened", () => {
    expect(parsePairParams("http://100.84.1.2:3105", "abcd-efgh")).toEqual({
      kind: "pairing",
      payload: { url: "http://100.84.1.2:3105", code: "ABCDEFGH" },
    });
  });

  it("keeps the address when the link carries no usable code", () => {
    expect(parsePairParams("100.84.1.2:3105", undefined)).toEqual({
      kind: "server",
      url: "http://100.84.1.2:3105",
    });
    expect(parsePairParams("100.84.1.2:3105", "ABCD")).toEqual({
      kind: "server",
      url: "http://100.84.1.2:3105",
    });
  });

  it("is nothing at all without an address", () => {
    expect(parsePairParams(undefined, "ABCDEFGH")).toBeNull();
    expect(parsePairParams("", "ABCDEFGH")).toBeNull();
  });

  it("agrees with the QR payload it mirrors", () => {
    const scanned = parsePairUrl("mend://pair?u=http%3A%2F%2F100.84.1.2%3A3105&c=ABCDEFGH");
    expect(parsePairParams("http://100.84.1.2:3105", "ABCDEFGH")).toEqual({
      kind: "pairing",
      payload: scanned,
    });
  });
});
