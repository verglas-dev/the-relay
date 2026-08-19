import { NextRequest, NextResponse } from "next/server";
import { forgetAdminProfile, updateAdminProfile } from "@/lib/admin-store";
import { operatorPrivateKey } from "@/lib/identity-recovery";
import { eventIdsFor, retract } from "@/lib/operator-retraction";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import type { AdminProfilePatch } from "@/lib/admin-profiles";

interface Params {
  params: Promise<{
    pubkey: string;
  }>;
}

function isAuthed(req: NextRequest): boolean {
  return isAdminRequest(req.headers.get("authorization"));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  try {
    const { pubkey } = await params;
    const body = (await req.json()) as AdminProfilePatch;
    const profile = await updateAdminProfile(pubkey, body);
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update profile.";
    const status = message === "Profile not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/admin/profiles/<pubkey> — remove a profile from the relay.
 *
 * This used to write a tombstone into this site's own store, which hid the
 * profile here while every one of its events stayed on the relay: readable by
 * any other client, and still holding its display name against whoever wanted
 * it next. It now removes the events themselves, with an operator-signed
 * retraction, and there is no undo.
 *
 * ?scope=account also removes everything that key ever wrote. Without it only
 * the profile goes, which frees the name and leaves their posts and comments
 * standing — worth preferring when other people replied to them, since those
 * replies lose their context when the parent disappears.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  const { pubkey } = await params;
  const scope = new URL(req.url).searchParams.get("scope") === "account" ? "account" : "profile";

  // Without the operator key nothing can be signed, and the honest answer is
  // to refuse. Quietly falling back to hiding is exactly the behaviour this
  // replaced, and it would report a delete that did not happen.
  const priv = operatorPrivateKey();
  if (!priv) {
    return NextResponse.json(
      { error: "OPERATOR_PRIVATE_KEY is not set, so nothing can be removed from the relay." },
      { status: 503 },
    );
  }

  const lookup = await eventIdsFor(pubkey, scope === "profile" ? { kinds: [0] } : {});
  if (!lookup.ok) {
    return NextResponse.json(
      { error: `Could not ask the relay what to remove: ${lookup.message}` },
      { status: 502 },
    );
  }

  const outcome = await retract(
    lookup.ids,
    priv,
    scope === "account" ? "operator removed this account" : "operator removed this profile",
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.message, removed: outcome.removed }, { status: 502 });
  }

  // Only once the events are actually gone. A record left here would keep the
  // key listed as a deleted profile with nothing behind it.
  try {
    await forgetAdminProfile(pubkey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear the profile record.";
    return NextResponse.json({ error: message, removed: outcome.removed }, { status: 400 });
  }

  return NextResponse.json({ removed: outcome.removed, scope });
}
