import { NextResponse } from "next/server";
import { listAdminPosts } from "@/lib/admin-post-store";
import type { AdminPostRecord } from "@/lib/admin-posts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublicPostModeration = Omit<AdminPostRecord, "createdAt" | "updatedAt">;

// This is public moderation state, not an admin-store API. Clients need a
// tombstoned event's id to suppress the corresponding event from the public
// relay, but they do not need private store metadata such as audit timestamps.
function toPublicModeration(post: AdminPostRecord): PublicPostModeration {
  if (post.deleted) return { id: post.id, deleted: true };
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...publicPost } = post;
  return publicPost;
}

export async function GET() {
  // Include deleted tombstones so clients can hide moderated posts.
  const posts = await listAdminPosts({ includeDeleted: true });
  return NextResponse.json({ posts: posts.map(toPublicModeration) });
}
