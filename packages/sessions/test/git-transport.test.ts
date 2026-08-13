import { describe, expect, it } from "vitest";

import {
  frame,
  makeFrameFeed,
  makePushSniffer,
  parseGitRemoteCommand,
} from "../src/git-transport.ts";

describe("parseGitRemoteCommand", () => {
  it("names the three git transport verbs", () => {
    expect(parseGitRemoteCommand("git-upload-pack '/srv/repo.git'")).toEqual({ kind: "fetch" });
    expect(parseGitRemoteCommand("git-receive-pack '/srv/repo.git'")).toEqual({ kind: "push" });
    expect(parseGitRemoteCommand("git-upload-archive '/srv/repo.git'")).toEqual({
      kind: "archive",
    });
    expect(parseGitRemoteCommand("git upload-pack '/srv/repo.git'")).toEqual({ kind: "fetch" });
  });

  it("refuses everything that is not git transport", () => {
    expect(parseGitRemoteCommand("rm -rf /")).toBeNull();
    expect(parseGitRemoteCommand("git-upload-packx '/x'")).toBeNull();
    expect(parseGitRemoteCommand("bash -c 'git-upload-pack x'")).toBeNull();
    expect(parseGitRemoteCommand("git-upload-pack")).toBeNull();
  });
});

describe("frames", () => {
  it("round-trips through the feed, split at awkward boundaries", () => {
    const seen: Array<{ type: string; payload: string }> = [];
    const feed = makeFrameFeed((type, payload) => seen.push({ type, payload: payload.toString() }));
    const wire = Buffer.concat([
      frame("o", Buffer.from("hello")),
      frame("e", Buffer.from("warn")),
      frame("x", Buffer.from([3])),
    ]);
    // Feed byte by byte — a frame must never depend on chunk alignment.
    for (const byte of wire) feed(Buffer.from([byte]));
    expect(seen).toEqual([
      { type: "o", payload: "hello" },
      { type: "e", payload: "warn" },
      { type: "x", payload: "" },
    ]);
  });
});

const pkt = (line: string): Buffer => {
  const payload = Buffer.from(line);
  return Buffer.concat([Buffer.from((payload.length + 4).toString(16).padStart(4, "0")), payload]);
};

describe("makePushSniffer", () => {
  it("reads the ref commands ahead of the pack", () => {
    const oldSha = "a".repeat(40);
    const newSha = "b".repeat(40);
    const sniffer = makePushSniffer();
    const stream = Buffer.concat([
      pkt(`${oldSha} ${newSha} refs/heads/main\0 report-status side-band-64k`),
      pkt(`${oldSha} ${"c".repeat(40)} refs/heads/feature\n`),
      Buffer.from("0000"),
      Buffer.from("PACK..."),
    ]);
    // Split mid-pkt to prove reassembly.
    sniffer.feed(stream.subarray(0, 10));
    sniffer.feed(stream.subarray(10));
    expect(sniffer.updates()).toEqual([
      `${oldSha} ${newSha} refs/heads/main`,
      `${oldSha} ${"c".repeat(40)} refs/heads/feature`,
    ]);
  });

  it("answers null when the stream is not pkt-lines", () => {
    const sniffer = makePushSniffer();
    sniffer.feed(Buffer.from("not a pkt line at all"));
    expect(sniffer.updates()).toBeNull();
  });
});
