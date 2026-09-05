import { spawn } from "node:child_process";
import * as path from "node:path";

/** Captured process result. Expected spawn failures do not reject. */
export interface ServerProcessOutput {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

/**
 * Run Docker with a controlled environment. Shell interpolation and COMPOSE_* / DOCKER_HOST
 * cannot override persisted configuration. Context credentials still come from Docker's config.
 * Capture the parent environment once at the lifecycle command boundary and pass it here.
 */
export const runServerProcess = (
  command: string,
  args: ReadonlyArray<string>,
  parentEnvironment: NodeJS.ProcessEnv,
): Promise<ServerProcessOutput> => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
    "DOCKER_CONFIG",
    "SSH_AUTH_SOCK",
    "TMPDIR",
    "TMP",
    "TEMP",
  ]) {
    if (parentEnvironment[key] !== undefined) env[key] = parentEnvironment[key];
  }
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => resolve({ status: null, stdout, stderr, error: error.message }));
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
};

/** Build every lifecycle Compose invocation against one immutable generation and explicit context. */
export const serverComposeArgs = (
  installation: { readonly directory: string; readonly dockerContext: string },
  command: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  "--context",
  installation.dockerContext,
  "compose",
  "--project-name",
  "mend",
  "--project-directory",
  installation.directory,
  "--env-file",
  path.join(installation.directory, "server.env"),
  "-f",
  path.join(installation.directory, "compose.yaml"),
  ...command,
];
