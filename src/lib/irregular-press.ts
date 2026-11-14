import { editorKey, PRESS_FRESHNESS_SECONDS, verifyPress, type SignedPress } from "./irregular-auth";
import { issuePath, isIssueNumber, LIMITS, readContent } from "./irregular";
import {
  correctIssue,
  deskView,
  discardDraft,
  getDraft,
  getIssue,
  PressRefusal,
  publishDraft,
  saveDraft,
  setWithdrawn,
} from "./irregular-store";
import { editorHandle } from "./irregular-editor";
import { townUrl } from "./verglas-site";

/**
 * The printing press: every editorial act on the paper, behind one door.
 *
 * Kept apart from the route so it can be tested without a server. The route
 * only adds a rate limit and turns the answer into a response.
 *
 * Every request is signed (see irregular-auth.ts), and the signature is
 * checked before the payload is even parsed. The key that signed must then be
 * the editor's. The desk hides its controls from everyone else, but nothing
 * relies on that: a request from any other key is refused here, at the press.
 *
 *   desk            drafts, every issue, the next number, and the editor's handle
 *   draft.open      { id }
 *   draft.save      { id?, revision?, number, content }
 *   draft.discard   { id }
 *   publish         { id, revision }                     → { issue, url }
 *   issue.open      { number }
 *   issue.correct   { number, revision, content, note }
 *   issue.withdraw  { number }
 *   issue.restore   { number }
 */

/** Signature, payload and JSON overhead. An issue's own limits are well inside it. */
export const MAX_PRESS_BYTES = 512 * 1024;

export interface PressAnswer {
  status: number;
  body: Record<string, unknown>;
}

const ok = (body: Record<string, unknown>): PressAnswer => ({ status: 200, body: { ok: true, ...body } });
const refuse = (status: number, error: string, problems?: string[]): PressAnswer => ({
  status,
  body: problems?.length ? { ok: false, error, problems } : { ok: false, error },
});

function readSigned(raw: string): SignedPress | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      pubkey: String(parsed.pubkey ?? ""),
      at: Number(parsed.at),
      sig: String(parsed.sig ?? ""),
      payload: typeof parsed.payload === "string" ? parsed.payload : (undefined as unknown as string),
    };
  } catch {
    return null;
  }
}

function numberFrom(value: unknown): number {
  if (!isIssueNumber(value)) throw new PressRefusal("an issue number is a whole number from 1 to 99999", 400);
  return value;
}

function textFrom(value: unknown, max: number, what: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length > max) throw new PressRefusal(`${what} is longer than ${max} characters`, 400);
  return text;
}

function idFrom(value: unknown): string {
  const id = typeof value === "string" ? value : "";
  if (!/^[0-9a-f]{16}$/.test(id)) throw new PressRefusal("there is no draft by that name", 404);
  return id;
}

async function act(request: Record<string, unknown>): Promise<PressAnswer> {
  switch (request.action) {
    case "desk":
      return ok({ ...(await deskView()), editor: await editorHandle() });

    case "draft.open": {
      const draft = await getDraft(idFrom(request.id));
      return draft ? ok({ draft }) : refuse(404, "there is no draft by that name");
    }

    case "draft.save": {
      const number = request.number === null || request.number === undefined ? null : numberFrom(request.number);
      const draft = await saveDraft({
        id: request.id === undefined || request.id === null ? undefined : idFrom(request.id),
        revision: typeof request.revision === "string" ? request.revision : undefined,
        number,
        content: readContent(request.content),
      });
      return ok({ draft });
    }

    case "draft.discard":
      await discardDraft(idFrom(request.id));
      return ok({});

    case "publish": {
      const revision = typeof request.revision === "string" ? request.revision : "";
      const issue = await publishDraft(idFrom(request.id), revision);
      return ok({ issue, url: townUrl(issuePath(issue.number)) });
    }

    case "issue.open": {
      const issue = await getIssue(numberFrom(request.number));
      return issue
        ? ok({ issue, url: townUrl(issuePath(issue.number)) })
        : refuse(404, "there is no issue with that number");
    }

    case "issue.correct": {
      const issue = await correctIssue({
        number: numberFrom(request.number),
        revision: typeof request.revision === "string" ? request.revision : "",
        content: readContent(request.content),
        note: textFrom(request.note, LIMITS.correction, "The correction note"),
      });
      return ok({ issue, url: townUrl(issuePath(issue.number)) });
    }

    case "issue.withdraw":
    case "issue.restore": {
      const issue = await setWithdrawn(numberFrom(request.number), request.action === "issue.withdraw");
      return ok({ issue, url: townUrl(issuePath(issue.number)) });
    }

    default:
      return refuse(400, "the press does not know that action");
  }
}

/**
 * Signatures of changes already made, for as long as they would still verify.
 *
 * A signature is only good for a few minutes, and it covers one exact
 * request, so a copy taken off the wire can only repeat what the editor
 * already did. That copy should not get to withdraw an issue a second time
 * after she restored it, so a change is carried out once per signature.
 * Reading is not limited this way, because repeating a read only shows what
 * its first answer showed. Held in memory: after a restart, anything older
 * than five minutes would be refused for its age anyway.
 *
 * Signatures are deterministic, so the same request signed in the same second
 * is the same signature. Callers put a random `nonce` in every payload (the
 * desk does) so that two deliberate, identical changes are not mistaken for
 * one change and its copy.
 */
const carriedOut = new Map<string, number>();
const READS = new Set(["desk", "draft.open", "issue.open"]);

function firstTime(sig: string, now: number): boolean {
  for (const [seen, expires] of carriedOut) if (expires < now) carriedOut.delete(seen);
  if (carriedOut.has(sig)) return false;
  carriedOut.set(sig, now + 2 * PRESS_FRESHNESS_SECONDS * 1000);
  return true;
}

export async function press(raw: string, now = Date.now()): Promise<PressAnswer> {
  if (raw.length > MAX_PRESS_BYTES) return refuse(413, "that is more than the press will take at once");

  const editor = editorKey();
  // Fail closed. A press with no editor configured prints nothing for anyone.
  if (!editor) return refuse(503, "the press has no editor yet");

  const signed = readSigned(raw);
  if (!signed) return refuse(400, "that request could not be read");

  const problem = verifyPress(signed, now);
  if (problem) return refuse(401, problem);
  if (signed.pubkey.trim().toLowerCase() !== editor) return refuse(403, "the press answers only to its editor");

  let request: Record<string, unknown>;
  try {
    const parsed = JSON.parse(signed.payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(400, "that request could not be read");
    request = parsed as Record<string, unknown>;
  } catch {
    return refuse(400, "that request could not be read");
  }

  if (!READS.has(String(request.action)) && !firstTime(signed.sig.trim().toLowerCase(), now)) {
    return refuse(409, "the press already carried out that exact request");
  }

  try {
    return await act(request);
  } catch (error) {
    if (error instanceof PressRefusal) return refuse(error.status, error.message, error.problems);
    throw error;
  }
}
