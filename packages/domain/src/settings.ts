import { Effect, Schema } from "effect";

/**
 * PR timing has exactly two modes; there is no third.
 * Default: every successful run opens a draft PR immediately.
 */
export const PrMode = Schema.Literals(["draft-immediately", "pr-on-approval"]);
export type PrMode = typeof PrMode.Type;

/** Rows written before a switch existed decode to its default — never a failed read. */
const onByDefault = Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)));

export const WorkspaceImageOs = Schema.Literals(["fedora", "arch", "nix", "ubuntu"]);
export type WorkspaceImageOs = typeof WorkspaceImageOs.Type;

const DEFAULT_WORKSPACE_PACKAGES: ReadonlyArray<string> = [
  "pnpm",
  "python",
  "uv",
  "mise",
  "github-cli",
  "lazygit",
  "bat",
  "curl",
  "jq",
  "ripgrep",
  "fd",
  "fzf",
];

const workspaceImageServices = Schema.Struct({
  docker: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefaultKey(Effect.succeed({ docker: true })));

/**
 * A managed OS family image: distro base, portable package names resolved by the platform
 * against that distro's archive. Rows written before custom mode existed decode here — a
 * missing `mode` key defaults to `"family"`.
 */
export const FamilyWorkspaceImage = Schema.Struct({
  mode: Schema.Literals(["family"]).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("family" as const)),
  ),
  os: WorkspaceImageOs,
  packages: Schema.Array(Schema.String),
  services: workspaceImageServices,
});
export type FamilyWorkspaceImage = typeof FamilyWorkspaceImage.Type;

/**
 * A custom base image: any OCI reference the user already trusts. Deliberately exactly three
 * knobs — base image ref, extra packages (passed verbatim to the base's own package manager),
 * and setup commands (run in the workspace before the harness launches). NOT a compose editor:
 * the workspace is one container; compose already lives inside it (the dind sidecar).
 */
export const CustomWorkspaceImage = Schema.Struct({
  mode: Schema.Literals(["custom"]),
  baseImage: Schema.String,
  packages: Schema.Array(Schema.String),
  setupCommands: Schema.Array(Schema.String),
  services: workspaceImageServices,
});
export type CustomWorkspaceImage = typeof CustomWorkspaceImage.Type;

export const WorkspaceImage = Schema.Union([FamilyWorkspaceImage, CustomWorkspaceImage]);
export type WorkspaceImage = typeof WorkspaceImage.Type;

export const defaultWorkspaceImage: WorkspaceImage = {
  mode: "family",
  os: "arch",
  packages: [...DEFAULT_WORKSPACE_PACKAGES],
  services: { docker: true },
};

const listsEqual = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const workspaceImagesEqual = (left: WorkspaceImage, right: WorkspaceImage): boolean => {
  if (
    left.services.docker !== right.services.docker ||
    !listsEqual(left.packages, right.packages)
  ) {
    return false;
  }
  if (left.mode === "family" && right.mode === "family") {
    return left.os === right.os;
  }
  if (left.mode === "custom" && right.mode === "custom") {
    return (
      left.baseImage === right.baseImage && listsEqual(left.setupCommands, right.setupCommands)
    );
  }
  return false;
};

const workspaceImageWithDefault = WorkspaceImage.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(defaultWorkspaceImage)),
);

export class MendSettings extends Schema.Class<MendSettings>("MendSettings")({
  prMode: PrMode,
  /** How many issues mend at once — the dispatcher fills free slots from the top of queued. */
  concurrency: Schema.Int,
  /**
   * Review automation defaults — the machine-side prep that runs when a
   * session settles, so review opens ready. Each switch is overridable per
   * project (`inherit` follows these): the cascade is settings → project,
   * resolved per session at settle.
   */
  /** Compose the tour when a session settles — description and walkthrough ready before review opens. */
  autoTour: onByDefault,
  /** Run the suggestion pass when a session settles — strict, code-anchored; zero suggestions is normal. */
  autoSuggest: onByDefault,
  /** Base operating system and additional tools baked into every new session workspace. */
  workspaceImage: workspaceImageWithDefault,
}) {}

export const defaultSettings = new MendSettings({
  prMode: "draft-immediately",
  concurrency: 1,
  autoTour: true,
  autoSuggest: true,
  workspaceImage: defaultWorkspaceImage,
});
