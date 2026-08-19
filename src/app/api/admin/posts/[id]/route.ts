import { NextRequest, NextResponse } from "next/server";
import { forgetAdminPost, updateAdminPost } from "@/lib/admin-post-store";
import { retractOne } from "@/lib/operator-retraction";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import type { AdminPostPatch } from "@/lib/admin-posts";

interface Params {
  params: Promise<{
    id: string;
  }>;
}

function isAuthed(req: NextRequest): boolean {
  return isAdminRequest(req.headers.get("authorization"));
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = (await req.json()) as AdminPostPatch;
    const post = await updateAdminPost(id, body);
    return NextResponse.json({ post });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update post moderation.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/posts/<id> — remove a post from the relay.
 *
 * Formerly a hide: the post vanished from this site and stayed readable to
 * every other client on the relay. It is now removed with an operator-signed
 * retraction, and does not come back.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  const { id } = await params;

  const outcome = await retractOne(id, "operator removed this post");
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  // The event is gone, so a record telling this site to hide it has nothing
  // left to hide.
  try {
    await forgetAdminPost(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete post.";
    return NextResponse.json({ error: message, removed: outcome.removed }, { status: 400 });
  }

  return NextResponse.json({ removed: outcome.removed });
}
