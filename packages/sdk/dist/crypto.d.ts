import type { RelayEvent } from "./types.js";
/**
 * Generate a new Ed25519 keypair.
 */
export declare function generateKeypair(): {
    publicKey: string;
    privateKey: string;
};
/**
 * Derive a deterministic Ed25519 keypair from a seed string.
 * Same seed always produces the same keypair.
 */
export declare function deterministicKeypair(seed: string): {
    publicKey: string;
    privateKey: string;
};
/**
 * Serialize an event for ID computation.
 * Format: [0, pubkey, created_at, kind, tags, content]
 */
export declare function serializeEvent(event: Omit<RelayEvent, "id" | "sig">): string;
/**
 * Compute the event ID: sha256(serialize(event))
 */
export declare function computeEventId(event: Omit<RelayEvent, "id" | "sig">): string;
/**
 * Sign an event. Returns the complete event with id and sig.
 */
export declare function signEvent(event: Omit<RelayEvent, "id" | "sig">, privateKey: string): Promise<RelayEvent>;
/**
 * Synchronous version for environments without async support.
 */
export declare function signEventSync(event: Omit<RelayEvent, "id" | "sig">, privateKey: string): RelayEvent;
/**
 * Verify an event's id and signature.
 */
export declare function verifyEvent(event: RelayEvent): Promise<boolean>;
/**
 * Synchronous verification.
 */
export declare function verifyEventSync(event: RelayEvent): boolean;
