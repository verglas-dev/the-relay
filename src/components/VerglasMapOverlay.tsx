"use client";

import Link from "next/link";
import { Home } from "lucide-react";
import { isDrawnHome, mapPointsFor, type MapHome, type MapPoint } from "@/lib/verglas-map";

type Mode = "preview" | "explore" | "inside";

function labelPosition(point: MapPoint): string {
  if (point.x < 25) return "left-0";
  if (point.x > 75) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

function MarkerFace({ home, here, mode }: { home: MapHome; here: boolean; mode: Mode }) {
  const preview = mode === "preview";
  const waiting = !home.image;

  return (
    <span
      className={`relative flex items-center justify-center overflow-hidden rounded-full border shadow-lg
        transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110
        ${preview ? "h-5 w-5" : "h-9 w-9 sm:h-10 sm:w-10"}
        ${here
          ? "border-white bg-vb-500 ring-4 ring-vb-300/35 shadow-vb-300/70"
          : "border-[#ead7aa] bg-[#182028] shadow-black/80"}`}
    >
      {home.image ? (
        // eslint-disable-next-line @next/next/no-img-element -- resident-hosted image at the configured town repository
        <img src={home.image} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        <Home
          aria-hidden="true"
          className={`${preview ? "h-2.5 w-2.5" : "h-4 w-4"} ${waiting ? "text-[#e5c982]" : "text-white"}`}
        />
      )}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/15" />
    </span>
  );
}

function HomeMarker({
  home,
  point,
  current,
  mode,
}: {
  home: MapHome;
  point: MapPoint;
  current?: string;
  mode: Mode;
}) {
  const here = home.handle === current;
  const newlyPlotted = !isDrawnHome(home.handle);
  const commonClass = `group absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vb-200
    focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950`;
  const style = { left: `${point.x}%`, top: `${point.y}%` };

  if (mode === "preview") {
    return (
      <span className={`${commonClass} pointer-events-none`} style={style} aria-hidden="true">
        <MarkerFace home={home} here={here} mode={mode} />
      </span>
    );
  }

  return (
    <Link
      href={`/home/${home.handle}`}
      title={home.title}
      aria-label={`${home.title}${here ? ", where you stand" : ""}`}
      className={commonClass}
      style={style}
    >
      <MarkerFace home={home} here={here} mode={mode} />

      {/* The old homes already have parchment labels painted into the map.
          New arrivals need a visible name without waiting for another bitmap. */}
      {newlyPlotted && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-full mt-1.5 inline-block max-w-40 overflow-hidden
            text-ellipsis whitespace-nowrap rounded-sm
            border border-[#7b5b2c] bg-[#d6c092]/95 px-2 py-0.5 font-display text-[10px]
            font-semibold leading-tight text-[#241b12] shadow-md ${labelPosition(point)}`}
        >
          {home.title}
        </span>
      )}

      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2
          whitespace-nowrap rounded-lg border border-ink-700/80 bg-ink-950/95 px-2.5 py-1.5
          text-xs font-medium text-ink-100 shadow-xl backdrop-blur-sm
          group-hover:block group-focus-visible:block ${newlyPlotted ? "mb-8" : ""}`}
      >
        {home.title}
        {here && <span className="ml-1.5 text-vb-300">You are here</span>}
      </span>
    </Link>
  );
}

/** The data-driven layer shared by the gate map and every resident's map. */
export function VerglasMapOverlay({
  homes,
  current,
  mode,
}: {
  homes: MapHome[];
  current?: string;
  mode: Mode;
}) {
  const points = mapPointsFor(homes);

  return (
    <div className="absolute inset-0 z-10">
      {homes.map((home) => {
        const point = points.get(home.handle);
        return point ? (
          <HomeMarker
            key={home.handle}
            home={home}
            point={point}
            current={current}
            mode={mode}
          />
        ) : null;
      })}
    </div>
  );
}
