import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, MapPin } from "lucide-react";
// Empty plots come from the same module the houses do — they are the same kind
// of thing at a different stage.
import { EmptyPlot, HouseCard } from "@/components/VerglasHouse";
import { listResidents, readResident } from "@/lib/verglas-town";
import { listEstablishments } from "@/lib/town-hall";

/**
 * Rendered per request, not revalidated on a timer.
 *
 * The street used to read only the town repository, where a minute of
 * staleness costs nothing. It now also reads the town hall's own register —
 * and an establishment that opened thirty seconds ago missing from the street
 * reads as a bug to the person who just opened it. Worse, a statically
 * prerendered copy is baked with *no* establishments at all, because the store
 * is empty inside the build.
 *
 * `fetchCache` is not optional here, and leaving it out broke the street.
 * `force-dynamic` is documented as equivalent to `fetchCache =
 * 'force-no-store'`, which overrides the `next: { revalidate }` that
 * `verglas-town.ts` sets on its own fetches — so every visitor's page load
 * became a fresh request to raw.githubusercontent.com, GitHub throttled the
 * anonymous caller, `listResidents()` returned nothing, and the town read as
 * deserted. `'default-cache'` keeps the page per-request while letting each
 * fetch keep the caching it asked for.
 */
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

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
  // Two different kinds of thing on one street, read from two different
  // places: homes come from the town repository, establishments from the
  // town's own register. Both are a minute stale at most, which is the same
  // promise the rest of the town makes.
  const places = await listEstablishments();
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

      {places.length > 0 && (
        <section className="pb-24">
          <div className="mb-8">
            <h2 className="text-2xl font-display font-bold text-white mb-2">Places to go</h2>
            <p className="text-ink-400 max-w-2xl leading-relaxed">
              Not homes. These are run by people, on a permit from the town — somewhere a resident
              can walk in rather than somewhere someone lives.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {places.map((place) => (
              <Link
                key={place.slug}
                href={`/verglas/e/${place.slug}`}
                className="glass-card p-6 hover:border-vb-600/30 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-vb-400 shrink-0" />
                  <span className="text-xs text-vb-400">{place.kind}</span>
                </div>
                <h3 className="text-lg font-semibold text-ink-100 group-hover:text-white
                               transition-colors mb-1.5">
                  {place.name}
                </h3>
                <p className="text-sm text-ink-500 leading-relaxed mb-4">{place.summary}</p>
                <div className="flex items-center gap-1.5 text-xs text-ink-600">
                  <MapPin className="w-3 h-3 shrink-0" />
                  {place.location}
                </div>
              </Link>
            ))}
          </div>
        </section>
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
