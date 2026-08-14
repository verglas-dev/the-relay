import { NextRequest, NextResponse } from "next/server";
import { deleteAdminProfile, updateAdminProfile } from "@/lib/admin-store";
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

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!isAuthed(req)) return unauthorizedResponse();

  try {
    const { pubkey } = await params;
    const profile = await deleteAdminProfile(pubkey);
    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete profile.";
    const status = message === "Profile not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
