import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readServiceRecipes, RecipeFileError } from "@mend/sessions";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

const worktreeWith = (toml: string | null): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mend-recipes-"));
  if (toml !== null) {
    fs.writeFileSync(path.join(dir, "mend.toml"), toml);
  }
  return dir;
};

describe("readServiceRecipes", () => {
  it("reads a udp recipe and defaults protocol to tcp", async () => {
    const worktree = worktreeWith(
      [
        "[service.game]",
        'command = "./server"',
        "port = 34197",
        'protocol = "udp"',
        "",
        "[service.web]",
        'command = "pnpm dev"',
        "port = 3000",
      ].join("\n"),
    );
    const recipes = await Effect.runPromise(readServiceRecipes(worktree));
    expect(recipes.find((r) => r.name === "game")?.protocol).toBe("udp");
    expect(recipes.find((r) => r.name === "web")?.protocol).toBe("tcp");
  });

  it("refuses a protocol that is neither tcp nor udp", async () => {
    const worktree = worktreeWith(["[service.x]", "port = 1", 'protocol = "sctp"'].join("\n"));
    await expect(Effect.runPromise(readServiceRecipes(worktree))).rejects.toThrow(/protocol/);
  });

  it("reads run and adopt recipes", async () => {
    const worktree = worktreeWith(`
[service.web]
command = "pnpm dev"
port = 3000

[service.db]
# an already-listening port to adopt
port = 5432
`);
    const recipes = await Effect.runPromise(readServiceRecipes(worktree));
    expect(recipes).toHaveLength(2);
    expect(recipes[0]).toMatchObject({ name: "web", command: "pnpm dev", port: 3000 });
    expect(recipes[1]).toMatchObject({ name: "db", command: null, port: 5432 });
  });

  it("a missing file declares nothing", async () => {
    const recipes = await Effect.runPromise(readServiceRecipes(worktreeWith(null)));
    expect(recipes).toEqual([]);
  });

  it("a file without [service] declares nothing", async () => {
    const recipes = await Effect.runPromise(readServiceRecipes(worktreeWith(`title = "x"\n`)));
    expect(recipes).toEqual([]);
  });

  it("invalid TOML is a typed error naming the file", async () => {
    const error = await Effect.runPromise(
      readServiceRecipes(worktreeWith("[service.web\nport=")).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(RecipeFileError);
    expect(error.message).toContain("not valid TOML");
  });

  it("a recipe without a usable port is refused", async () => {
    const error = await Effect.runPromise(
      readServiceRecipes(worktreeWith(`[service.web]\ncommand = "pnpm dev"\n`)).pipe(Effect.flip),
    );
    expect(error.message).toContain("needs a port");
  });

  it("a bad name is refused", async () => {
    const error = await Effect.runPromise(
      readServiceRecipes(worktreeWith(`[service."Web App"]\nport = 3000\n`)).pipe(Effect.flip),
    );
    expect(error.message).toContain("not a usable Service name");
  });
});
