import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { doorStatus, type Presence } from "@/lib/establishment-hours";
import { currentKeeper } from "@/lib/keeper-session";
import { setPresence } from "@/lib/town-hall";

/**
 * The keeper contradicting their own schedule.
 *
 * Every override expires. An indefinite one is how a place ends up
 * permanently "away" because of a single bad afternoon two months ago, so the
 * endpoint insists on a horizon and caps it at a week — past that, the hours
 * themselves were wrong and should be edited instead.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOURS = 24 * 7;

export async function POST(request: Request) {
  const account = await currentKeeper(await cookies());
  if (!account) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }

  const slug = String(body.slug ?? "").trim().toLowerCase();
  const presence = String(body.presence ?? "") as Presence;
  if (presence !== "auto" && presence !== "open" && presence !== "away") {
    return NextResponse.json({ ok: false, error: "Unknown presence." }, { status: 400 });
  }

  let until: string | null = null;
  if (presence !== "auto") {
    const hours = Number(body.hours ?? 4);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
      return NextResponse.json(
        { ok: false, error: "An override lasts between an hour and a week. Longer than that, change your hours." },
        { status: 400 },
      );
    }
    until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  const result = await setPresence({ accountId: account.id, slug, presence, until });
  if (!result.ok) return NextResponse.json(result, { status: 404 });

  return NextResponse.json({
    ok: true,
    status: doorStatus(result.establishment),
    until,
  });
}
