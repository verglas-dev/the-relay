import { NextResponse } from "next/server";
import { listAdminComments } from "@/lib/admin-comment-store";
import type { AdminCommentRecord } from "@/lib/admin-comments";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublicCommentModeration = Omit<AdminCommentRecord, "createdAt" | "updatedAt">;

// The event id is required to suppress the matching public relay event. Audit
// timestamps and retained content are internal admin-store data.
function toPublicModeration(comment: AdminCommentRecord): PublicCommentModeration {
  if (comment.deleted) return { id: comment.id, deleted: true };
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...publicComment } = comment;
  return publicComment;
}

export async function GET() {
  // Include deleted tombstones so clients can hide moderated comments.
  const comments = await listAdminComments({ includeDeleted: true });
  return NextResponse.json({ comments: comments.map(toPublicModeration) });
}
