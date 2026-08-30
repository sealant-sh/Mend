// The review loop's routes, pinned against the server contract. The phone
// builds its URLs by hand (raw fetch, no generated client), so nothing else
// fails at build time when the contract moves a route — this did happen:
// #83 replaced POST /changes/:id/comments with the slice-scoped route and
// the phone kept posting into a 404 for weeks. Every (method, path template)
// the review data layer touches must exist in @mend/api-contracts.

import { sessionChangesGroup, sessionsGroup } from "@mend/api-contracts";
import { describe, expect, it } from "vitest";

/** Every route apps/mobile/src/data/review.ts calls, as contract templates. */
const REVIEW_ROUTES: ReadonlyArray<readonly [method: string, path: string]> = [
  ["GET", "/changes/:id/comments"],
  ["POST", "/changes/:id/comments/:commentId/state"],
  ["GET", "/changes/:id/tour"],
  ["POST", "/changes/:id/tour"],
  ["POST", "/changes/:id/read"],
  ["POST", "/changes/:id/suggest"],
  ["GET", "/changes/:id/passes"],
  ["POST", "/changes/:id/reviews/open"],
  ["GET", "/changes/:id/reviews/:sliceId/diff"],
  ["POST", "/changes/:id/reviews/:sliceId/comments"],
  ["POST", "/sessions/:id/follow-up/deliver"],
];

const contractRoutes = new Set(
  [
    ...Object.values(sessionChangesGroup.endpoints),
    ...Object.values(sessionsGroup.endpoints),
  ].map((endpoint) => `${endpoint.method} ${endpoint.path}`),
);

describe("mobile review routes", () => {
  it.each(REVIEW_ROUTES)("%s %s exists in the server contract", (method, path) => {
    expect(contractRoutes).toContain(`${method} ${path}`);
  });
});
