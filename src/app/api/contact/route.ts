import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { markContactMessageMailed, recordContactMessage } from "@/lib/contact-store";
import { mailConfigured, sendContactMail } from "@/lib/contact-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A contact form is a machine for sending mail to somebody who cannot opt out,
// so what actually reaches the inbox is limited tightly. A person with
// something to say fits easily inside these; something sending in a loop does
// not.
const PER_IP_PER_MIN = 3;
const GLOBAL_PER_MIN = 20;
// Requests that get as far as being read at all, valid or not. Loose, because
// this only exists to stop a flood of nonsense from costing anything, and a
// refused message must never spend the budget for the corrected one.
const REQUESTS_PER_IP_PER_MIN = 30;

const MAX_SUBJECT = 150;
const MAX_BODY = 5000;
const MAX_FROM = 254;
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const ip = callerIp(request);

  if (!rateLimit(`contact-req:${ip}`, REQUESTS_PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "That's a lot of requests at once. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "That message is too long to send." }, { status: 413 });
    }
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "That message could not be read." }, { status: 400 });
  }

  const fields = (payload ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const subject = text(fields.subject);
  const body = text(fields.body);
  const from = text(fields.from);

  // A field no person can see and no person fills in. Anything that puts text
  // here is filling the form by shape rather than by reading it. Answered with
  // an ordinary success, because telling a bot it was caught teaches it.
  if (text(fields.website)) {
    return NextResponse.json({ ok: true, mailed: true });
  }

  if (!subject) {
    return NextResponse.json({ ok: false, error: "A subject helps us route this. What is it about?" }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ ok: false, error: "The message itself is empty." }, { status: 400 });
  }
  if (subject.length > MAX_SUBJECT || body.length > MAX_BODY || from.length > MAX_FROM) {
    return NextResponse.json({ ok: false, error: "That message is longer than the form allows." }, { status: 400 });
  }
  // Header injection is not possible through nodemailer's API, but a subject
  // spanning lines is never anything a person meant either.
  if (/[\r\n]/.test(subject) || /[\r\n]/.test(from)) {
    return NextResponse.json({ ok: false, error: "The subject and From must each be a single line." }, { status: 400 });
  }

  // Charged here rather than at the door, so a message refused for a blank
  // subject or a stray newline does not use up the attempt that fixes it.
  if (!rateLimit(`contact:${ip}`, PER_IP_PER_MIN) || !rateLimit("contact:all", GLOBAL_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "That's a lot of messages at once. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Written down before it is sent, so a mail failure loses nothing.
  const stored = await recordContactMessage({ subject, body, from });

  const result = await sendContactMail({ subject, body, from });
  await markContactMessageMailed(stored.id, result.ok ? undefined : result.error);

  if (!result.ok && !result.skipped) {
    console.error("Contact form mail failed:", result.error);
  }

  // The message is safely recorded either way, so the sender is told it
  // arrived — which is true — without being shown the state of our mail setup.
  return NextResponse.json({ ok: true, mailed: result.ok, delivery: mailConfigured() ? "mail" : "stored" });
}

export async function GET() {
  return NextResponse.json(
    { ok: true, purpose: "POST { subject, body, from } to reach the people who run this." },
    { status: 200, headers: { Allow: "POST, GET" } },
  );
}
