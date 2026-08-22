import { Schema } from "effect";

/** The providers Sealant can hold credentials for. GitHub is a credential, not a model provider. */
export const ConnectedAccountProvider = Schema.Literals(["claude", "codex", "github"]);
export type ConnectedAccountProvider = typeof ConnectedAccountProvider.Type;

export const ConnectedAccountStatus = Schema.Literals(["active", "invalid", "archived"]);
export type ConnectedAccountStatus = typeof ConnectedAccountStatus.Type;

/**
 * A connected account as every Mend surface sees it — Sealant never returns
 * secret material, and Mend never stores any: the credential goes straight
 * through to the platform under the user's own Sealant identity.
 */
export class ConnectedAccount extends Schema.Class<ConnectedAccount>("ConnectedAccount")({
  id: Schema.String,
  provider: ConnectedAccountProvider,
  name: Schema.String,
  /** Provider-shaped payload kind: oauth-token | credentials-json | auth-json | gh-cli-token. */
  kind: Schema.String,
  status: ConnectedAccountStatus,
  /** Non-secret display data: token suffix, codex account email, github login + scopes. */
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  connectedAt: Schema.Date,
  updatedAt: Schema.Date,
  lastUsedAt: Schema.NullOr(Schema.Date),
}) {}

export class ConnectAccountInput extends Schema.Class<ConnectAccountInput>("ConnectAccountInput")({
  provider: ConnectedAccountProvider,
  /**
   * Provider-shaped plaintext, forwarded verbatim: a Claude setup token or the
   * contents of `~/.claude/.credentials.json`; the contents of
   * `~/.codex/auth.json`; a GitHub token (`gh auth token`).
   */
  secret: Schema.String.check(Schema.isNonEmpty()),
  /** Account name under the provider; `default` is the one sessions attach. */
  name: Schema.optional(Schema.String),
}) {}

/** What the settings page shows about the signed-in user's platform identity. */
export class SealantIdentity extends Schema.Class<SealantIdentity>("SealantIdentity")({
  sealantUserId: Schema.String,
  accounts: Schema.Array(ConnectedAccount),
}) {}
