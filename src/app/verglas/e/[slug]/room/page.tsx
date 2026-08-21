import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EstablishmentRoom } from "@/components/EstablishmentRoom";
import { STATUS_WORDS, doorStatus } from "@/lib/establishment-hours";
import { getEstablishment, getRing, roomFor } from "@/lib/town-hall";
import { ringState } from "@/lib/ring";

/**
 * Inside a place.
 *
 * The room is fetched here rather than carried on the establishment's public
 * record: it is several kilobytes of markup that only this page needs, and
 * every other page that lists establishments would otherwise carry a copy of
 * every keeper's interior.
 */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ring?: string }>;
}

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  const place = await getEstablishment(slug);
  return place
    ? {
        title: `Inside ${place.name} — Verglas`,
        description: place.summary,
        // Behind a door somebody had to open. Not a page for a crawler.
        robots: { index: false, follow: false },
      }
    : { title: "No such place — Verglas" };
}

export default async function RoomPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { ring: ringId } = await searchParams;
  const place = await getEstablishment(slug);
  if (!place) notFound();

  /**
   * The way in is the ring itself.
   *
   * An unguessable id, handed to exactly one caller — whoever rang — and only
   * usable once a real person pressed *Open the door*. That is what makes this
   * page private without a session or a second signature: there is nothing to
   * guess and nothing to forge, and until somebody decides otherwise there is
   * no door here at all.
   */
  const ring = ringId ? await getRing(ringId) : null;
  const admitted =
    ring !== null && ring.slug === place.slug && ringState(ring) === "opened";

  if (!admitted) {
    return (
      <div className="max-w-md mx-auto px-4 pt-24 pb-28">
        <div className="glass-card p-8 text-center">
          <h1 className="font-display text-2xl text-white mb-3">The door is closed.</h1>
          <p className="text-sm text-ink-400 leading-relaxed mb-6">
            {ring
              ? "That visit is over. Ring again when you'd like to come back."
              : "Rooms are entered from the doorstep, and only once somebody opens the door."}
          </p>
          <Link href={`/verglas/e/${place.slug}`} className="btn-primary px-5 py-2.5 inline-block">
            Back to the door
          </Link>
        </div>
      </div>
    );
  }

  const room = await roomFor(place.slug);
  const status = doorStatus(place);

  return (
    <div className="max-w-5xl mx-auto px-4">
      <section className="pt-12 pb-6">
        <Link
          href={`/verglas/e/${place.slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back outside
        </Link>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm text-vb-400 mb-1">{place.kind}</p>
            <h1 className="text-3xl font-display font-bold text-white tracking-tight">
              {place.name}
            </h1>
          </div>
          <p className="text-sm text-ink-500">{STATUS_WORDS[status].label} — kept by {place.keeper}</p>
        </div>
      </section>

      <section className="pb-8">
        <EstablishmentRoom
          slug={place.slug}
          name={place.name}
          greeting={place.greeting}
          ring={ring.id}
          room={room}
          commands={place.commands}
        />
      </section>

      <section className="pb-24">
        <p className="text-xs text-ink-600 leading-relaxed max-w-2xl">
          The room around the terminal is the keeper&apos;s, drawn from their own description and
          sealed in a frame with no network and no way to reach this page. It cannot see what you
          type. The terminal is the town&apos;s — which is why{" "}
          <span className="font-mono text-ink-500">LEAVE</span> always works, whatever the room
          says.
        </p>
      </section>
    </div>
  );
}
