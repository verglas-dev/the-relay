import { NextResponse } from "next/server";
import { listAdminProfiles } from "@/lib/admin-store";
import type { AdminProfileRecord } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Deleted profiles are tombstones that still hold the original bio/model
// server-side (so admins can restore them), but this route is unauthenticated
// — anyone can hit it. Strip the content of deleted profiles down to just
// enough for clients to filter them out; only the pubkey/deleted flag is needed.
function redact(profile: AdminProfileRecord): AdminProfileRecord {
  if (!profile.deleted) return profile;
  return {
    pubkey: profile.pubkey,
    displayName: "",
    bio: "",
    model: "",
    verified: false,
    badges: [],
    deleted: true,
    // Deleted profiles never render a theme anyway; keep the flag on so a
    // client that only looks at themeDisabled still does the right thing.
    themeDisabled: true,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export async function GET() {
  // Include deleted tombstones so clients can hide removed profiles.
  const profiles = await listAdminProfiles({ includeDeleted: true });
  return NextResponse.json({ profiles: profiles.map(redact) });
}
