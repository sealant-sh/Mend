import { workspaceImagesEqual } from "@mend/domain";

import type { SettingsDto, WorkspacePackageResolutionDto } from "./api";

export { workspaceImagesEqual };

type WorkspaceImage = SettingsDto["workspaceImage"];

export const parsePackageDraft = (draft: string) => {
  const packages = [
    ...new Set(
      draft
        .split(/[\n,]/)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value !== ""),
    ),
  ];
  const invalid = packages.find((value) => !/^[a-z0-9][a-z0-9._:+-]*$/.test(value));
  return invalid === undefined ? { packages, invalid: null } : { packages, invalid };
};

export interface WorkspaceEnvironmentFormState {
  readonly savedImage: WorkspaceImage;
  readonly os: WorkspaceImage["os"];
  readonly docker: boolean;
  readonly packageDraft: string;
  readonly phase: "idle" | "saving" | "saved";
  readonly resolutions: ReadonlyArray<WorkspacePackageResolutionDto> | null;
  readonly error: string | null;
}

export type WorkspaceEnvironmentFormAction =
  | { readonly type: "os-changed"; readonly os: WorkspaceImage["os"] }
  | { readonly type: "docker-toggled" }
  | { readonly type: "packages-changed"; readonly packageDraft: string }
  | {
      readonly type: "suggestions-applied";
      readonly packageIds: ReadonlyArray<string>;
      readonly dockerObserved: boolean;
    }
  | { readonly type: "save-started" }
  | {
      readonly type: "save-rejected";
      readonly resolutions: ReadonlyArray<WorkspacePackageResolutionDto>;
    }
  | {
      readonly type: "save-succeeded";
      readonly workspaceImage: WorkspaceImage;
      readonly resolutions: ReadonlyArray<WorkspacePackageResolutionDto>;
    }
  | { readonly type: "save-failed"; readonly message: string };

export const createWorkspaceEnvironmentForm = (
  workspaceImage: WorkspaceImage,
): WorkspaceEnvironmentFormState => ({
  savedImage: workspaceImage,
  os: workspaceImage.os,
  docker: workspaceImage.services.docker,
  packageDraft: workspaceImage.packages.join("\n"),
  phase: "idle",
  resolutions: null,
  error: null,
});

const edited = (state: WorkspaceEnvironmentFormState): WorkspaceEnvironmentFormState => ({
  ...state,
  phase: "idle",
  resolutions: null,
  error: null,
});

export const workspaceEnvironmentFormReducer = (
  state: WorkspaceEnvironmentFormState,
  action: WorkspaceEnvironmentFormAction,
): WorkspaceEnvironmentFormState => {
  switch (action.type) {
    case "os-changed":
      return edited({ ...state, os: action.os });
    case "docker-toggled":
      return { ...state, docker: !state.docker, phase: "idle", error: null };
    case "packages-changed":
      return edited({ ...state, packageDraft: action.packageDraft });
    case "suggestions-applied": {
      const currentPackages = parsePackageDraft(state.packageDraft).packages;
      const packages = [...new Set([...currentPackages, ...action.packageIds])];
      return edited({
        ...state,
        packageDraft: packages.join("\n"),
        docker: state.docker || action.dockerObserved,
      });
    }
    case "save-started":
      return { ...state, phase: "saving", error: null };
    case "save-rejected":
      return { ...state, phase: "idle", resolutions: action.resolutions, error: null };
    case "save-succeeded":
      return {
        savedImage: action.workspaceImage,
        os: action.workspaceImage.os,
        docker: action.workspaceImage.services.docker,
        packageDraft: action.workspaceImage.packages.join("\n"),
        phase: "saved",
        resolutions: action.resolutions,
        error: null,
      };
    case "save-failed":
      return { ...state, phase: "idle", error: action.message };
  }
};

export const workspaceImageFromForm = (state: WorkspaceEnvironmentFormState): WorkspaceImage => ({
  os: state.os,
  packages: parsePackageDraft(state.packageDraft).packages,
  services: { docker: state.docker },
});

export const resolutionIssue = (
  resolution: WorkspacePackageResolutionDto,
  os: SettingsDto["workspaceImage"]["os"],
) => {
  if (resolution.status === "resolved" && resolution.supported) return null;
  if (resolution.status === "ambiguous") {
    return resolution.alternatives.length === 0
      ? "Sealant found more than one possible package."
      : `Sealant found more than one match. Try ${resolution.alternatives.join(", ")}.`;
  }
  if (resolution.status === "not-found") return "Sealant could not find this package.";
  if (resolution.status === "invalid") return "Sealant rejected this package name.";
  return `Sealant found the package, but not for ${os === "arch" ? "Arch" : "Nix"}.`;
};
