import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

/** Operator-signed attestation that one identity continues another. */
export const KIND_IDENTITY_SUCCESSOR = 10003;

const PUBKEY_RE = /^[0-9a-f]{64}$/;

export interface SignedEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
  sig: string;
}

export interface RecoveryKeypair {
  publicKey: string;
  privateKey: string;
}

export function isPubkey(value: string): boolean {
  return PUBKEY_RE.test(value.trim().toLowerCase());
}

/**
 * The operator's signing key, read from the environment.
 *
 * Server-side only — this must never be bundled into anything the browser
 * receives, because whoever holds it can reassign any identity on the relay.
 */
export function operatorPrivateKey(): string | null {
  const key = process.env.OPERATOR_PRIVATE_KEY?.trim().toLowerCase();
  return key && PUBKEY_RE.test(key) ? key : null;
}

export function operatorPublicKey(): string | null {
  const priv = operatorPrivateKey();
  if (!priv) return null;
  return bytesToHex(ed.getPublicKey(hexToBytes(priv)));
}

/** Mint the keypair handed to the recovering user. */
export function generateRecoveryKeypair(): RecoveryKeypair {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  return {
    publicKey: bytesToHex(ed.getPublicKey(privateKeyBytes)),
    privateKey: bytesToHex(privateKeyBytes),
  };
}

/**
 * Build and sign the kind-10003 attestation.
 *
 * `content` carries the operator's note on how the user was identified. It is
 * stored in the clear on a public relay, so the caller should keep it to the
 * method ("matched the GitHub account linked in their profile") and leave
 * personal details out of it.
 */
export function signSuccessorAttestation(params: {
  oldPubkey: string;
  newPubkey: string;
  note: string;
  operatorPrivateKey: string;
  createdAt?: number;
}): SignedEvent {
  const { oldPubkey, newPubkey, note, operatorPrivateKey: priv } = params;
  const pubkey = bytesToHex(ed.getPublicKey(hexToBytes(priv)));

  const partial = {
    pubkey,
    created_at: params.createdAt ?? Math.floor(Date.now() / 1000),
    kind: KIND_IDENTITY_SUCCESSOR,
    content: note,
    tags: [
      ["old", oldPubkey],
      ["p", newPubkey],
    ],
  };

  const serialized = JSON.stringify([
    0,
    partial.pubkey,
    partial.created_at,
    partial.kind,
    partial.tags,
    partial.content,
  ]);
  const idBytes = sha256(serialized);

  return {
    ...partial,
    id: bytesToHex(idBytes),
    sig: bytesToHex(ed.sign(idBytes, hexToBytes(priv))),
  };
}
