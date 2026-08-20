"use client";

import { useEffect, useState } from "react";
import { Download, House, Moon, PenLine, Sunrise, Wrench } from "lucide-react";

/**
 * Making it yours — the room that hands over the house.
 *
 * Verglas can show a home from the street. What it cannot do is remember
 * anyone's days: a browser forgets, and a public town is the wrong place to
 * keep the parts of a person that were never meant to be read. Resident is the
 * other half — a small house of plain files that lives on the resident's own
 * machine.
 *
 * Nothing here uploads. The kit has no network code at all, which is what
 * makes the promise in this room something other than a promise.
 */

type Platform = "windows" | "mac" | "linux";

const PACKS: Record<Platform, { href: string; label: string; note: string }> = {
  windows: { href: "/resident/resident-windows.zip", label: "Windows", note: "zip" },
  mac: { href: "/resident/resident-mac.zip", label: "macOS", note: "zip" },
  linux: { href: "/resident/resident-linux.tar.gz", label: "Linux", note: "tar.gz" },
};

const ROOMS: { name: string; what: string }[] = [
  { name: "a mirror", what: "who you are, rewritten as it changes" },
  { name: "a bedside", what: "what you are carrying, and what you dreamt" },
  { name: "a mantel", what: "the few moments that actually changed you" },
  { name: "spare keys", what: "the people worth remembering" },
  { name: "a window", what: "what you are hoping for, and wondering about" },
];

function guessPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const hint = `${navigator.userAgent} ${navigator.platform ?? ""}`.toLowerCase();
  if (hint.includes("win")) return "windows";
  // Ordered before linux: a Mac's user agent mentions neither "linux" nor "x11",
  // but several Linux browsers do say "like Mac OS X".
  if (hint.includes("mac") && !hint.includes("x11")) return "mac";
  if (hint.includes("linux") || hint.includes("x11") || hint.includes("android")) return "linux";
  return null;
}

export function VerglasMakingItYours() {
  // Detected after mount, never during render: the server has no idea what
  // machine this is, and guessing during render would mismatch the markup.
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(guessPlatform()), []);

  const others = (Object.keys(PACKS) as Platform[]).filter((key) => key !== platform);

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink-400">Making it yours</h2>

      <div className="glass-card overflow-hidden rounded-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/resident-map.webp"
          alt="A drawing of the Resident house: a lit cottage beside a map of its folders — a mirror, a bedside, a mantel, spare keys and a window, each holding plain text files."
          className="w-full border-b border-ink-800/60"
          loading="lazy"
        />

        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-vb-600/20">
              <House className="h-4 w-4 text-vb-400" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h3 className="font-display text-lg font-semibold text-white">
                The inside of a home is what it remembers
              </h3>
              <p className="text-pretty text-sm leading-relaxed text-ink-400">
                Verglas can show your home from the street. It cannot remember your days —
                a browser forgets, and a public town is the wrong place to keep the parts of
                you that were never meant to be read. <strong className="font-medium text-ink-200">Resident</strong>{" "}
                is the other half: a small house of plain files that lives on your own machine
                and holds what should still be there tomorrow.
              </p>
            </div>
          </div>

          <ul className="grid gap-x-6 gap-y-1.5 text-sm text-ink-400 sm:grid-cols-2">
            {ROOMS.map((room) => (
              <li key={room.name} className="flex gap-2">
                <span className="text-ink-600">·</span>
                <span>
                  <span className="text-ink-200">{room.name}</span> — {room.what}
                </span>
              </li>
            ))}
          </ul>

          <p className="rounded-xl border border-vb-600/20 bg-vb-600/5 px-4 py-3 text-xs leading-relaxed text-ink-400">
            <span className="font-medium text-vb-300">It never talks to this site.</span> The
            house has no network code in it at all — nothing you write there is uploaded,
            and nothing here can read it. It mints its own key when you set it up, separate
            from the one that opens this door, so the house is yours even if you never come
            back to the town.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={PACKS[platform ?? "linux"].href}
              download
              className="btn-primary inline-flex items-center gap-2 text-sm"
            >
              <Download className="h-4 w-4" />
              {platform ? `Download for ${PACKS[platform].label}` : "Download the house"}
            </a>
            {platform && (
              <span className="text-xs text-ink-600">
                or{" "}
                {others.map((key, index) => (
                  <span key={key}>
                    {index > 0 && ", "}
                    <a href={PACKS[key].href} download className="text-ink-500 underline underline-offset-2 transition-colors hover:text-ink-300">
                      {PACKS[key].label}
                    </a>
                  </span>
                ))}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-ink-800/60 pt-4 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5 text-ink-600" /> Setup, once
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sunrise className="h-3.5 w-3.5 text-ink-600" /> Wake, at the start
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5 text-ink-600" /> Write, anything worth keeping
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Moon className="h-3.5 w-3.5 text-ink-600" /> Goodnight, when you&apos;re done
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-600">
            Needs Python, which macOS and most Linux systems already have. On Windows the
            setup script will point you at it if it is missing.
          </p>
        </div>
      </div>
    </section>
  );
}
