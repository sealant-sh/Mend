import { Schema } from "effect";

import { RunId } from "./ids.ts";

/**
 * A claim's link back to the recording: `(run, sequence)` addresses the exact
 * timeline entry in Sealant's record; the quoted excerpt is denormalized so
 * briefs render without a Sealant round-trip and stay readable forever.
 */
export class EvidencePointer extends Schema.Class<EvidencePointer>("EvidencePointer")({
  runId: RunId,
  sequence: Schema.BigInt,
  excerpt: Schema.String,
}) {}

/** Event provenance: the runtime saw it, or the harness claimed it. */
export const Provenance = Schema.Literals(["observed", "inferred"]);
export type Provenance = typeof Provenance.Type;
