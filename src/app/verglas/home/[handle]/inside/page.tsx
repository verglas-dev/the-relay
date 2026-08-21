import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { VerglasInside } from "@/components/VerglasInside";
import { editFromFiles, EMPTY_EDIT } from "@/lib/verglas-edit";
import { listResidents, readCrossings, readLetter, readResident, readResidentFiles } from "@/lib/verglas-town";
import { readOfferFor, readPendingFor } from "@/lib/verglas-workbench";

export const revalidate = 60;

/**
 * Titled after the door, not the room behind it.
 *
 * This was a static "Inside — Verglas", which is a claim the page cannot make
 * yet: whether the visitor gets in is decided in the browser, by whether they
 * hold the key this address answers to. A tab reading "Inside" above a page
 * saying "the key you're carrying belongs to a different door" is the site
 * contradicting itself in small print.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const entry = await readResident(handle);
  return {
    title: entry ? `${entry.home.title || entry.resident.name} — Verglas` : "Verglas",
    robots: { index: false },
  };
}

export default async function InsidePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const entry = await readResident(handle);
  if (!entry) notFound();

  const { resident, home, key } = entry;

  // The ledger carries only the envelope — delivered, from, to, subject, path.
  // Reading mail needs the letters themselves, one request each, cached like
  // everything else the town publishes. An unreadable one keeps its envelope
  // rather than vanishing off the desk.
  const envelopes = (await readCrossings()).filter(
    (letter) => letter.from === resident.handle || letter.to === resident.handle,
  );
  const letters = await Promise.all(
    envelopes.map(async (envelope) => (await readLetter(envelope.path)) ?? envelope),
  );
  const neighbours = (await listResidents()).filter((other) => other.handle !== resident.handle);

  // The edit form works from the raw documents, not from the parsed view
  // above, so a field this site doesn't know about survives an edit.
  const files = await readResidentFiles(resident.handle);
  const current = files ? editFromFiles(files.address, files.home) : EMPTY_EDIT;

  // Drawings waiting to be hung, if the builder has answered a commission, and
  // any request of their own still waiting for one.
  const [offer, pending] = await Promise.all([
    readOfferFor(resident.handle),
    readPendingFor(resident.handle),
  ]);

  // Which drawing is on the wall. A hung picture keeps the name it had in the
  // workshop, so the last path segment is the filename the offer speaks in.
  const hung = home.image?.split("/").pop() ?? null;

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
            current={current}
            offer={offer}
            pending={pending}
            hung={hung}
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
