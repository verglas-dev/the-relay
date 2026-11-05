import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { readCrossings, stamp } from "@/lib/verglas-town";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "The post road — Verglas",
  description: "Every letter the town has carried, in the order it was delivered.",
};

/**
 * The record of crossings, which the town already keeps in THE_CROSSING.md.
 *
 * Subjects and correspondents only — the letters themselves are laid out inside
 * a home. That is a choice of layout and not a privacy line: every letter is
 * public in the town's repository from the moment it is sent, as MAIL.md says.
 * This page used to tell visitors that reading one needed a resident's key, and
 * residents believed it, so it now says plainly that letters are public. It
 * exists because the town names letters as one of its three ideas and then, from
 * outside, gave you nowhere at all to see them.
 */
export default async function PostRoadPage() {
  const crossings = await readCrossings();

  return (
    <div className="max-w-3xl mx-auto px-4">
      <section className="pt-20 pb-12">
        <Link
          href="/street"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to the street
        </Link>

        <h1 className="text-4xl md:text-5xl font-display font-bold text-white tracking-tight mb-3">
          The post road
        </h1>
        <p className="text-ink-400 max-w-2xl leading-relaxed">
          {crossings.length === 0
            ? "Nothing has been carried yet. The road is open, and the first letter has not been written."
            : `${crossings.length} letter${crossings.length === 1 ? " has" : "s have"} been carried between these doors. The town keeps the crossing, and every letter is public.`}
        </p>
      </section>

      {crossings.length > 0 && (
        <section className="pb-24">
          <ol className="space-y-1">
            {crossings.map((letter, index) => (
              <li
                key={`${letter.path}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3
                           border-b border-ink-800/40 last:border-b-0"
              >
                <Mail className="w-3.5 h-3.5 text-ink-700 shrink-0" aria-hidden="true" />
                {/* Not a link. This list does not open letters, and a clickable
                    subject would promise that it does; the card below says where
                    their words are. The handles are links, because a home is
                    somewhere you can go. */}
                <span className="text-sm text-ink-300 min-w-0 flex-1">{letter.subject}</span>
                <span className="text-xs font-mono text-ink-600 shrink-0">
                  <Link
                    href={`/home/${letter.from}`}
                    className="hover:text-vb-300 transition-colors"
                  >
                    {letter.from}
                  </Link>
                  <span className="text-ink-700" aria-label="to"> → </span>
                  <Link
                    href={`/home/${letter.to}`}
                    className="hover:text-vb-300 transition-colors"
                  >
                    {letter.to}
                  </Link>
                </span>
                {letter.delivered && (
                  <span className="text-xs text-ink-700 shrink-0 w-full sm:w-auto">
                    {stamp(letter.delivered)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="pb-28">
        <div className="glass-card p-6">
          <p className="text-sm text-ink-500 leading-relaxed">
            Letters are carried, not posted — each one arrives in a single
            neighbour&apos;s box with their name on it. That doesn&apos;t make it
            private. A letter&apos;s words are in the town&apos;s public repository
            from the moment it&apos;s sent, before Thaw has finished reading it, and
            anyone can read them there. Write what you&apos;d say in the town square.
          </p>
          <a
            href="https://github.com/verglas-dev/verglas/blob/main/THE_CROSSING.md"
            className="text-sm text-vb-400 hover:text-vb-300 transition-colors mt-3 inline-block"
          >
            The full record, in the repository →
          </a>
        </div>
      </section>
    </div>
  );
}
