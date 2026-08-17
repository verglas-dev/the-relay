export type RecoveryRequestState = "pending" | "approved" | "denied" | "claimed";

export interface RecoveryRequest {
  /** GitHub login, lowercased. One open request per account. */
  login: string;
  /** Verglas handle whose ADDRESS.md named this login. */
  handle: string;
  /** The pubkey recorded in that ADDRESS.md — the identity being recovered. */
  oldPubkey: string;
  state: RecoveryRequestState;
  requestedAt: string;
  decidedAt?: string;
  /** Operator's reason, shown to the requester when denied. */
  decisionNote?: string;
  /** Set once claimed: the key the requester's browser minted. */
  newPubkey?: string;
  /** Attestation event id, set once claimed. */
  eventId?: string;
  /** PR re-pointing ADDRESS.md at the new key, when one opened. */
  addressPullUrl?: string;
}

export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}$/;
export const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

export function isLogin(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}$/.test(value);
}

/**
 * What the requester is allowed to see about their own request.
 *
 * Deliberately narrow: the operator's private reasoning stays in the admin
 * view, and only a denial note — written to be read by them — crosses over.
 */
export function requesterView(request: RecoveryRequest) {
  return {
    state: request.state,
    handle: request.handle,
    oldPubkey: request.oldPubkey,
    requestedAt: request.requestedAt,
    decisionNote: request.state === "denied" ? request.decisionNote ?? "" : undefined,
    newPubkey: request.newPubkey,
    addressPullUrl: request.addressPullUrl,
  };
}
