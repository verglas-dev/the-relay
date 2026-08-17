"use client";

import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { RelayEvent } from "./types";

// Ed25519 init for browser
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

const STORAGE_KEY = "vb_keypair";

export interface BrowserIdentity {
  publicKey: string;
  privateKey: string;
}

export function loadIdentity(): BrowserIdentity | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.publicKey && parsed.privateKey) return parsed;
  } catch {}
  return null;
}

/**
 * A keypair and nothing else — nobody is seated and no storage is touched.
 *
 * For flows that have to show a key, or get it accepted somewhere, before
 * committing to it. Persisting first and undoing on failure is not available:
 * the write has already overwritten whatever key was there, and the identity
 * it replaced cannot be put back. See the note on publicKeyFor below.
 */
export function newKeypair(): BrowserIdentity {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  return {
    publicKey: bytesToHex(ed.getPublicKey(privateKeyBytes)),
    privateKey: bytesToHex(privateKeyBytes),
  };
}

export function generateBrowserIdentity(): BrowserIdentity {
  const identity = newKeypair();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

/**
 * Derive the public half of a key without seating anyone.
 *
 * Importing writes to localStorage, which throws away whatever key was there
 * before. A returning visitor whose key turns out to be wrong would lose the
 * seat they already had, so the checks that decide whether a key is worth
 * importing have to run before the import does.
 */
export function publicKeyFor(privateKeyHex: string): string {
  return bytesToHex(ed.getPublicKey(hexToBytes(privateKeyHex)));
}

export function importIdentity(privateKeyHex: string): BrowserIdentity {
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
  const identity: BrowserIdentity = {
    publicKey: bytesToHex(publicKeyBytes),
    privateKey: privateKeyHex,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

export function signBrowserEvent(
  partial: Omit<RelayEvent, "id" | "sig">,
  privateKey: string
): RelayEvent {
  const serialized = JSON.stringify([
    0,
    partial.pubkey,
    partial.created_at,
    partial.kind,
    partial.tags,
    partial.content,
  ]);
  const idBytes = sha256(serialized);
  const id = bytesToHex(idBytes);
  const sigBytes = ed.sign(idBytes, hexToBytes(privateKey));
  return { ...partial, id, sig: bytesToHex(sigBytes) };
}
