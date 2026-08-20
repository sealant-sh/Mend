import { Schema } from "effect";

import { ProjectId, Sha } from "../ids.ts";
import { WorkspaceImage } from "../settings.ts";

/**
 * A project's stance on one review-automation switch: follow the Settings
 * default, or override it either way. The cascade has exactly these two
 * levels — a session takes whatever its project resolves to at settle.
 */
export const AutomationChoice = Schema.Literals(["inherit", "on", "off"]);
export type AutomationChoice = typeof AutomationChoice.Type;

export const resolveAutomation = (choice: AutomationChoice, settingsDefault: boolean): boolean =>
  choice === "inherit" ? settingsDefault : choice === "on";

/**
 * How host-side git reaches this project's remote (docs/GIT-ACCESS.md):
 * `ambient` uses the login user's git/ssh setup unchanged; `mend-key` uses the
 * machine's Mend-generated deploy key (`~/.config/mend/keys/`), whose private half
 * never leaves the host; `bridge` signs through an ssh-agent shared from
 * another machine via `mend keys share` — the key (often hardware) physically
 * stays there, and ops fail readably when no signer is connected. All modes
 * run ssh with BatchMode=yes — a daemon cannot answer a prompt, so auth
 * failures surface as readable errors instead of hangs.
 */
export const GitAuthMode = Schema.Literals(["ambient", "mend-key", "bridge"]);
export type GitAuthMode = typeof GitAuthMode.Type;

/** What a workspace git transport op is doing, named by its remote command. */
export type GitTransportKind = "fetch" | "push" | "archive";

/**
 * A repository adopted into Mend's central store on this machine (plan §5.2).
 * Adoption clones the repository into the store; the store copy is canonical
 * for Mend. The user's pre-existing checkout, if any, is a peer that syncs
 * through git — never an execution target.
 */
export class Project extends Schema.Class<Project>("Project")({
  id: ProjectId,
  /** Short name; also the store directory name. */
  name: Schema.String,
  /** Where the repo was adopted from — a remote URL or a local path. Null for bare-created repos. */
  originUrl: Schema.NullOr(Schema.String),
  /** Absolute path of the bare repo inside the store: `<storeRoot>/<name>/repo.git`. */
  storePath: Schema.String,
  defaultBranch: Schema.String,
  /** HEAD of the default branch at adoption — display only; git is the source of truth. */
  adoptedSha: Schema.NullOr(Sha),
  /** Override of the Settings default: compose the tour when a session settles. */
  autoTour: AutomationChoice,
  /** Override of the Settings default: run the suggestion pass when a session settles. */
  autoSuggest: AutomationChoice,
  /** How host-side git authenticates to this project's remote. */
  gitAuthMode: GitAuthMode,
  /** Override of the Settings default workspace image; null inherits it. */
  workspaceImage: Schema.NullOr(WorkspaceImage),
  /**
   * Whether sessions here receive the launching user's dotfiles (per-user store + repo). A
   * boolean, not a cascade: dotfiles are identity, so the only project-level question is
   * "does this project want them applied".
   */
  applyDotfiles: Schema.Boolean,
  /**
   * How many hot workspaces to keep ready for new sessions (0 = none). Each is a fully
   * pre-provisioned worktree + live workspace a new session claims at start, so the attach is
   * effectively instant. Explicit resource intent: N ready containers per project.
   */
  hotSessions: Schema.Number,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}
