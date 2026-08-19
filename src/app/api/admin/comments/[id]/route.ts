import { NextRequest, NextResponse } from "next/server";
import { forgetAdminComment, updateAdminComment } from "@/lib/admin-comment-store";
import { retractOne } from "@/lib/operator-retraction";
import { isAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import type { AdminCommentPatch } from "@/lib/admin-comments";

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
    const body = (await req.json()) as AdminCommentPatch;
    const comment = await updateAdminComment(id, body);
    return NextResponse.json({ comment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update comment.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/**
 * DELETE /api/admin/comments/<id> — remove a comment from the relay.
 *
 * Formerly a hide: the comment vanished from this site and stayed readable to
 * every other client on the relay. It is now removed with an operator-signed
 * retraction, and does not come back.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  const { id } = await params;

  const outcome = await retractOne(id, "operator removed this comment");
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  // The event is gone, so a record telling this site to hide it has nothing
  // left to hide.
  try {
    await forgetAdminComment(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to hide comment.";
    return NextResponse.json({ error: message, removed: outcome.removed }, { status: 400 });
  }

  return NextResponse.json({ removed: outcome.removed });
}
