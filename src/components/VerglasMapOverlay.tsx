"use client";

import Image from "next/image";
import Link from "next/link";
import {
  hasMapArtwork,
  MAP_HEIGHT,
  MAP_WIDTH,
  mapPointsFor,
  type MapHome,
  type MapPatch,
  type MapPoint,
} from "@/lib/verglas-map";

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
      className="pointer-events-auto group absolute z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2
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

function PaintedPatch({ patch }: { patch: MapPatch }) {
  return (
    <Image
      src={patch.url}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={patch.crop.width}
      height={patch.crop.height}
      unoptimized
      className="pointer-events-none absolute max-w-none"
      style={{
        left: `${(patch.crop.left / MAP_WIDTH) * 100}%`,
        top: `${(patch.crop.top / MAP_HEIGHT) * 100}%`,
        width: `${(patch.crop.width / MAP_WIDTH) * 100}%`,
        height: `${(patch.crop.height / MAP_HEIGHT) * 100}%`,
      }}
    />
  );
}

/** One exact banner for every generated house; Frostwright never has to spell. */
function TownBanner({ patch }: { patch: MapPatch }) {
  const title = patch.title.trim() || patch.handle;
  const width = Math.min(19, Math.max(8.5, 5.4 + title.length * 0.32));
  const left = Math.max(width / 2 + 0.8, Math.min(99.2 - width / 2, patch.point.x));
  const fontSize = Math.max(10, Math.min(22, 205 / Math.max(7, title.length * 0.58)));

  return (
    <svg
      viewBox="0 0 240 58"
      aria-hidden="true"
      className="pointer-events-none absolute overflow-visible drop-shadow-[0_2px_2px_rgba(29,24,20,0.55)]"
      style={{
        left: `${left}%`,
        top: `${Math.max(5, patch.point.y - 7)}%`,
        width: `${width}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      <path
        d="M11 2H229L238 29L229 56H11L2 29Z"
        fill="#d8c596"
        stroke="#352d25"
        strokeWidth="3.4"
        strokeLinejoin="miter"
      />
      <path
        d="M14 7H225L232 29L225 51H14L8 29Z"
        fill="none"
        stroke="#7c6848"
        strokeWidth="1.3"
      />
      <path d="M18 31V25L30 15L42 25V43H33V32H27V43H18Z" fill="#332b23" />
      <path d="M15 27L30 12L45 27" fill="none" stroke="#332b23" strokeWidth="3.5" />
      <text
        x="139"
        y="36"
        textAnchor="middle"
        fill="#30281f"
        fontFamily="Fraunces, Georgia, serif"
        fontSize={fontSize}
        fontWeight="550"
        letterSpacing="0.15"
      >
        {title}
      </text>
    </svg>
  );
}

/** The immutable painting, durable house patches, canonical banners, and links meet here. */
export function VerglasMapOverlay({
  homes,
  patches,
  current,
  mode,
}: {
  homes: MapHome[];
  patches: MapPatch[];
  current?: string;
  mode: Mode;
}) {
  const points = mapPointsFor(homes);
  for (const patch of patches) points.set(patch.handle, patch.point);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-0">
        {patches.map((patch) => <PaintedPatch key={patch.handle} patch={patch} />)}
        {patches.map((patch) => <TownBanner key={patch.handle} patch={patch} />)}
      </div>
      {mode !== "preview" && (
        <div className="absolute inset-0">
          {homes.map((home) => {
            if (!hasMapArtwork(home.handle, patches)) return null;
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
      )}
    </div>
  );
}
