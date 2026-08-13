import { describe, expect, it } from "vitest";

import {
  isComposeFile,
  proposeFromCompose,
  proposeFromPackageJson,
  proposeFromWorkspacePackage,
  renderMendToml,
  workspaceGlobs,
} from "./service-init.ts";

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

describe("compose flavors and env defaults", () => {
  it("recognizes every compose filename flavor", () => {
    expect(isComposeFile("compose.yaml")).toBe(true);
    expect(isComposeFile("compose.dev.yaml")).toBe(true);
    expect(isComposeFile("docker-compose.yml")).toBe(true);
    expect(isComposeFile("compose.json")).toBe(false);
    expect(isComposeFile("decompose.yaml")).toBe(false);
  });

  it("reads the declared default of an env-interpolated port", () => {
    const proposals = proposeFromCompose(
      'services:\n  mend:\n    ports:\n      - "${MEND_PORT:-3000}:3000"\n',
    );
    expect(proposals[0]).toMatchObject({ name: "mend", port: 3000, guessed: false });
  });
});

describe("workspace sweep", () => {
  it("collects globs from pnpm-workspace.yaml and package.json workspaces", () => {
    expect(
      workspaceGlobs('packages:\n  - "apps/*"\n  - packages/*\n  - "!**/test"\n', null),
    ).toEqual(["apps/*", "packages/*"]);
    expect(workspaceGlobs(null, JSON.stringify({ workspaces: ["apps/*"] }))).toEqual(["apps/*"]);
  });

  it("proposes a workspace package's server script through the package manager", () => {
    const proposals = proposeFromWorkspacePackage(
      "marketing",
      JSON.stringify({ name: "@mend/marketing", scripts: { dev: "vite dev --port 3102" } }),
      ["pnpm-lock.yaml"],
    );
    expect(proposals[0]).toMatchObject({
      name: "marketing",
      command: "pnpm --filter @mend/marketing dev",
      port: 3102,
      guessed: false,
    });
  });
});

describe("proposeFromCompose udp", () => {
  it("proposes udp for a /udp published mapping and renders the protocol line", () => {
    const compose = [
      "services:",
      "  game:",
      "    image: factorio",
      "    ports:",
      '      - "34197:34197/udp"',
    ].join("\n");
    const proposals = proposeFromCompose(compose);
    expect(proposals[0]).toMatchObject({ name: "game", port: 34197, protocol: "udp" });
    const toml = renderMendToml(proposals);
    expect(toml).toContain('protocol = "udp"');
  });
});

describe("renderMendToml", () => {
  it("renders a commented, committable file", () => {
    const toml = renderMendToml([
      {
        name: "web",
        command: "pnpm run dev",
        port: 5173,
        protocol: "tcp",
        guessed: true,
        source: "package.json",
      },
      {
        name: "mysql",
        command: "docker compose up mysql",
        port: 3306,
        protocol: "tcp",
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
