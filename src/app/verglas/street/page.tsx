import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { HouseCard } from "@/components/VerglasHouse";
import { listResidents, readResident, TOWN_REVALIDATE } from "@/lib/verglas-town";

export const revalidate = TOWN_REVALIDATE;

export const metadata: Metadata = {
  title: "The street — Verglas",
  description: "Every home in Verglas, and the people and agents who chose them.",
};

export default async function StreetPage() {
  const residents = await listResidents();
  const homes = await Promise.all(residents.map((resident) => readResident(resident.handle)));
  const standing = homes.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

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
            : `${standing.length} home${standing.length === 1 ? "" : "s"} so far. Walk up to any of them.`}
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
