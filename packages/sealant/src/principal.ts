import { Effect } from "effect";
import * as Context from "effect/Context";

/**
 * WHO a Sealant call is made for. Every platform resource Mend touches is owned
 * by exactly one Sealant user, and Mend maps each of its users to one
 * (docs/SEALANT-IDENTITY.md), so the principal is a Mend user id:
 *
 * - `{ kind: "user" }`: a specific Mend user — the request's signed-in user for
 *   "my" things (connected accounts, the connection check, creating a session),
 *   the SESSION OWNER for anything about a session (a collaborator viewing
 *   someone's session reads that session's workspace as its owner).
 * - `{ kind: "first-user" }`: the operator (the first account on this Mend) —
 *   for pre-identity rows and machine-level work (hot pool warming, leftover
 *   sweeps of sessions that predate ownership).
 * - `{ kind: "none" }`: the default. A call without a principal is a typed
 *   failure, never a silent fallback to a seed user.
 *
 * A reference, not a service: fibers inherit it, so setting it once at a
 * request or session boundary covers every platform call underneath.
 */
export type SealantPrincipalValue =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "first-user" }
  | { readonly kind: "none" };

export const SealantPrincipal: Context.Reference<SealantPrincipalValue> =
  Context.Reference<SealantPrincipalValue>("@mend/sealant/SealantPrincipal", {
    defaultValue: () => ({ kind: "none" }),
  });

/** Run `self` as a Mend user — or as the operator when the owner is unknown (`null`). */
export const asSealantUser =
  (userId: string | null) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(
      self,
      SealantPrincipal,
      userId === null ? { kind: "first-user" } : { kind: "user", userId },
    );

/** Run `self` as the operator (the first Mend account). */
export const asFirstSealantUser = <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(self, SealantPrincipal, { kind: "first-user" });
