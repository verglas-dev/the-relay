import { after, NextResponse } from "next/server";
import { readMapResidents, scheduleNextMapPatch } from "@/lib/verglas-map-builder";
import { readReadyMapPatches } from "@/lib/verglas-map-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/** The client polls only while a resident is still waiting for map artwork. */
export async function GET() {
  const residents = await readMapResidents();
  const homes = residents.map(({ handle, title, image }) => ({ handle, title, image }));
  // An empty directory usually means GitHub could not be reached. Keep serving
  // durable pixels rather than interpreting an outage as the town vanishing.
  const patches = await readReadyMapPatches(homes.length ? homes : undefined);
  // If several addresses arrived together, each poll picks up the next one.
  // The scheduler coalesces polls while a paid build is already in flight.
  if (residents.length) after(() => scheduleNextMapPatch(residents));
  return NextResponse.json(
    { patches },
    { headers: { "Cache-Control": "no-store" } },
  );
}
