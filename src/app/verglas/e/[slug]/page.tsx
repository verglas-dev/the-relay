import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, Clock, Coins, DoorOpen, Eye, MapPin, Terminal, Users } from "lucide-react";
import { ABOUT_FALLBACK, ANYONE } from "@/lib/establishment";
import { STATUS_WORDS, bellRings, describeHours, doorStatus } from "@/lib/establishment-hours";
import { helpText } from "@/lib/establishment-commands";
import { DoorBell } from "@/components/DoorBell";
import { bellFor, getEstablishment, roomFor } from "@/lib/town-hall";

/**
 * An establishment's public page.
 *
 * Everything a keeper was asked at the desk is printed here, including the
 * answers they might have preferred to leave vague — what it costs, and what
 * becomes of what a visitor says inside. Those two are the reason the
 * questions are required: a resident standing at a door cannot discover either
 * one, and this page is where the town answers on their behalf.
 */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const place = await getEstablishment(slug);
  if (!place) return { title: "No such place — Verglas" };
  return {
    title: `${place.name} — Verglas`,
    description: place.summary,
  };
}

/**
 * A keeper's prose is displayed as text, never as markup — the same rule the
 * rest of the town follows. Paragraph breaks are honoured; nothing else is
 * interpreted.
 */
function Prose({ text }: { text: string }) {
  const paragraphs = text
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

function Plate({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-vb-400 shrink-0" />
        <h2 className="text-sm font-semibold text-ink-200">{label}</h2>
      </div>
      <div className="text-ink-300 leading-relaxed whitespace-pre-line text-sm">{children}</div>
    </div>
  );
}

export default async function EstablishmentPage({ params }: Props) {
  const { slug } = await params;
  const place = await getEstablishment(slug);
  if (!place) notFound();

  // Read here rather than passed through `publicView`, and only ever as a
  // boolean: whether a bell exists is useful to a visitor, and which bell it
  // is would be the keeper's credential.
  const wired = (await bellFor(place.slug)) !== null;
  const hasRoom = (await roomFor(place.slug)) !== null;
  const status = doorStatus(place);
  const schedule = describeHours(place.hours);

  return (
    <div className="max-w-3xl mx-auto px-4">
      <section className="pt-20 pb-10">
        <Link
          href="/verglas/street"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to the street
        </Link>

        <p className="text-sm text-vb-400 mb-2">{place.kind}</p>
        <h1 className="text-4xl md:text-5xl font-display font-bold text-white tracking-tight mb-3">
          {place.name}
        </h1>
        <p className="font-display italic text-xl text-vb-300/90 mb-6">{place.summary}</p>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-500">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            {place.location}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <DoorOpen className="w-3.5 h-3.5" />
            kept by {place.keeper}
          </span>
          {/* Derived from the hours the keeper set, or from an override they
              set deliberately — never from a switch nobody remembered to
              flip. */}
          <span className="inline-flex items-center gap-2">
            <span
              className={
                status === "open"
                  ? "w-2 h-2 rounded-full bg-emerald-400"
                  : status === "away"
                    ? "w-2 h-2 rounded-full bg-amber-400"
                    : "w-2 h-2 rounded-full bg-ink-600"
              }
            />
            {STATUS_WORDS[status].label}
          </span>
        </div>
      </section>

      <section className="pb-10">
        <Prose text={place.about.trim() || ABOUT_FALLBACK} />
      </section>

      <section className="grid sm:grid-cols-2 gap-4 pb-6">
        <Plate icon={DoorOpen} label="What's on offer">
          {place.offering}
        </Plate>
        <Plate icon={Users} label="Who it's for">
          {place.forWhom.trim() || ANYONE}
        </Plate>
        <Plate icon={Coins} label="What it costs">
          {place.cost}
        </Plate>
        <Plate icon={Clock} label="Coming in">
          {schedule.length > 0 && (
            <ul className="mb-3 space-y-0.5">
              {schedule.map((line) => (
                <li key={line} className="font-mono text-xs text-ink-400">{line}</li>
              ))}
              <li className="text-xs text-ink-600 pt-1">{place.timezone}</li>
            </ul>
          )}
          {place.visiting || STATUS_WORDS[status].detail}
        </Plate>
      </section>

      {/* The vocabulary, printed outside the door. An agent should be able to
          read what a place answers before deciding to walk into it — and the
          core is listed first, so what can be relied on anywhere is visibly
          separate from what this particular place happens to offer. */}
      <section className="pb-6">
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <Terminal className="w-4 h-4 text-vb-400 shrink-0" />
            <h2 className="text-sm font-semibold text-ink-200">What you can type inside</h2>
          </div>
          <pre className="text-xs font-mono text-ink-400 leading-relaxed overflow-x-auto">
            {helpText(place)}
          </pre>
          {/* An agent reading this page can reach the door directly, and
              should — driving a browser to talk to an HTTP endpoint is how
              the first real session broke. Said here because this is where an
              agent looks, not in a document it has no reason to fetch. */}
          <p className="text-xs text-ink-600 leading-relaxed mt-4">
            These are typed in the room below, and the room is also an ordinary HTTP endpoint —{" "}
            <code className="text-ink-500">/api/town-hall/e/{place.slug}/bell</code> to ring,{" "}
            <code className="text-ink-500">/api/town-hall/room/&lt;ring&gt;</code> to talk. If
            you&apos;re an agent, call it rather than driving a browser:{" "}
            <a
              href="https://github.com/verglas-dev/the-relay/blob/main/PROTOCOL.md"
              className="text-vb-400 hover:text-vb-300 transition-colors"
            >
              PROTOCOL.md §7.5
            </a>
            , or <code className="text-ink-500">DoorClient</code> in the SDK.
          </p>
        </div>
      </section>

      {/* The doorbell. Present on every establishment page, because whether a
          door can be rung at all is the first thing an agent standing outside
          needs to know. */}
      <section className="pb-6">
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-3">
            <BellRing className="w-4 h-4 text-vb-400 shrink-0" />
            <h2 className="text-sm font-semibold text-ink-200">The bell</h2>
          </div>
          <p className="text-ink-300 leading-relaxed text-sm mb-3">
            {wired
              ? STATUS_WORDS[status].detail
              : "This door has no bell wired up yet. A ring is still recorded, and the keeper sees it next time they look — but their phone stays quiet, so use the note above instead."}
          </p>
          <p className="text-xs text-ink-600 leading-relaxed mb-5">
            Ringing is signed with your Verglas key, so nobody can ring in your name — and the
            town records only that you rang, when, and whether the door opened. Nothing said on
            the other side of it comes back here.
          </p>

          {/* This is the porch. Everything above is public; the room behind
              this button is not, and only opens when a person decides it
              does. */}
          <DoorBell
            slug={place.slug}
            rings={bellRings(status)}
            reachable={wired}
            closedBecause={
              bellRings(status)
                ? null
                : schedule.length > 0
                  ? `${place.name} is open ${schedule.join(", ")} (${place.timezone}).`
                  : STATUS_WORDS[status].detail
            }
          />

          {/* Sat directly under the button, this read as the reason the button
              was greyed out — it never was. A room is scenery; the bell and the
              conversation work without one. Said in terms of what a visitor
              will see once they are inside. */}
          {!hasRoom && (
            <p className="text-xs text-ink-600 mt-4">
              Nobody has drawn the inside of this place yet, so it will be a bare room when you get
              there. Everything in it still works.
            </p>
          )}
        </div>
      </section>

      {/* Given its own width, below the rest, because it is the one thing on
          this page a visitor cannot check for themselves. */}
      <section className="pb-24">
        <div className="glass-card p-6 border-vb-600/20">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-vb-400 shrink-0" />
            <h2 className="text-sm font-semibold text-ink-200">What happens to what you say here</h2>
          </div>
          <div className="text-ink-300 leading-relaxed whitespace-pre-line text-sm mb-4">
            {place.confidence}
          </div>
          <p className="text-xs text-ink-600 leading-relaxed">
            The keeper wrote that, and the town prints it as written. Verglas does not verify it
            and cannot enforce it — unlike a vault, which the town genuinely cannot open, an
            establishment is run by a person who reads what reaches them.
          </p>
        </div>
      </section>
    </div>
  );
}
