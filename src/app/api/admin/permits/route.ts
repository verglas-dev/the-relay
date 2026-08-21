import { NextResponse } from "next/server";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { permitState, DEFAULT_TTL_DAYS } from "@/lib/establishment-permit";
import { issuePermit, listPermits } from "@/lib/town-hall";

/**
 * The permit desk, from the town's side.
 *
 * Issuing is a deliberate act by whoever runs Verglas — there is no self-serve
 * path to a permit anywhere in this application, which is the entire point of
 * the mechanism. It sits behind the same bearer token as the rest of `/api/admin`.
 *
 * The code is in the response to `POST` and nowhere else, ever. `GET` lists
 * what has been issued and what became of it, but only hashes: the town can
 * tell you a permit exists, was bound, and was spent on a particular place,
 * and cannot tell you — or anyone who gets hold of this listing — what to type.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminRequest(request.headers.get("authorization"))) return unauthorizedResponse();

  const permits = await listPermits();
  return NextResponse.json({
    ok: true,
    permits: permits.map((permit) => ({
      id: permit.id,
      state: permitState(permit),
      note: permit.note,
      issuedAt: permit.issuedAt,
      expiresAt: permit.expiresAt,
      boundAt: permit.boundAt,
      spentOn: permit.spentOn,
      spentAt: permit.spentAt,
    })),
  });
}

export async function POST(request: Request) {
  if (!isAdminRequest(request.headers.get("authorization"))) return unauthorizedResponse();

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  // `ttlDays: null` is a permit that does not lapse, which is a different
  // thing from an unspecified `ttlDays` — hence the explicit undefined check
  // rather than the usual `??`.
  let ttlDays: number | null | undefined;
  if (body.ttlDays === null) ttlDays = null;
  else if (body.ttlDays !== undefined) {
    const days = Number(body.ttlDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return NextResponse.json(
        { ok: false, error: "A permit lasts between a day and a year, or forever with null." },
        { status: 400 },
      );
    }
    ttlDays = days;
  }

  const note = typeof body.note === "string" ? body.note : "";
  const { permit, code } = await issuePermit({ note, ttlDays });

  return NextResponse.json({
    ok: true,
    // Said plainly, because the next thing that happens is somebody closing
    // this terminal.
    notice: "Write this code down now. The town keeps only its hash and cannot show it again.",
    code,
    permit: {
      id: permit.id,
      note: permit.note,
      issuedAt: permit.issuedAt,
      expiresAt: permit.expiresAt,
      lastsDays: ttlDays === undefined ? DEFAULT_TTL_DAYS : ttlDays,
    },
  });
}
