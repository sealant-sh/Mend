import { describe, expect, it } from "vitest";

import { proposeFromCompose, proposeFromPackageJson, renderMendToml } from "./service-init.ts";

describe("proposeFromPackageJson", () => {
  it("reads an explicit --port from the dev script", () => {
    const proposals = proposeFromPackageJson(
      JSON.stringify({ scripts: { dev: "vite --port 3000" } }),
      ["pnpm-lock.yaml"],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      name: "web",
      command: "pnpm run dev",
      port: 3000,
      guessed: false,
    });
  });

  it("falls back to the tool default, marked guessed", () => {
    const proposals = proposeFromPackageJson(JSON.stringify({ scripts: { dev: "vite" } }), [
      "yarn.lock",
    ]);
    expect(proposals[0]).toMatchObject({ command: "yarn run dev", port: 5173, guessed: true });
  });

  it("proposes nothing when no port can be named", () => {
    expect(proposeFromPackageJson(JSON.stringify({ scripts: { dev: "tsc --watch" } }), [])).toEqual(
      [],
    );
    expect(proposeFromPackageJson("not json", [])).toEqual([]);
  });
});

describe("proposeFromCompose", () => {
  it("reads published ports per service", () => {
    const proposals = proposeFromCompose(`
services:
  mysql:
    image: mysql:8
    ports:
      - "3306:3306"
  redis:
    image: redis:7
    ports:
      - 6379:6379
  internal:
    image: worker:1
`);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      name: "mysql",
      command: "docker compose up mysql",
      port: 3306,
    });
    expect(proposals[1]).toMatchObject({ name: "redis", port: 6379 });
  });
});

describe("renderMendToml", () => {
  it("renders a commented, committable file", () => {
    const toml = renderMendToml([
      { name: "web", command: "pnpm run dev", port: 5173, guessed: true, source: "package.json" },
      {
        name: "mysql",
        command: "docker compose up mysql",
        port: 3306,
        guessed: false,
        source: "compose",
      },
    ]);
    expect(toml).toContain("[service.web]");
    expect(toml).toContain('command = "pnpm run dev"');
    expect(toml).toContain("port = 5173 # guessed — verify");
    expect(toml).toContain("[service.mysql]");
    expect(toml).toContain("port = 3306\n");
  });
});
