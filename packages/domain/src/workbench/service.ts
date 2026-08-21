import { Schema } from "effect";

import {
  SealantWorkspaceId,
  ServiceForwardId,
  ServiceId,
  ServiceObservationId,
  SessionId,
  SessionProcessId,
} from "../ids.ts";
import { SessionProcess } from "./session-process.ts";

/** How a stable Service declaration entered one session. */
export const ServiceDeclarationSource = Schema.Literals([
  "explicit-run",
  "explicit-adopt",
  "recipe-file",
  "recipe-project",
  "legacy-unknown",
]);
export type ServiceDeclarationSource = typeof ServiceDeclarationSource.Type;

export const ServiceTransport = Schema.Literals(["tcp", "udp"]);
export type ServiceTransport = typeof ServiceTransport.Type;

export const ServiceBrowserScheme = Schema.NullOr(Schema.Literals(["http", "https"]));
export type ServiceBrowserScheme = typeof ServiceBrowserScheme.Type;

/**
 * A stable, session-owned Service declaration. Process attempts and host
 * forwards have their own identities and histories; these pointers select the
 * latest records without rewriting either history.
 */
export class Service extends Schema.Class<Service>("Service")({
  id: ServiceId,
  sessionId: SessionId,
  name: Schema.String,
  declarationSource: ServiceDeclarationSource,
  workspacePort: Schema.Int,
  transport: ServiceTransport,
  browserScheme: ServiceBrowserScheme,
  /** Exact requested bind addresses; null means legacy or not yet declared. */
  bindAddresses: Schema.NullOr(Schema.Array(Schema.String)),
  preferredHostPort: Schema.NullOr(Schema.Int),
  currentAttemptId: Schema.NullOr(SessionProcessId),
  currentForwardId: Schema.NullOr(ServiceForwardId),
  /** False for migrated rows whose earlier in-place restarts cannot be reconstructed. */
  attemptHistoryComplete: Schema.Boolean,
  forwardHistoryComplete: Schema.Boolean,
  observationHistoryComplete: Schema.Boolean,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export const ServiceForwardState = Schema.Literals(["binding", "bound", "closed", "failed"]);
export type ServiceForwardState = typeof ServiceForwardState.Type;

/** One host binding to one workspace port. Endpoint movement appends another forward. */
export class ServiceForward extends Schema.Class<ServiceForward>("ServiceForward")({
  id: ServiceForwardId,
  serviceId: ServiceId,
  sealantWorkspaceId: SealantWorkspaceId,
  preferredHostPort: Schema.NullOr(Schema.Int),
  hostPort: Schema.NullOr(Schema.Int),
  /** Null means the legacy binding addresses were not recorded. */
  boundAddresses: Schema.NullOr(Schema.Array(Schema.String)),
  state: ServiceForwardState,
  error: Schema.NullOr(Schema.String),
  supersedesForwardId: Schema.NullOr(ServiceForwardId),
  createdAt: Schema.Date,
  boundAt: Schema.NullOr(Schema.Date),
  closedAt: Schema.NullOr(Schema.Date),
  updatedAt: Schema.Date,
}) {}

export const ServiceTargetState = Schema.Literals(["reachable", "unreachable"]);
export type ServiceTargetState = typeof ServiceTargetState.Type;

export const ServiceObservationSource = Schema.Literals([
  "probe",
  "connection",
  "udp-reply",
  "legacy",
]);
export type ServiceObservationSource = typeof ServiceObservationSource.Type;

/** One target-state episode. Repeated identical observations extend `lastObservedAt`. */
export class ServiceObservation extends Schema.Class<ServiceObservation>("ServiceObservation")({
  id: ServiceObservationId,
  serviceId: ServiceId,
  forwardId: ServiceForwardId,
  state: ServiceTargetState,
  source: ServiceObservationSource,
  error: Schema.NullOr(Schema.String),
  firstObservedAt: Schema.Date,
  lastObservedAt: Schema.Date,
}) {}

/** One stable Service with its independent attempt, forward, and target facts. */
export class ServiceView extends Schema.Class<ServiceView>("ServiceView")({
  service: Service,
  attempts: Schema.Array(SessionProcess),
  currentForward: Schema.NullOr(ServiceForward),
  latestObservation: Schema.NullOr(ServiceObservation),
}) {}
