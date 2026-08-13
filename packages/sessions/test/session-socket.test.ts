import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

import { SessionId } from "@mend/domain";
import { SessionSocketHost, SessionSocketHostLive } from "@mend/sessions";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

/**
 * The in-workspace control surface over a REAL unix socket: bind, stage the
 * helper, route to the provided closures, tear down.
 */

process.env["MEND_RUN_DIR"] = path.join(os.tmpdir(), `mend-socket-test-${process.pid}`);

const SESSION = SessionId.make("sess-socket-1");

const call = (
  socketPath: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> =>
  new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method, path: route }, (response) => {
      let text = "";
      response.on("data", (chunk) => (text += String(chunk)));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, json: text === "" ? null : JSON.parse(text) }),
      );
    });
    request.on("error", reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });

describe("SessionSocketHost", () => {
  it("serves the session-scoped api over the socket and stages the helper", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* SessionSocketHost;
          const seen: unknown[] = [];
          const dir = yield* host.start(SESSION, {
            recipes: () => Effect.succeed([{ name: "web", command: "pnpm dev", port: 3000 }]),
            listServices: () => Effect.succeed([]),
            runService: (argv, port, name) =>
              Effect.sync(() => {
                seen.push({ argv, port, name });
                return { id: "svc-1", label: name, status: "reachable" };
              }),
            addService: () => Effect.succeed({}),
            stopService: () => Effect.succeed({}),
            restartService: () => Effect.die("unused"),
          });
          const socketPath = path.join(dir, "mend.sock");

          const recipes = yield* Effect.promise(() => call(socketPath, "GET", "/recipes"));
          expect(recipes.status).toBe(200);
          expect(recipes.json).toEqual([{ name: "web", command: "pnpm dev", port: 3000 }]);

          const run = yield* Effect.promise(() =>
            call(socketPath, "POST", "/services/run", {
              argv: ["sh", "-c", "pnpm dev"],
              port: 3000,
              name: "web",
            }),
          );
          expect(run.status).toBe(200);
          expect(seen).toEqual([{ argv: ["sh", "-c", "pnpm dev"], port: 3000, name: "web" }]);

          const missing = yield* Effect.promise(() => call(socketPath, "GET", "/nope"));
          expect(missing.status).toBe(404);

          // The helper is staged, executable, and hardcodes the mount path.
          const helper = yield* Effect.promise(() =>
            import("node:fs/promises").then((fs) =>
              fs.readFile(path.join(dir, "bin", "mend"), "utf8"),
            ),
          );
          expect(helper).toContain("/run/mend/mend.sock");

          yield* host.stop(SESSION);
          const refused = yield* Effect.promise(() =>
            call(socketPath, "GET", "/services").then(
              () => false,
              () => true,
            ),
          );
          expect(refused).toBe(true);
        }),
      ).pipe(Effect.provide(SessionSocketHostLive)),
    );
  });
});
