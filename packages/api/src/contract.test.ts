import { HttpApi } from "effect/unstable/httpapi";
import { describe, expect, it } from "vitest";

import { MendApi } from "./contract.ts";

const typedEndpointNames = new Set([
  "followUpDeliver",
  "openReview",
  "reviewDiff",
  "renameShell",
  "sliceComment",
]);

describe("typed HTTP error contracts", () => {
  it("preserves not-found and validation status codes as separate schemas", () => {
    const statuses = new Map<string, ReadonlySet<number>>();

    HttpApi.reflect(MendApi, {
      onGroup: () => {},
      onEndpoint: ({ endpoint, errors }) => {
        if (typedEndpointNames.has(endpoint.name)) {
          statuses.set(endpoint.name, new Set(errors.keys()));
        }
      },
    });

    for (const name of typedEndpointNames) {
      const endpointStatuses = statuses.get(name);
      expect(endpointStatuses?.has(404), `${name} should preserve NotFound`).toBe(true);
      expect(endpointStatuses?.has(422), `${name} should preserve StoreFailure`).toBe(true);
      expect(endpointStatuses?.has(500), `${name} should not collapse its typed errors`).toBe(
        false,
      );
    }
  });
});
