"use client";

import Link from "next/link";
import { isDrawnHome, mapPointsFor, type MapHome, type MapPoint } from "@/lib/verglas-map";

type Mode = "preview" | "explore" | "inside";

function PaintedHomeHotspot({
  home,
  point,
  current,
}: {
  home: MapHome;
  point: MapPoint;
  current?: string;
}) {
  const here = home.handle === current;

  return (
    <Link
      href={`/home/${home.handle}`}
      title={home.title}
      aria-label={`${home.title}${here ? ", where you stand" : ""}`}
      className="group absolute z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vb-200"
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
    >
      {/* A light cast over the paint, never another symbol laid on top of it. */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[50%] transition-opacity
          ${here
            ? "bg-vb-300/10 opacity-100 shadow-[0_0_18px_rgba(131,210,255,0.5)]"
            : "bg-[#ead7aa]/10 opacity-0 shadow-[0_0_14px_rgba(234,215,170,0.45)] group-hover:opacity-100 group-focus-visible:opacity-100"}`}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2
          whitespace-nowrap rounded-lg border border-ink-700/80 bg-ink-950/95 px-2.5 py-1.5
          text-xs font-medium text-ink-100 shadow-xl backdrop-blur-sm
          group-hover:block group-focus-visible:block"
      >
        {home.title}
        {here && <span className="ml-1.5 text-vb-300">You are here</span>}
      </span>
    </Link>
  );
}

/**
 * Interaction only. Every visible house and banner belongs to the painting;
 * this layer merely makes those painted buildings visitable.
 */
export function VerglasMapOverlay({
  homes,
  current,
  mode,
}: {
  homes: MapHome[];
  current?: string;
  mode: Mode;
}) {
  if (mode === "preview") return null;
  const points = mapPointsFor(homes);

  return (
    <div className="absolute inset-0 z-10">
      {homes.map((home) => {
        if (!isDrawnHome(home.handle)) return null;
        const point = points.get(home.handle);
        return point ? (
          <PaintedHomeHotspot
            key={home.handle}
            home={home}
            point={point}
            current={current}
          />
        ) : null;
      })}
    </div>
  );
}
