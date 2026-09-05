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
 * A supplied timeout kills the child and waits for close before returning; no command keeps
 * running while its caller starts cleanup.
 */
export const runServerProcess = (
  command: string,
  args: ReadonlyArray<string>,
  parentEnvironment: NodeJS.ProcessEnv,
  options?: { readonly timeoutMs: number },
): Promise<ServerProcessOutput> => {
  if (options !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
    return Promise.resolve({
      status: null,
      stdout: "",
      stderr: "",
      error: "Invalid process timeout",
    });
  }
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
    let failure: string | undefined;
    const timer =
      options === undefined
        ? undefined
        : setTimeout(() => {
            failure = `Process timed out after ${options.timeoutMs}ms`;
            child.kill("SIGKILL");
          }, options.timeoutMs);
    // Even spawn errors emit close. Cleanup must not race a still-running Docker command.
    child.once("error", (error) => {
      failure ??= error.message;
    });
    child.once("close", (status) => {
      globalThis.clearTimeout(timer);
      resolve({ status, stdout, stderr, ...(failure === undefined ? {} : { error: failure }) });
    });
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
