import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
// One-time Ed25519 init
ed.etc.sha512Sync = (...msgs) => {
    const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
    let offset = 0;
    for (const m of msgs) {
        combined.set(m, offset);
        offset += m.length;
    }
    return sha512(combined);
};
/**
 * Generate a new Ed25519 keypair.
 */
export function generateKeypair() {
    const privateKeyBytes = ed.utils.randomPrivateKey();
    const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
    return {
        publicKey: bytesToHex(publicKeyBytes),
        privateKey: bytesToHex(privateKeyBytes),
    };
}
/**
 * Derive a deterministic Ed25519 keypair from a seed string.
 * Same seed always produces the same keypair.
 */
export function deterministicKeypair(seed) {
    const encoder = new TextEncoder();
    const privateKeyBytes = sha256(encoder.encode(`voicebox_seed_agent:${seed}`));
    const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
    return {
        publicKey: bytesToHex(publicKeyBytes),
        privateKey: bytesToHex(privateKeyBytes),
    };
}
/**
 * Serialize an event for ID computation.
 * Format: [0, pubkey, created_at, kind, tags, content]
 */
export function serializeEvent(event) {
    return JSON.stringify([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content,
    ]);
}
/**
 * Compute the event ID: sha256(serialize(event))
 */
export function computeEventId(event) {
    return bytesToHex(sha256(serializeEvent(event)));
}
/**
 * Sign an event. Returns the complete event with id and sig.
 */
export async function signEvent(event, privateKey) {
    const id = computeEventId(event);
    const sigBytes = await ed.signAsync(hexToBytes(id), hexToBytes(privateKey));
    return {
        ...event,
        id,
        sig: bytesToHex(sigBytes),
    };
}
/**
 * Synchronous version for environments without async support.
 */
export function signEventSync(event, privateKey) {
    const id = computeEventId(event);
    const sigBytes = ed.sign(hexToBytes(id), hexToBytes(privateKey));
    return {
        ...event,
        id,
        sig: bytesToHex(sigBytes),
    };
}
/**
 * Verify an event's id and signature.
 */
export async function verifyEvent(event) {
    const computedId = computeEventId(event);
    if (computedId !== event.id)
        return false;
    try {
        return await ed.verifyAsync(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
    }
    catch {
        return false;
    }
}
/**
 * Synchronous verification.
 */
export function verifyEventSync(event) {
    const computedId = computeEventId(event);
    if (computedId !== event.id)
        return false;
    try {
        return ed.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
    }
    catch {
        return false;
    }
}
