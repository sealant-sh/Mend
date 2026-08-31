import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CheckpointId, SealantRunId, SessionId, WorktreeId, Sha } from "./ids.ts";
import { SequenceNumber, Timestamp } from "./timestamp.ts";
import { Checkpoint } from "./workbench/checkpoint.ts";

const decode = Schema.decodeUnknownSync(Timestamp);
const encode = Schema.encodeUnknownSync(Timestamp);

describe("Timestamp", () => {
  it("decodes the JSON wire form (ISO string) into a Date", () => {
    const decoded = decode("2026-08-25T10:00:00.000Z");
    expect(decoded).toBeInstanceOf(Date);
    expect(decoded.toISOString()).toBe("2026-08-25T10:00:00.000Z");
  });

  it("decodes a pg row's Date instance untouched", () => {
    const row = new Date("2026-08-25T10:00:00.000Z");
    expect(decode(row)).toBeInstanceOf(Date);
    expect(decode(row).getTime()).toBe(row.getTime());
  });

  it("encodes to the wire form — an ISO string, never a Date", () => {
    expect(encode(new Date("2026-08-25T10:00:00.000Z"))).toBe("2026-08-25T10:00:00.000Z");
  });

  it("rejects garbage strings, invalid dates and non-date values", () => {
    expect(() => decode("not a date")).toThrow();
    expect(() => decode(new Date("nope"))).toThrow();
    expect(() => decode(1756116000000)).toThrow();
    expect(() => decode(null)).toThrow();
  });

  it("survives the full HTTP round trip a client validates against", () => {
    // The exact production pipeline: the API serializes success schemas
    // through Schema.toCodecJson (HttpApiEndpoint does this internally — it is
    // how a Date leaves as an ISO string and a bigint as a decimal string),
    // JSON carries it, and the web tier's tRPC router decodes the parsed body
    // against the same derived codec. Schema.Date/Schema.BigInt could not make
    // this trip; Timestamp and SequenceNumber must.
    const wireCodec = Schema.toCodecJson(Checkpoint);
    const checkpoint = new Checkpoint({
      id: CheckpointId.make("cp_1"),
      worktreeId: WorktreeId.make("wt_1"),
      sessionId: SessionId.make("ses_1"),
      ordinal: 1,
      ref: "refs/mend/checkpoints/wt_1/1",
      sha: Sha.make("0123abcd"),
      sealantRunId: SealantRunId.make("run_1"),
      seq: 42n,
      trigger: "review-open",
      createdAt: new Date("2026-08-25T10:00:00.000Z"),
    });
    const wire: unknown = JSON.parse(
      JSON.stringify(Schema.encodeUnknownSync(wireCodec)(checkpoint)),
    );
    const revived = Schema.decodeUnknownSync(wireCodec)(wire);
    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.createdAt.toISOString()).toBe("2026-08-25T10:00:00.000Z");
    expect(revived.seq).toBe(42n);
  });

  it("decodes both sequence producers: wire strings and pg bigints", () => {
    const decodeSeq = Schema.decodeUnknownSync(SequenceNumber);
    expect(decodeSeq("42")).toBe(42n);
    expect(decodeSeq(42n)).toBe(42n);
    expect(() => decodeSeq(42)).toThrow();
    expect(Schema.encodeUnknownSync(SequenceNumber)(42n)).toBe("42");
  });
});
