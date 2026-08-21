import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import {
  EMPTY_ESTABLISHMENT,
  checkEstablishment,
  publicView,
  type EstablishmentDraft,
} from "@/lib/establishment";
import { townHallConfigured } from "@/lib/human-account";
import { currentKeeper } from "@/lib/keeper-session";
import { openEstablishment, reviseEstablishment } from "@/lib/town-hall";

/**
 * Opening a place, and rewriting one.
 *
 * `POST` spends a permit; `PUT` costs nothing, because the permit that bought
 * the property was spent when it opened. Both re-run the same check the form
 * ran, for the ordinary reason: a browser can be edited, and the questions the
 * town insists on — what is offered, what it costs, when the door is open, and
 * what becomes of what a visitor says inside — are the ones a resident cannot
 * find out any other way.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITES_PER_MIN = 10;
const MAX_BODY_BYTES = 64 * 1024;

async function draftFrom(request: Request): Promise<EstablishmentDraft | null> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // Spread onto the empty draft so a missing field is an empty answer the
    // check can complain about, rather than an undefined one it cannot read.
    return { ...EMPTY_ESTABLISHMENT, ...(parsed as Partial<EstablishmentDraft>) };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  if (!rateLimit(`establishment:${callerIp(request)}`, WRITES_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const draft = await draftFrom(request);
  if (!draft) return NextResponse.json({ ok: false, error: "That submission could not be read." }, { status: 400 });

  const check = checkEstablishment(draft);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: "Some answers still need work.", fields: check.errors },
      { status: 400 },
    );
  }

  const result = await openEstablishment({ accountId: account.id, draft });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, fields: result.field ? { [result.field]: result.error } : undefined },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    establishment: publicView(result.establishment),
    href: `/verglas/e/${result.establishment.slug}`,
  });
}

export async function PUT(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  if (!rateLimit(`establishment:${callerIp(request)}`, WRITES_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Slow down a moment." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const draft = await draftFrom(request);
  if (!draft) return NextResponse.json({ ok: false, error: "That submission could not be read." }, { status: 400 });

  const check = checkEstablishment(draft);
  if (!check.ok) {
    return NextResponse.json(
      { ok: false, error: "Some answers still need work.", fields: check.errors },
      { status: 400 },
    );
  }

  const result = await reviseEstablishment({ accountId: account.id, slug: draft.slug, draft });
  if (!result.ok) {
    // The same answer for "no such place" and "not yours": a keeper learning
    // which slugs exist by editing them is a directory nobody asked for.
    return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    establishment: publicView(result.establishment),
    href: `/verglas/e/${result.establishment.slug}`,
  });
}
