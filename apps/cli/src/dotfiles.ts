import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Local dotfiles scanning for `mend dotfiles sync`. This runs on the machine that HAS the
 * files — the whole point: the Mend server may be a VPS whose home directory is a service
 * account's, so contents are captured here and streamed to the server's per-user dotfiles store.
 *
 * The candidate list mirrors the product's curated set (plain configuration only — never keys,
 * credential stores, or histories). The CLI stays dependency-light by design, so the list is
 * duplicated here rather than imported from a workspace package.
 */
export const DOTFILE_CANDIDATES: ReadonlyArray<{
  readonly group: string;
  readonly paths: ReadonlyArray<string>;
}> = [
  {
    group: "shell",
    paths: [
      ".zshrc",
      ".zshenv",
      ".zprofile",
      ".bashrc",
      ".bash_profile",
      ".profile",
      ".aliases",
      ".config/fish/config.fish",
      ".config/starship.toml",
    ],
  },
  {
    group: "git",
    paths: [".gitconfig", ".gitignore_global", ".config/git/config", ".config/git/ignore"],
  },
  {
    group: "editors",
    paths: [".vimrc", ".ideavimrc", ".editorconfig", ".config/helix/config.toml"],
  },
  {
    group: "terminal",
    paths: [".tmux.conf", ".config/tmux/tmux.conf", ".inputrc", ".dir_colors"],
  },
  {
    group: "tools",
    paths: [
      ".ripgreprc",
      ".config/bat/config",
      ".config/lazygit/config.yml",
      ".config/mise/config.toml",
      ".config/atuin/config.toml",
      ".config/zellij/config.kdl",
    ],
  },
];

export interface ScannedDotfile {
  readonly path: string;
  readonly group: string;
  readonly bytes: number;
}

export interface SyncFile {
  readonly path: string;
  readonly contentsBase64: string;
  readonly mode: string;
}

/** The per-file cap the server enforces; checked here so a mistake fails before the upload. */
export const MAX_FILE_BYTES = 1024 * 1024;

const statFile = (home: string, relative: string): fs.Stats | null => {
  try {
    const stat = fs.statSync(path.join(home, relative));
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
};

/** Probe the curated candidates under `home`; only existing regular files appear. */
export const scanDotfileCandidates = (home: string): ReadonlyArray<ScannedDotfile> =>
  DOTFILE_CANDIDATES.flatMap(({ group, paths }) =>
    paths.flatMap((relative) => {
      const stat = statFile(home, relative);
      return stat === null ? [] : [{ path: relative, group, bytes: stat.size }];
    }),
  );

/**
 * Read the selected paths for upload. Explicitly requested paths must exist (a typo should fail,
 * not silently sync nothing); oversized files fail with the server's own rule. Modes ride along
 * so an executable script stays executable.
 */
export const readSyncFiles = (
  home: string,
  paths_: ReadonlyArray<string>,
): { readonly files: ReadonlyArray<SyncFile> } | { readonly error: string } => {
  const files: SyncFile[] = [];
  for (const relative of paths_) {
    const stat = statFile(home, relative);
    if (stat === null) {
      return { error: `${relative} is not a file under ${home}` };
    }
    if (stat.size > MAX_FILE_BYTES) {
      return { error: `${relative} is over 1MB — dotfiles are text; trim the selection` };
    }
    files.push({
      path: relative,
      contentsBase64: fs.readFileSync(path.join(home, relative)).toString("base64"),
      // eslint-disable-next-line no-bitwise -- permission bits are the point
      mode: (stat.mode & 0o777).toString(8),
    });
  }
  return { files };
};
