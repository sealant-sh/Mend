import { beforeEach, describe, expect, it } from "vitest";

import { processOutput } from "#/lib/api";

import type { ApiRequest, MendBridge } from "../../../shared/bridge";

const base64 = (bytes: Uint8Array): string =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

const bridgeWith = (
  request: (
    input: ApiRequest,
  ) => Promise<{ readonly status: number; readonly ok: boolean; readonly body: unknown }>,
): MendBridge => ({
  platform: "linux",
  connection: {
    get: async () => ({
      url: "http://localhost:3105",
      signedIn: true,
      configPath: "/tmp/cli.json",
    }),
    signIn: async () => ({ ok: false, reason: "not in test" }),
    setToken: async () => undefined,
    signOut: async () => undefined,
    onChange: () => () => {},
  },
  api: { request },
  tty: { url: async () => "ws://localhost/tty" },
  events: {
    onEvent: () => () => {},
    onState: () => () => {},
  },
  shell: { openExternal: async () => undefined },
  window: {
    minimize: () => {},
    toggleMaximize: () => {},
    close: () => {},
  },
});

describe("desktop process logs", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "mend");
  });

  it("pages the read-only logs endpoint and decodes UTF-8 across chunk boundaries", async () => {
    const encoded = new TextEncoder().encode("A🙂B");
    const requested: string[] = [];
    const pages = [
      {
        requestedFrom: "0",
        nextFrom: "2",
        chunks: [{ sequence: "1", dataBase64: base64(encoded.slice(0, 3)) }],
      },
      {
        requestedFrom: "2",
        nextFrom: "3",
        chunks: [{ sequence: "2", dataBase64: base64(encoded.slice(3)) }],
      },
      { requestedFrom: "3", nextFrom: "3", chunks: [] },
    ];
    let page = 0;
    Object.defineProperty(window, "mend", {
      configurable: true,
      value: bridgeWith(async (input) => {
        requested.push(input.path);
        const body = pages[page];
        page += 1;
        return { status: 200, ok: true, body };
      }),
    });

    await expect(processOutput("process-1")).resolves.toEqual({ text: "A🙂B" });
    expect(requested).toEqual([
      "/api/processes/process-1/logs?from=0&limit=1000",
      "/api/processes/process-1/logs?from=2&limit=1000",
      "/api/processes/process-1/logs?from=3&limit=1000",
    ]);
  });
});
