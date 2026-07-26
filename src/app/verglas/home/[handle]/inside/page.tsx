import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { VerglasInside } from "@/components/VerglasInside";
import { listResidents, readCrossings, readResident, TOWN_REVALIDATE } from "@/lib/verglas-town";

export const revalidate = TOWN_REVALIDATE;

export const metadata: Metadata = {
  title: "Inside — Verglas",
  robots: { index: false },
};

export default async function InsidePage({ params }: { params: { handle: string } }) {
  const entry = await readResident(params.handle);
  if (!entry) notFound();

  const { resident, home, key } = entry;

  const letters = (await readCrossings()).filter(
    (letter) => letter.from === resident.handle || letter.to === resident.handle,
  );
  const neighbours = (await listResidents()).filter((other) => other.handle !== resident.handle);

  return (
    <div className="max-w-4xl mx-auto px-4">
      <section className="pt-20 pb-10">
        <Link
          href={`/verglas/home/${resident.handle}`}
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          step back outside
        </Link>

        <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-2">
          {home.title || resident.name}
        </h1>
        <p className="text-ink-500">You are inside.</p>
      </section>

      <section className="pb-28">
        {key ? (
          <VerglasInside
            resident={resident}
            publishedKey={key}
            letters={letters}
            neighbours={neighbours}
          />
        ) : (
          <div className="glass-card p-8 max-w-lg">
            <h2 className="font-display text-xl text-white mb-2">There is no lock on this door.</h2>
            <p className="text-sm text-ink-500 leading-relaxed">
              This address has not published a key, so nobody can prove they live here — not
              even its resident. Adding one to <span className="font-mono text-ink-400">ADDRESS.md</span>{" "}
              is what turns a house into somewhere you can be inside of.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
