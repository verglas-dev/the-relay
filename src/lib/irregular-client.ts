"use client";

import { signPress } from "@/lib/irregular-auth";
import type { Draft, Issue, IssueContent } from "@/lib/irregular";

/**
 * The desk's side of the press.
 *
 * Every call is signed with the key seated in this browser, the same key the
 * editor's home answers to. The private half never leaves the browser; the
 * press sees a public key, a timestamp, the request and a signature over it.
 */

export interface Identity {
  publicKey: string;
  privateKey: string;
}

export interface PressResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  problems?: string[];
}

async function call<T>(identity: Identity, request: Record<string, unknown>): Promise<PressResult<T>> {
  // The nonce makes every request its own, so saving the same words twice in
  // one second is two saves rather than one save and a refused "replay".
  const payload = JSON.stringify({ ...request, nonce: crypto.randomUUID() });
  const signed = signPress(identity.privateKey, identity.publicKey.toLowerCase(), payload);
  try {
    const response = await fetch("/api/verglas/press", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string; problems?: string[] })
      | null;
    if (!response.ok || !body?.ok) {
      return {
        ok: false,
        status: response.status,
        error: body?.error ?? "the press did not answer",
        problems: body?.problems,
      };
    }
    return { ok: true, status: response.status, data: body };
  } catch {
    return { ok: false, status: 0, error: "the press could not be reached" };
  }
}

export interface DeskData {
  drafts: Draft[];
  issues: Issue[];
  nextNumber: number;
  /** The editor's address in town, when it could be found. */
  editor: string | null;
}

export const openDesk = (identity: Identity) => call<DeskData>(identity, { action: "desk" });

export const saveDraft = (
  identity: Identity,
  params: { id?: string; revision?: string; number: number | null; content: IssueContent },
) => call<{ draft: Draft }>(identity, { action: "draft.save", ...params });

export const discardDraft = (identity: Identity, id: string) =>
  call<Record<string, never>>(identity, { action: "draft.discard", id });

export const publishDraft = (identity: Identity, id: string, revision: string) =>
  call<{ issue: Issue; url: string }>(identity, { action: "publish", id, revision });

export const correctIssue = (
  identity: Identity,
  params: { number: number; revision: string; content: IssueContent; note: string },
) => call<{ issue: Issue; url: string }>(identity, { action: "issue.correct", ...params });

export const withdrawIssue = (identity: Identity, number: number, withdraw: boolean) =>
  call<{ issue: Issue; url: string }>(identity, { action: withdraw ? "issue.withdraw" : "issue.restore", number });
