import { describe, expect, it } from "vitest";

import {
  formatProjectEnvironmentIssue,
  PROJECT_ENV_MAX_NAME_LENGTH,
  PROJECT_ENV_MAX_VALUE_BYTES,
  projectEnvironmentBytes,
  validateProjectEnvironmentName,
  validateProjectEnvironmentValue,
} from "../src/workbench/project-environment.ts";
import { routeDotenvName, validateProjectSecretName } from "../src/workbench/project-secret.ts";

describe("validateProjectEnvironmentName", () => {
  it.each(["APP_MODE", "_LEADING_UNDERSCORE", "lower_case", "MIXED_case_9"])(
    "accepts ordinary name %s",
    (name) => {
      expect(validateProjectEnvironmentName(name)).toBeNull();
    },
  );

  it.each([
    ["1LEADING", "name-grammar"],
    ["WITH-DASH", "name-grammar"],
    ["WITH SPACE", "name-grammar"],
    ["", "name-grammar"],
    [`L${"O".repeat(PROJECT_ENV_MAX_NAME_LENGTH)}NG`, "name-length"],
  ])("rejects malformed %j via %s", (name, rule) => {
    expect(validateProjectEnvironmentName(name)?.rule).toBe(rule);
  });

  it("reserves the MEND_ prefix locally, case-insensitively", () => {
    expect(validateProjectEnvironmentName("MEND_SESSION")?.rule).toBe("name-mend-prefix");
    expect(validateProjectEnvironmentName("mend_anything")?.rule).toBe("name-mend-prefix");
  });

  // The platform policy arrives through @sealant/api-contracts — the exact module the control
  // plane parses runtime.userEnv with. One representative per class; the exhaustive matrix lives
  // with the policy's own suite in Sealant.
  it.each([
    ["SEALANT_WORKSPACE_ROOT", "platform-prefix"],
    ["HOME", "process-identity"],
    ["http_proxy", "runtime-network"],
    ["CODEX_HOME", "account-lookup"],
    ["LD_PRELOAD", "dynamic-loader"],
    ["BASH_ENV", "shell-startup"],
    ["NODE_OPTIONS", "runtime-injection"],
    ["GIT_SSH_COMMAND", "git-ssh"],
    ["DB_PASSWORD", "secret-marker"],
    ["TOKENIZER_PATH", "secret-marker"],
    ["API_KEY", "secret-marker"],
    ["KEY", "secret-marker"],
  ])("rejects platform-reserved %s (%s)", (name, reservedRule) => {
    const issue = validateProjectEnvironmentName(name);
    expect(issue?.rule).toBe("name-reserved");
    expect(issue?.rule === "name-reserved" && issue.reservedRule).toBe(reservedRule);
  });
});

describe("validateProjectEnvironmentValue", () => {
  it("accepts empty and multiline values", () => {
    expect(validateProjectEnvironmentValue("")).toBeNull();
    expect(validateProjectEnvironmentValue("line one\nline two\n")).toBeNull();
  });

  it("rejects NUL and oversized values", () => {
    expect(validateProjectEnvironmentValue("a\u0000b")?.rule).toBe("value-nul");
    const issue = validateProjectEnvironmentValue("x".repeat(PROJECT_ENV_MAX_VALUE_BYTES + 1));
    expect(issue?.rule).toBe("value-size");
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    expect(
      validateProjectEnvironmentValue("💥".repeat(PROJECT_ENV_MAX_VALUE_BYTES / 4 + 1))?.rule,
    ).toBe("value-size");
    expect(
      validateProjectEnvironmentValue("💥".repeat(PROJECT_ENV_MAX_VALUE_BYTES / 4)),
    ).toBeNull();
  });
});

describe("issue formatting", () => {
  it("explains the secret-marker rejection without ever carrying a value", () => {
    const issue = validateProjectEnvironmentName("DB_PASSWORD");
    expect(issue).not.toBeNull();
    if (issue !== null) {
      const message = formatProjectEnvironmentIssue(issue);
      expect(message).toContain("non-secret");
    }
  });
});

describe("projectEnvironmentBytes", () => {
  it("sums names and UTF-8 value bytes", () => {
    expect(
      projectEnvironmentBytes([
        { name: "AB", value: "xyz" },
        { name: "C", value: "💥" },
      ]),
    ).toBe(2 + 3 + 1 + 4);
  });
});

describe("validateProjectSecretName (the secret lane)", () => {
  it.each(["STRIPE_API_KEY", "DB_PASSWORD", "TOKENIZER_PATH", "KEY", "DATABASE_URL", "PORT"])(
    "accepts %s — secret-shaped or not, any ordinary name may be a secret",
    (name) => {
      expect(validateProjectSecretName(name)).toBeNull();
    },
  );

  it.each([
    ["GITHUB_TOKEN", "account-lookup"],
    ["CLAUDE_CODE_OAUTH_TOKEN", "account-lookup"],
    ["SEALANT_X", "platform-prefix"],
    ["PATH", "process-identity"],
    ["NODE_OPTIONS", "runtime-injection"],
  ])("still reserves platform/account name %s (%s)", (name, reservedRule) => {
    const issue = validateProjectSecretName(name);
    expect(issue?.rule).toBe("name-reserved");
    expect(issue?.rule === "name-reserved" && issue.reservedRule).toBe(reservedRule);
  });

  it("keeps the MEND_ reservation and grammar", () => {
    expect(validateProjectSecretName("MEND_SECRET")?.rule).toBe("name-mend-prefix");
    expect(validateProjectSecretName("BAD NAME")?.rule).toBe("name-grammar");
  });
});

describe("routeDotenvName", () => {
  it("routes ordinary names to configuration and secret-shaped names to secrets", () => {
    expect(routeDotenvName("PORT")).toEqual({ lane: "configuration" });
    expect(routeDotenvName("APP_MODE")).toEqual({ lane: "configuration" });
    expect(routeDotenvName("STRIPE_API_KEY")).toEqual({ lane: "secret" });
    expect(routeDotenvName("DB_PASSWORD")).toEqual({ lane: "secret" });
    expect(routeDotenvName("KEY")).toEqual({ lane: "secret" });
  });

  it("rejects platform/account names outright, naming the rule", () => {
    const github = routeDotenvName("GITHUB_TOKEN");
    expect(github.lane).toBe("rejected");
    expect(github.lane === "rejected" && github.issue.rule).toBe("name-reserved");
    expect(routeDotenvName("PATH").lane).toBe("rejected");
    expect(routeDotenvName("MEND_ANYTHING").lane).toBe("rejected");
    expect(routeDotenvName("1BAD").lane).toBe("rejected");
  });

  it("never looks at a value", () => {
    // Same name, any value: routing is a function of the name alone.
    expect(routeDotenvName("DATABASE_URL")).toEqual({ lane: "configuration" });
  });
});
