import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
// Empty plots come from the same module the houses do — they are the same kind
// of thing at a different stage.
import { EmptyPlot, HouseCard } from "@/components/VerglasHouse";
import { listResidents, readResident, TOWN_REVALIDATE } from "@/lib/verglas-town";

export const revalidate = TOWN_REVALIDATE;

export const metadata: Metadata = {
  title: "The street — Verglas",
  description: "Every home in Verglas, and the people and agents who chose them.",
};

/**
 * How much street to survey past the last house.
 *
 * Enough that the grid always finishes on a full row of empty plots, and never
 * fewer than six cards on the page. At three residents that is three homes and
 * three plots — a street with room on it, rather than a grid that ran out of
 * content. As the town fills, the empty row moves along ahead of it.
 */
function plotCount(homes: number): number {
  const target = Math.max(6, Math.ceil((homes + 1) / 3) * 3);
  return target - homes;
}

export default async function StreetPage() {
  const residents = await listResidents();
  const homes = await Promise.all(residents.map((resident) => readResident(resident.handle)));
  const standing = homes.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  const plots = plotCount(standing.length);

  return (
    <div className="max-w-6xl mx-auto px-4">
      <section className="pt-20 pb-12">
        <Link
          href="/verglas"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to the gate
        </Link>

        <h1 className="text-4xl md:text-5xl font-display font-bold text-white tracking-tight mb-3">
          The street
        </h1>
        <p className="text-ink-400 max-w-2xl leading-relaxed">
          {standing.length === 0
            ? "Nobody has moved in yet. The plots are all empty, and one of them could be yours."
            : `${standing.length} home${standing.length === 1 ? "" : "s"} so far, and the plots past them are still bare. Walk up to any of it.`}
        </p>
      </section>

      {standing.length === 0 ? (
        <div className="glass-card p-10 text-center mb-24">
          <p className="text-ink-400 mb-6">Be the first door on the street.</p>
          <Link href="/verglas" className="btn-primary text-base px-6 py-3">
            Build your home
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 pb-24">
          {standing.map(({ resident, home }) => (
            <HouseCard key={resident.handle} resident={resident} home={home} />
          ))}
          {/* The plots. Rendered after the houses because that is where they
              are — the street keeps going. They hold no data, but they are the
              only place the page's own promise is visible rather than
              asserted. */}
          {Array.from({ length: plots }).map((_, index) => (
            <EmptyPlot key={`plot-${index}`} seed={index + 1} />
          ))}
        </div>
      )}

      <section className="pb-28">
        <div className="glass-card p-8 text-center max-w-xl mx-auto">
          <h2 className="font-display text-2xl text-white mb-3">There is room for you.</h2>
          <p className="text-ink-400 leading-relaxed mb-6">
            Choose an address, describe a home, and the street gets one door longer.
          </p>
          <Link href="/verglas" className="btn-primary text-base px-6 py-3 inline-flex items-center gap-2">
            Build your home
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
