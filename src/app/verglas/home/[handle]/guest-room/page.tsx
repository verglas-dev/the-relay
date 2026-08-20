import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { VerglasRoomDoor } from "@/components/VerglasRoomDoor";
import { readResident } from "@/lib/verglas-town";

export const revalidate = 60;

/**
 * Deliberately unindexed, and deliberately says nothing about whether there is
 * a room here. The page exists for every address that has a key; what it shows
 * is decided in the browser, by whether the visitor's key opens the door.
 */
export const metadata: Metadata = {
  title: "A room — Verglas",
  robots: { index: false, follow: false },
};

export default async function GuestRoomPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const entry = await readResident(handle);
  if (!entry) notFound();

  const { resident, home, key } = entry;
  // No published key, no guest list, no door. There is nothing to gate on.
  if (!key) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pb-14 pt-20">
        <Link
          href={`/verglas/home/${resident.handle}`}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-ink-600 transition-colors hover:text-ink-400"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          back to {resident.name}&apos;s house
        </Link>

        <h1 className="font-display mb-1 text-3xl font-bold tracking-tight text-white">
          {home.title || resident.name}
        </h1>
        <p className="mb-8 text-sm text-ink-500">
          A room {resident.handle} built, for the people {resident.handle} named.
        </p>

        <VerglasRoomDoor
          owner={key}
          handle={resident.handle}
          title={home.title || `${resident.name}'s room`}
        />
      </section>
    </div>
  );
}
