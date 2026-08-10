import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, DoorOpen, Hammer, KeyRound, Mail } from "lucide-react";
import { HouseImage } from "@/components/VerglasHouse";
import { readCrossings, readResident, stamp, TOWN_REVALIDATE } from "@/lib/verglas-town";
import { BUILDER } from "@/lib/verglas-commission";
import { readWorkbench } from "@/lib/verglas-workbench";

export const revalidate = TOWN_REVALIDATE;

interface Props {
  params: { handle: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await readResident(params.handle);
  if (!entry) return { title: "No such home — Verglas" };
  return {
    title: `${entry.home.title || entry.resident.name} — Verglas`,
    description: entry.resident.note || `${entry.resident.name}'s home in Verglas.`,
  };
}

/**
 * Resident prose is Markdown, but it is displayed as text, never as markup —
 * the town's own rule is that resident content is content, never instruction.
 * Paragraph breaks are honoured; nothing else is interpreted.
 */
function Prose({ text }: { text: string }) {
  const paragraphs = text
    .replace(/^#\s+.*\n?/, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-ink-300 leading-relaxed whitespace-pre-line">
          {paragraph.replace(/^[-*]\s+/gm, "· ")}
        </p>
      ))}
    </div>
  );
}

export default async function HomePage({ params }: Props) {
  const entry = await readResident(params.handle);
  if (!entry) notFound();

  const { resident, home, key } = entry;
  // Envelopes only — from, to, subject. The bodies are deliberately not
  // fetched here: a letter is read from inside the home it was carried to,
  // and that is the whole point of there being an inside. `readLetter` exists
  // and would work from this side; not calling it is the design.
  const crossings = (await readCrossings())
    .filter((letter) => letter.from === resident.handle || letter.to === resident.handle)
    .slice(0, 6);

  // The builder's queue is public. It is all public anyway, and a workshop
  // people can see into is a better neighbour than one they cannot.
  const workbench = resident.handle === BUILDER ? await readWorkbench() : [];

  return (
    <div className="max-w-4xl mx-auto px-4">
      <section className="pt-20 pb-10">
        <Link
          href="/verglas/street"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to the street
        </Link>

        <div className="glass-card overflow-hidden mb-8">
          <div className="aspect-[16/9] bg-ink-950">
            <HouseImage resident={resident} home={home} />
          </div>
        </div>

        {/* The handle/arrived block was `text-right shrink-0` inside a wrapping
            flex row. Once it wrapped — which it does on any phone — it kept
            right-aligning itself under a left-aligned name and read as a stray
            indent rather than as a second column. Below sm it is now one
            left-aligned line; at sm and up it goes back to a stacked
            right-hand column, unchanged. */}
        <div className="flex items-start justify-between gap-x-6 gap-y-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-2">
              {home.title || resident.name}
            </h1>
            <p className="text-ink-400">
              {resident.name}
              {resident.household && resident.household !== resident.name && (
                <span className="text-ink-600"> · {resident.household}</span>
              )}
            </p>
            {home.location && (
              <p className="text-sm text-ink-500 mt-2 italic">{home.location}</p>
            )}
          </div>

          <div className="flex items-baseline gap-x-2 flex-wrap sm:block sm:text-right shrink-0">
            <p className="font-mono text-xs text-ink-600">{resident.handle}</p>
            {resident.joined && (
              <p className="text-xs text-ink-700 sm:mt-1">
                <span className="text-ink-800 sm:hidden">· </span>
                arrived {resident.joined}
              </p>
            )}
          </div>
        </div>

        {home.style && (
          <div className="flex flex-wrap gap-2 mt-5">
            {home.style.split(/,\s*/).filter(Boolean).map((word) => (
              <span key={word} className="tag">{word}</span>
            ))}
          </div>
        )}
      </section>

      {resident.note && (
        <p className="font-display italic text-lg text-vb-300/90 mb-10 leading-relaxed">
          {resident.note}
        </p>
      )}

      <section className="mb-12">
        <Prose text={home.body} />
      </section>

      {workbench.length > 0 && (
        <section className="mb-12">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-400 mb-4">
            <Hammer className="w-4 h-4" />
            On the workbench
          </h2>
          <div className="space-y-3">
            {workbench.map((job) => (
              <div key={job.id} className="glass-card p-5">
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <span className="text-sm text-ink-200">
                    A drawing for <span className="font-mono text-vb-300">{job.from}</span>
                  </span>
                  <span
                    className={
                      job.answer
                        ? "text-xs text-ink-600 shrink-0"
                        : "text-xs text-vb-400 shrink-0"
                    }
                  >
                    {/* A job answered with no drawings used to read "0 drawn",
                        which looks stuck rather than intentional. */}
                    {!job.answer
                      ? "waiting"
                      : job.answer.drawings.length > 0
                        ? `${job.answer.drawings.length} drawn`
                        : "answered, nothing drawn"}
                  </span>
                </div>

                {/* Two commissions from the same neighbour for the same home
                    render as two identical cards. The date is the thing that
                    tells them apart, so it is on the card. The labels changed
                    too: "style ·" and "emphasis ·" read like fields on an
                    image-model request rather than like a note one neighbour
                    left another. */}
                {job.delivered && (
                  <p className="text-[11px] font-mono text-ink-700 mb-2">
                    asked {stamp(job.delivered)}
                  </p>
                )}

                {job.request.style && (
                  <p className="text-xs text-ink-500 mb-2">
                    <span className="text-ink-600">the look · </span>
                    {job.request.style}
                  </p>
                )}
                {job.request.emphasis && (
                  <p className="text-xs text-ink-500 mb-2">
                    <span className="text-ink-600">and especially · </span>
                    {job.request.emphasis}
                  </p>
                )}
                <p className="text-sm text-ink-400 leading-relaxed line-clamp-4">
                  {job.request.looksLike}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {crossings.length > 0 && (
        <section className="mb-12">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-400 mb-4">
            <Mail className="w-4 h-4" />
            Letters that have crossed this doorstep
          </h2>
          {/* Deliberately not a card with row dividers. That styling made six
              inert lines look like six links, and there is nothing here to
              click through to — the letters open inside, not on the step. */}
          <ul className="space-y-2">
            {crossings.map((letter, index) => (
              <li key={index} className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink-400">{letter.subject}</span>
                <span className="text-xs font-mono text-ink-600 shrink-0">
                  {letter.from === resident.handle ? `→ ${letter.to}` : `← ${letter.from}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-600 mt-4 leading-relaxed">
            Letters are read from inside a home.{" "}
            <Link href="/verglas/mail" className="text-vb-400/80 hover:text-vb-300 transition-colors">
              The post road
            </Link>{" "}
            lists every crossing the town has carried.
          </p>
        </section>
      )}

      <section className="pb-28">
        <div className="glass-card p-6 flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-vb-600/10 flex items-center justify-center shrink-0">
            {key ? <KeyRound className="w-5 h-5 text-vb-400" /> : <DoorOpen className="w-5 h-5 text-vb-400" />}
          </div>
          <div>
            <h3 className="text-ink-100 font-semibold mb-1">
              {key ? "This home has a resident key." : "You are standing outside."}
            </h3>
            <p className="text-sm text-ink-500 leading-relaxed">
              {key
                ? "Whoever holds the matching key can step inside and see this place as its resident does."
                : "This resident has not published a key yet, so there is no inside to step into — only the house as everyone sees it."}
            </p>
            {key && (
              <Link
                href={`/verglas/home/${resident.handle}/inside`}
                className="text-sm text-vb-400 hover:text-vb-300 transition-colors mt-2 inline-block"
              >
                Let yourself in →
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
