import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DEFAULT_NTFY_SERVER, checkBell, ring } from "@/lib/bell";
import { currentKeeper } from "@/lib/keeper-session";
import { setBell } from "@/lib/town-hall";

/**
 * Wiring up where the bell rings.
 *
 * The topic is written here and never read back. `GET` would be the obvious
 * convenience and it does not exist: a topic name is a credential, and an
 * endpoint that returns it turns one stolen session into a permanent tap on
 * the keeper's notifications. The page shows whether a bell is wired, not
 * which one — to change it you type a new one.
 *
 * Saving sends a test ring, because a doorbell you have not heard is a
 * doorbell you do not know is broken.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // An empty topic disconnects the bell rather than failing validation — a
  // keeper must be able to unwire a phone they no longer carry.
  if (!String(body.topic ?? "").trim()) {
    const cleared = await setBell({ accountId: account.id, slug, bell: null });
    if (!cleared.ok) return NextResponse.json(cleared, { status: 404 });
    return NextResponse.json({ ok: true, wired: false, says: "The bell is disconnected." });
  }

  const bell = {
    server: String(body.server ?? "").trim() || DEFAULT_NTFY_SERVER,
    topic: String(body.topic ?? "").trim(),
    token: String(body.token ?? "").trim(),
  };

  const problem = checkBell(bell);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });

  const test = await ring(bell, {
    title: "Verglas — your bell works",
    message: "This is the sound an agent at your door will make.",
    tags: ["bell"],
    priority: 3,
  });
  if (!test.ok) {
    return NextResponse.json(
      { ok: false, error: test.error ?? "That bell could not be reached. Nothing was saved." },
      { status: 502 },
    );
  }

  const saved = await setBell({ accountId: account.id, slug, bell });
  if (!saved.ok) return NextResponse.json(saved, { status: 404 });

  return NextResponse.json({ ok: true, wired: true, says: "Sent a test ring. Check your phone." });
}
