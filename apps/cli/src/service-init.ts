/**
 * `mend service init` — the mend.toml scaffolder (docs/SESSION-SERVICES.md).
 * Static suggestion, not detection: an offline read of manifests the project
 * already ships (package.json scripts, compose files), producing a proposal
 * the user confirms and commits. Nothing runs; nothing is observed.
 *
 * Pure functions here; the command in main.ts does the I/O.
 */

export interface ServiceProposal {
  readonly name: string;
  readonly command: string;
  readonly port: number;
  /** True when the port came from a tool default, not the manifest. */
  readonly guessed: boolean;
  /** Where the proposal came from — lands in the file as a comment. */
  readonly source: string;
}

/** Scripts that mean "a server" in practice; dev first, the rest as extras. */
const SERVER_SCRIPTS = ["dev", "start", "serve", "preview"];

/** Tool defaults for when the script names no port. */
const TOOL_PORTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bvite\b(?!.*build)/, 5173],
  [/\bnext dev\b/, 3000],
  [/\bnuxt\b/, 3000],
  [/\bastro dev\b/, 4321],
  [/\bremix\b/, 3000],
];

const portFromScript = (script: string): { port: number; guessed: boolean } | null => {
  const explicit =
    /(?:--port[= ]|(?<![\w-])-p[= ])(\d{2,5})/.exec(script) ?? /\bPORT=(\d{2,5})/.exec(script);
  if (explicit?.[1] !== undefined) {
    const port = Number(explicit[1]);
    if (port >= 1 && port <= 65535) return { port, guessed: false };
  }
  for (const [pattern, port] of TOOL_PORTS) {
    if (pattern.test(script)) return { port, guessed: true };
  }
  return null;
};

const packageManagerOf = (lockfiles: ReadonlyArray<string>): string => {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("bun.lockb") || lockfiles.includes("bun.lock")) return "bun";
  return "npm";
};

/** Proposals from package.json scripts. `files` = names present in the repo root. */
export const proposeFromPackageJson = (
  packageJsonText: string,
  rootFiles: ReadonlyArray<string>,
): ReadonlyArray<ServiceProposal> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const scripts = (parsed as { scripts?: Record<string, unknown> }).scripts;
  if (typeof scripts !== "object" || scripts === null) return [];

  const pm = packageManagerOf(rootFiles);
  const proposals: ServiceProposal[] = [];
  for (const scriptName of SERVER_SCRIPTS) {
    const script = scripts[scriptName];
    if (typeof script !== "string") continue;
    const port = portFromScript(script);
    if (port === null) continue; // no port, no Service — the user can add one by hand
    proposals.push({
      name: scriptName === "dev" ? "web" : scriptName,
      command: `${pm} run ${scriptName}`,
      port: port.port,
      guessed: port.guessed,
      source: `package.json "${scriptName}": ${script}`,
    });
    break; // one entry from scripts — the first server-ish one wins
  }
  return proposals;
};

/**
 * Proposals from a compose file: every service with a published port becomes
 * `docker compose up <name>` at the HOST side of the first mapping — that is
 * where the workspace's docker sidecar publishes it.
 */
