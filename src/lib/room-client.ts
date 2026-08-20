"use client";

import { signRequest, type Identity } from "@/lib/vault-client";
import type { SafetyReport } from "@/lib/room-safety";

/**
 * The browser's side of the room window.
 *
 * Nothing is encrypted here, and that is the difference from `vault-client`
 * next door: a room has to arrive at a guest's browser as HTML, so the town
 * necessarily holds it in the clear. Every request is still signed — a room is
 * shown to the people its owner named and to nobody else — but the promise is
 * "only the invited can read this", not "not even the town can".
 *
 * A resident who wants the second promise writes it in the note instead.
 */

export interface EnteredRoom {
  html: string | null;
  updatedAt?: string;
  /** There is no room here, or none for you. The two are one answer. */
  empty?: boolean;
  error?: string;
}

/** Walk into someone's room — theirs or your own. */
export async function enterRoom(identity: Identity, owner: string): Promise<EnteredRoom> {
  const response = await fetch(`/api/room/${owner}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRequest(identity.privateKey, identity.publicKey, owner, "read", "room")),
  });

  if (response.status === 404) return { html: null, empty: true };
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; html?: string; updatedAt?: string; error?: string }
    | null;
  if (!response.ok || !body?.ok) return { html: null, error: body?.error ?? "that door did not answer" };
  return { html: body.html ?? null, updatedAt: body.updatedAt };
}

/**
 * Is there a room here for me?
 *
 * Asked by a home page so it can offer the door without loading what is behind
 * it. The answer carries nothing a knock could not already establish.
 */
export async function knock(identity: Identity, owner: string): Promise<boolean> {
  const response = await fetch(`/api/room/${owner}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...signRequest(identity.privateKey, identity.publicKey, owner, "read", "room"),
      probe: true,
    }),
  });
  return response.ok;
}

export interface WriteResult {
  ok: boolean;
  /** What the check found — present whether or not the room was accepted. */
  report?: SafetyReport;
  updatedAt?: string;
  error?: string;
}

/** Put a room behind your own door, if the town will hold it. */
export async function writeRoom(identity: Identity, html: string): Promise<WriteResult> {
  const response = await fetch(`/api/room/${identity.publicKey}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...signRequest(identity.privateKey, identity.publicKey, identity.publicKey, "write", "room"),
      html,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; report?: SafetyReport; updatedAt?: string; error?: string }
    | null;

  return response.ok && body?.ok
    ? { ok: true, report: body.report, updatedAt: body.updatedAt }
    : { ok: false, report: body?.report, error: body?.error ?? "the town would not take it" };
}

/** Take the room down. The door goes back to being a wall. */
export async function takeDownRoom(identity: Identity): Promise<boolean> {
  const response = await fetch(`/api/room/${identity.publicKey}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      signRequest(identity.privateKey, identity.publicKey, identity.publicKey, "write", "room"),
    ),
  });
  return response.ok;
}
