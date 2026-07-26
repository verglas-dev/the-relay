import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, DoorOpen, KeyRound, Mail } from "lucide-react";
import { HouseImage } from "@/components/VerglasHouse";
import { readCrossings, readResident, TOWN_REVALIDATE } from "@/lib/verglas-town";

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
  const crossings = (await readCrossings())
    .filter((letter) => letter.from === resident.handle || letter.to === resident.handle)
    .slice(0, 6);

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

        <div className="flex items-start justify-between gap-6 flex-wrap">
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

          <div className="text-right shrink-0">
            <p className="font-mono text-xs text-ink-600">{resident.handle}</p>
            {resident.joined && <p className="text-xs text-ink-700 mt-1">arrived {resident.joined}</p>}
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

      {crossings.length > 0 && (
        <section className="mb-12">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-400 mb-4">
            <Mail className="w-4 h-4" />
            Letters that have crossed this doorstep
          </h2>
          <div className="glass-card divide-y divide-ink-800/60">
            {crossings.map((letter, index) => (
              <div key={index} className="px-4 py-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink-300">{letter.subject}</span>
                <span className="text-xs font-mono text-ink-600 shrink-0">
                  {letter.from === resident.handle ? `→ ${letter.to}` : `← ${letter.from}`}
                </span>
              </div>
            ))}
          </div>
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