export const proposeFromCompose = (composeText: string): ReadonlyArray<ServiceProposal> => {
  // Deliberately narrow YAML reading: top-level `services:`, two-space
  // indented names, `ports:` entries as "- host:container". A full YAML
  // parser is not worth a dependency for a suggestion.
  const proposals: ServiceProposal[] = [];
  const lines = composeText.split("\n");
  let inServices = false;
  let current: string | null = null;
  let inPorts = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (inServices && /^\S/.test(line)) {
      inServices = false; // left the services block
    }
    if (!inServices) continue;
    const serviceHead = /^ {2}([A-Za-z0-9._-]+):\s*$/.exec(line);
    if (serviceHead?.[1] !== undefined) {
      current = serviceHead[1];
      inPorts = false;
      continue;
    }
    if (current === null) continue;
    if (/^\s+ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    if (inPorts) {
      const mapping =
        /^\s+-\s+["']?(\d{2,5}):/.exec(line) ??
        /^\s+-\s+["']?\$\{[A-Z_a-z0-9]+:-(\d{2,5})\}:/.exec(line) ??
        /^\s+-\s+["']?(\d{2,5})["']?\s*$/.exec(line);
      if (mapping?.[1] !== undefined) {
        const port = Number(mapping[1]);
        if (port >= 1 && port <= 65535 && !proposals.some((p) => p.name === current)) {
          proposals.push({
            name: current,
            command: `docker compose up ${current}`,
            port,
            guessed: false,
            source: `compose service "${current}" publishes :${mapping[1]}`,
          });
        }
        inPorts = false; // first mapping wins
        continue;
      }
      if (!/^\s+-/.test(line)) inPorts = false;
    }
  }
  return proposals;
};

/** Any compose flavor counts: compose.yaml, docker-compose.yml, compose.dev.yaml… */
export const isComposeFile = (name: string): boolean =>
  /^(docker-)?compose(\.[\w.-]+)?\.ya?ml$/.test(name);

/** Workspace dir globs from pnpm-workspace.yaml / package.json "workspaces". Single-level only. */
export const workspaceGlobs = (
  pnpmWorkspaceText: string | null,
  packageJsonText: string | null,
): ReadonlyArray<string> => {
  const globs: string[] = [];
  if (pnpmWorkspaceText !== null) {
    let inPackages = false;
    for (const line of pnpmWorkspaceText.split("\n")) {
      if (/^packages:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (inPackages && /^\S/.test(line)) inPackages = false;
      if (!inPackages) continue;
      const entry = /^\s+-\s+["']?([^"'#]+?)["']?\s*$/.exec(line);
      if (entry?.[1] !== undefined && !entry[1].startsWith("!")) globs.push(entry[1].trim());
    }
  }
  if (packageJsonText !== null) {
    try {
      const parsed = JSON.parse(packageJsonText) as { workspaces?: unknown };
      if (Array.isArray(parsed.workspaces)) {
        globs.push(...parsed.workspaces.filter((g): g is string => typeof g === "string"));
      }
    } catch {
      // no workspaces to read
    }
  }
  return globs;
};

/** A workspace package's proposal: named after its folder, run through the package manager. */
export const proposeFromWorkspacePackage = (
  dirName: string,
  packageJsonText: string,
  rootFiles: ReadonlyArray<string>,
): ReadonlyArray<ServiceProposal> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const pkg = parsed as { name?: unknown; scripts?: Record<string, unknown> };
  const scripts = pkg.scripts;
  if (typeof scripts !== "object" || scripts === null) return [];
  const pkgName = typeof pkg.name === "string" ? pkg.name : dirName;
  const pm = packageManagerOf(rootFiles);
  const runner =
    pm === "pnpm"
      ? (script: string) => `pnpm --filter ${pkgName} ${script}`
      : pm === "yarn"
        ? (script: string) => `yarn workspace ${pkgName} ${script}`
        : (script: string) => `${pm} run ${script} --workspace ${pkgName}`;
  for (const scriptName of SERVER_SCRIPTS) {
    const script = scripts[scriptName];
    if (typeof script !== "string") continue;
    const port = portFromScript(script);
    if (port === null) continue;
    return [
      {
        name: dirName,
        command: runner(scriptName),
        port: port.port,
        guessed: port.guessed,
        source: `${dirName}/package.json "${scriptName}": ${script}`,
      },
    ];
  }
  return [];
};

/** The proposal as the file the user will commit. */
export const renderMendToml = (proposals: ReadonlyArray<ServiceProposal>): string => {
  const blocks = proposals.map((proposal) => {
    const lines = [
      `# ${proposal.source}`,
      `[service.${proposal.name}]`,
      `command = ${JSON.stringify(proposal.command)}`,
      proposal.guessed ? `port = ${proposal.port} # guessed — verify` : `port = ${proposal.port}`,
    ];
    return lines.join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
};
