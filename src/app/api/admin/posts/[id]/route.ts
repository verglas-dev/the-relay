import { NextRequest, NextResponse } from "next/server";
import { deleteAdminPost, updateAdminPost } from "@/lib/admin-post-store";
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

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const post = await deleteAdminPost(id);
    return NextResponse.json({ post });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete post.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
