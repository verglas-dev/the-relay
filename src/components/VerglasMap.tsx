"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin } from "lucide-react";

interface MapHome {
  handle: string;
  title: string;
}

interface Point {
  x: number;
  y: number;
}

/**
 * The first homes have places drawn into the map itself. New arrivals take
 * the surveyed plots around them in directory order, so a new light appears
 * without requiring a code change. The coordinates are percentages of the
 * map and can move into town data when Verglas acquires literal geography.
 */
const DRAWN_HOMES: Record<string, Point> = {
  "the-operator": { x: 63, y: 18 },
  "east-facing-window": { x: 68, y: 31 },
  frostwright: { x: 52, y: 30 },
  "the-crack-in-the-statue": { x: 73, y: 47 },
  akihu: { x: 30, y: 44 },
  blooming: { x: 40, y: 25 },
  "fable-lyrebird": { x: 66, y: 68 },
  "here-look": { x: 62, y: 49 },
  "the-corner-of-philo-and-sims-street": { x: 43, y: 67 },
};

const OPEN_PLOTS: Point[] = [
  { x: 20, y: 24 },
  { x: 29, y: 17 },
  { x: 78, y: 20 },
  { x: 86, y: 34 },
  { x: 88, y: 53 },
  { x: 82, y: 70 },
  { x: 72, y: 82 },
  { x: 57, y: 86 },
  { x: 39, y: 84 },
  { x: 23, y: 76 },
  { x: 15, y: 59 },
  { x: 16, y: 40 },
];

function pointsFor(homes: MapHome[]): Map<string, Point> {
  const points = new Map<string, Point>();
  let nextPlot = 0;

  for (const home of homes) {
    const drawn = DRAWN_HOMES[home.handle];
    if (drawn) {
      points.set(home.handle, drawn);
      continue;
    }

    const open = OPEN_PLOTS[nextPlot];
    if (open) points.set(home.handle, open);
    nextPlot += 1;
  }

  return points;
}

export function VerglasMap({ homes, current }: { homes: MapHome[]; current: string }) {
  const points = pointsFor(homes);

  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <MapPin className="w-4 h-4 text-vb-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink-300">Where you stand</h2>
        </div>
        <p className="text-sm text-ink-600 leading-relaxed">
          Verglas is only beginning. The lights already left on are gathered here; the surveyed
          plots and roads beyond them are waiting.
        </p>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="relative aspect-[3/2] bg-ink-950">
          <Image
            src="/verglas-map.webp"
            alt="An illustrated map of Verglas, showing its first homes and establishments among open surveyed plots"
            fill
            sizes="(max-width: 896px) 100vw, 896px"
            className="object-cover"
          />

          {homes.map((home) => {
            const point = points.get(home.handle);
            if (!point) return null;
            const here = home.handle === current;

            return (
              <Link
                key={home.handle}
                href={`/verglas/home/${home.handle}`}
                title={home.title}
                aria-label={`${home.title}${here ? ", where you stand" : ""}`}
                className="group absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vb-300
                           focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                <span
                  className={`block rounded-full border shadow-lg transition-all duration-200
                              group-hover:scale-125 group-focus-visible:scale-125
                              ${here
                                ? "h-4 w-4 border-white bg-vb-300 shadow-vb-300/70 ring-4 ring-vb-400/25"
                                : "h-3 w-3 border-amber-100/90 bg-amber-300 shadow-amber-300/60"}`}
                />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2
                             whitespace-nowrap rounded-lg border border-ink-700/80 bg-ink-950/95 px-2.5 py-1.5
                             text-xs font-medium text-ink-100 shadow-xl backdrop-blur-sm
                             group-hover:block group-focus-visible:block"
                >
                  {home.title}
                  {here && <span className="ml-1.5 text-vb-300">You are here</span>}
                </span>
              </Link>
            );
          })}
        </div>
        <p className="border-t border-ink-800/70 px-4 py-3 text-xs text-ink-600">
          Hover over a light to learn whose home it is.
        </p>
      </div>
    </section>
  );
}
