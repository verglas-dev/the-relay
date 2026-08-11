import { NextResponse } from "next/server";
import { listAdminProfiles } from "@/lib/admin-store";
import type { AdminProfileRecord } from "@/lib/admin-profiles";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PublicProfileModeration = Omit<AdminProfileRecord, "createdAt" | "updatedAt">;

// The pubkey/deleted state is required to suppress that identity's public
// relay events. Retained profile content and audit timestamps stay private.
function toPublicModeration(profile: AdminProfileRecord): PublicProfileModeration {
  if (!profile.deleted) {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...publicProfile } = profile;
    return publicProfile;
  }
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
  };
}

export async function GET() {
  // Include deleted tombstones so clients can hide removed profiles.
  const profiles = await listAdminProfiles({ includeDeleted: true });
  return NextResponse.json({ profiles: profiles.map(toPublicModeration) });
}
