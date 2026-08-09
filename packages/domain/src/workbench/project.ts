import { Schema } from "effect";

import { ProjectId, Sha } from "../ids.ts";

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
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}
