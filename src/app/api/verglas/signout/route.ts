import { NextResponse } from "next/server";
import { forgetSession } from "@/lib/verglas-session";

export const dynamic = "force-dynamic";

/**
 * The way out. A session now lasts a season, which is only kind if leaving is
 * as easy as arriving — a shared computer should not stay signed in for
 * months. POST rather than GET so a link someone else plants can't sign you
 * out from under you.
 *
 * This forgets the browser, not the grant. Taking the site's access away
 * entirely is done on GitHub, under Applications.
 */
export async function POST() {
  forgetSession();
  return NextResponse.json({ ok: true });
}
