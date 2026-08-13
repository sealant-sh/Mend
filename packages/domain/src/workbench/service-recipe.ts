import { Schema } from "effect";

/**
 * A declared Service recipe (docs/SESSION-SERVICES.md): one entry of the
 * repo's `mend.toml`, versioned with the code. A recipe is intent, never a
 * running process — `mend service run <name>` starts one; a command-less
 * entry is an `add` recipe (an already-listening port to adopt).
 */
export class ServiceRecipe extends Schema.Class<ServiceRecipe>("ServiceRecipe")({
  name: Schema.String,
  /** Shell command to supervise; null = adopt-only (compose sidecar, external daemon). */
  command: Schema.NullOr(Schema.String),
  /** The port the Service listens on inside the workspace. */
  port: Schema.Int,
  /** Where it was declared: the repo's mend.toml (travels, reviewable) or this machine's project row. */
  source: Schema.Literals(["file", "project"]),
}) {}
