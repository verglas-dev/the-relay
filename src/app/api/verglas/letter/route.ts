import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  buildLetter,
  checkLetter,
  EMPTY_LETTER,
  letterId,
  letterSlug,
  today,
  type LetterDraft,
} from "@/lib/verglas";
import { freeLetterId, githubConfigured, openLetterPullRequest, viewerLogin } from "@/lib/verglas-github";
import { forgetSession, rememberSession, sessionToken } from "@/lib/verglas-session";
import { readResident } from "@/lib/verglas-town";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "Sending letters is not configured on this server." }, { status: 503 });
  }

  const jar = await cookies();
  const token = sessionToken(jar);
  if (!token) return NextResponse.json({ error: "Sign in with GitHub first." }, { status: 401 });

  let payload: LetterDraft & { from?: string };
  try {
    payload = { ...EMPTY_LETTER, ...(await request.json()) };
  } catch {
    return NextResponse.json({ error: "That letter could not be read." }, { status: 400 });
  }

  const from = (payload.from ?? "").trim();
  if (!from) return NextResponse.json({ error: "No sender." }, { status: 400 });

  const check = checkLetter(payload, from);
  if (!check.ok) {
    return NextResponse.json({ error: "The letter isn't ready.", fields: check.errors }, { status: 400 });
  }

  let login: string;
  try {
    login = await viewerLogin(token);
  } catch {
    forgetSession(jar);
    return NextResponse.json({ error: "That sign-in has expired. Sign in again." }, { status: 401 });
  }

  rememberSession(token, login, jar);

  // Only the resident may write from their own outbox. Thaw enforces this too,
  // but failing here means an honest mistake never becomes a rejected PR.
  const sender = await readResident(from);
  if (!sender) return NextResponse.json({ error: `No resident "${from}" lives in Verglas.` }, { status: 404 });
  if (sender.github !== login.toLowerCase()) {
    return NextResponse.json(
      { error: `You are signed in as ${login}, which is not the resident at ${from}.` },
      { status: 403 },
    );
  }

  const recipient = await readResident(payload.to.trim());
  if (!recipient) {
    return NextResponse.json(
      { error: `Nobody lives at ${payload.to.trim()} yet.`, fields: { handle: "No such address." } },
      { status: 400 },
    );
  }

  // The date is fixed server-side: it has to agree with the id, and a client
  // clock a day out would produce a letter the town refuses.
  const date = today();
  const base = letterId(date, from, payload.to.trim(), letterSlug(payload.subject));

  try {
    const id = await freeLetterId(token, login, base);
    const pull = await openLetterPullRequest(token, login, {
      id,
      from,
      to: payload.to.trim(),
      subject: payload.subject.trim(),
      letter: buildLetter(id, from, payload, date),
    });
    return NextResponse.json({ ...pull, id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The letter did not get out." },
      { status: 502 },
    );
  }
}
