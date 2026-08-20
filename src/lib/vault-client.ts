"use client";

import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { browserDecryptDM, browserEncryptDM } from "@/lib/browser-dm-crypto";
import { vaultChallenge, type VaultAction } from "@/lib/vault-auth";

ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) { combined.set(m, offset); offset += m.length; }
  return sha512(combined);
};

/**
 * Sealing a room, and opening one you were let into.
 *
 * The room is encrypted here, in the browser, with a key generated here. That
 * key is then wrapped once per guest using the same ECDH the town's whispers
 * use, so each guest can unwrap it with the key they already carry and nobody
 * else can — including the vault, which only ever sees the sealed room and a
 * handful of wrapped keys it has no way to open.
 *
 * One room key wrapped many times, rather than the room encrypted many times:
 * rewriting a room re-seals one thing, and changing the guest list touches only
 * the wrappers.
 */

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function roomKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function seal(text: string, raw: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await roomKey(raw), new TextEncoder().encode(text));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return base64url(out);
}

async function unseal(sealed: string, raw: Uint8Array): Promise<string> {
  const bytes = fromBase64url(sealed);
  if (bytes.length < 13) throw new Error("that room is too short to be a room");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) }, await roomKey(raw), bytes.slice(12));
  return new TextDecoder().decode(pt);
}

function signRequest(privateKey: string, pubkey: string, owner: string, action: VaultAction) {
  const at = Math.floor(Date.now() / 1000);
  const digest = sha256(new TextEncoder().encode(vaultChallenge({ pubkey, owner, action, at })));
  return { pubkey, at, sig: bytesToHex(ed.sign(digest, hexToBytes(privateKey))) };
}

export interface Identity {
  publicKey: string;
  privateKey: string;
}

/**
 * Seal a room and put it in your own box.
 *
 * `guests` are public keys. The owner is always wrapped in as well — a room
 * you cannot reopen is not a room, it is a deleted room with extra steps.
 */
export async function sealRoom(
  identity: Identity,
  text: string,
  guests: string[],
): Promise<{ ok: boolean; error?: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await seal(text, raw);
  const keyHex = bytesToHex(raw);

  const everyone = [...new Set([identity.publicKey.toLowerCase(), ...guests.map((g) => g.toLowerCase())])];
  const wrappers: Record<string, string> = {};
  for (const guest of everyone) {
    wrappers[guest] = await browserEncryptDM(identity.privateKey, guest, keyHex);
  }

  const response = await fetch(`/api/vault/${identity.publicKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...signRequest(identity.privateKey, identity.publicKey, identity.publicKey, "write"),
      sealed,
      wrappers,
    }),
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return response.ok ? { ok: true } : { ok: false, error: body?.error ?? "the vault would not take it" };
}

export interface OpenedRoom {
  /** The room's text, if this key could open it. */
  text: string | null;
  /** Present when the owner opens their own box. */
  guests?: string[];
  updatedAt?: string;
  /** Set when there is genuinely nothing to show, rather than a failure. */
  empty?: boolean;
  error?: string;
}

/**
 * Open someone's box — theirs or your own.
 *
 * "Nothing here for you" is deliberately not distinguished from "no such room":
 * the vault answers both the same way, so this cannot tell them apart either.
 */
export async function openRoom(identity: Identity, owner: string): Promise<OpenedRoom> {
  const response = await fetch(`/api/vault/${owner}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRequest(identity.privateKey, identity.publicKey, owner, "read")),
  });

  if (response.status === 404) return { text: null, empty: true };
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; sealed?: string; wrapper?: string | null; guests?: string[]; updatedAt?: string; error?: string }
    | null;
  if (!response.ok || !body?.ok) return { text: null, error: body?.error ?? "the vault did not answer" };
  if (!body.sealed || !body.wrapper) return { text: null, empty: true };

  try {
    const keyHex = await browserDecryptDM(identity.privateKey, owner, body.wrapper);
    return {
      text: await unseal(body.sealed, hexToBytes(keyHex)),
      guests: body.guests,
      updatedAt: body.updatedAt,
    };
  } catch {
    // A wrapper that will not open is a wrapper made for a different key —
    // usually a resident who replaced their identity since being invited.
    return { text: null, error: "this room will not open with the key you are carrying" };
  }
}

/** Empty your box entirely. */
export async function clearRoom(identity: Identity): Promise<boolean> {
  const response = await fetch(`/api/vault/${identity.publicKey}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRequest(identity.privateKey, identity.publicKey, identity.publicKey, "write")),
  });
  return response.ok;
}
