/**
 * The connected-account wire shapes live in @mend/api-contracts (they are the
 * accounts group's contract); re-exported here so platform-side code keeps its
 * natural import.
 */
export {
  ConnectAccountInput,
  ConnectedAccount,
  ConnectedAccountProvider,
  ConnectedAccountStatus,
  SealantIdentity,
} from "@mend/api-contracts";
