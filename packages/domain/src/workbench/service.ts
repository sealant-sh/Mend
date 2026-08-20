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
  /** Effective host policy snapshot. Null means a pre-policy declaration with no honest snapshot. */
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

export const ServiceEndpointScope = Schema.Literals(["loopback", "private"]);
export type ServiceEndpointScope = typeof ServiceEndpointScope.Type;

/** One exact address the host successfully bound for a Service forward. */
export class ServiceEndpoint extends Schema.Class<ServiceEndpoint>("ServiceEndpoint")({
  address: Schema.String,
  authority: Schema.String,
  hostPort: Schema.Int,
  transport: ServiceTransport,
  scope: ServiceEndpointScope,
  browserUrl: Schema.NullOr(Schema.String),
  mendAuthentication: Schema.Literal("none"),
}) {}

/** One stable Service with its independent attempt, forward, target, and endpoint facts. */
export class ServiceView extends Schema.Class<ServiceView>("ServiceView")({
  service: Service,
  attempts: Schema.Array(SessionProcess),
  currentForward: Schema.NullOr(ServiceForward),
  previousForward: Schema.NullOr(ServiceForward),
  latestObservation: Schema.NullOr(ServiceObservation),
  workspaceExpiresAt: Schema.NullOr(Schema.Date),
  workspaceTtlRenewedAt: Schema.NullOr(Schema.Date),
  workspaceTtlRenewalFailedAt: Schema.NullOr(Schema.Date),
  workspaceTtlRenewalError: Schema.NullOr(Schema.String),
  endpoints: Schema.Array(ServiceEndpoint),
  previousEndpoints: Schema.Array(ServiceEndpoint),
}) {}

const endpointAuthority = (address: string, port: number): string =>
  address.includes(":") ? `[${address}]:${port}` : `${address}:${port}`;

/** Build exact client endpoints only from addresses the host reports as bound. */
export const resolveServiceEndpoints = (
  service: Service,
  forward: ServiceForward | null,
): ReadonlyArray<ServiceEndpoint> => {
  if (forward === null || forward.hostPort === null || forward.boundAddresses === null) return [];
  const hostPort = forward.hostPort;
  return forward.boundAddresses.map((address) => {
    const authority = endpointAuthority(address, hostPort);
    const browserAuthority = endpointAuthority(address.replace("%", "%25"), hostPort);
    return new ServiceEndpoint({
      address,
      authority,
      hostPort,
      transport: service.transport,
      scope: address === "::1" || address.startsWith("127.") ? "loopback" : "private",
      browserUrl:
        service.browserScheme === null ? null : `${service.browserScheme}://${browserAuthority}/`,
      mendAuthentication: "none",
    });
  });
};
