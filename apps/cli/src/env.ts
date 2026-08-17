/**
 * `mend env`: load a dotenv file into the project's env store, and show what is stored. Parsing
 * AND routing happen SERVER-SIDE (one parser for the CLI and the browser); the CLI ships the file
 * text once and prints the per-name report. Values are never printed.
 */

/** The server's per-name report for a load. */
export interface EnvironmentLoadReportDto {
  readonly loaded: ReadonlyArray<{
    readonly name: string;
    readonly lane: "configuration" | "secret";
    readonly action: "created" | "updated" | "moved";
  }>;
  readonly rejected: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
  readonly malformedLines: ReadonlyArray<number>;
  readonly environmentRevision: number;
  readonly secretRevision: number;
}

/** Render the report as terse status lines — names, lanes, actions, reasons; never a value. */
export const formatLoadReport = (
  report: EnvironmentLoadReportDto,
  paint: { readonly dim: (s: string) => string; readonly warn: (s: string) => string },
): ReadonlyArray<string> => {
  const width = Math.max(
    0,
    ...report.loaded.map((entry) => entry.name.length),
    ...report.rejected.map((entry) => entry.name.length),
  );
  const lines: Array<string> = [];
  for (const entry of report.loaded) {
    lines.push(
      `  ${entry.name.padEnd(width)}  ${entry.lane === "secret" ? "secret" : "configuration"} ${paint.dim(`· ${entry.action}${entry.lane === "configuration" ? " · plaintext" : ""}`)}`,
    );
  }
  for (const entry of report.rejected) {
    lines.push(
      `  ${entry.name.padEnd(width)}  ${paint.warn("rejected")} ${paint.dim(`· ${entry.reason}`)}`,
    );
  }
  return lines;
};
