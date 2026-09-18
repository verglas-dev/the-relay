"use client";

import Link from "next/link";
import { Home } from "lucide-react";
import { isDrawnHome, mapPointsFor, type MapHome, type MapPoint } from "@/lib/verglas-map";

type Mode = "preview" | "explore" | "inside";

interface HousePlan {
  left: number;
  right: number;
  peakX: number;
  peakY: number;
  eaveY: number;
  baseY: number;
  chimneyX: number;
  windows: number;
}

/** A stable little bit of architecture, so every new address gets its own silhouette. */
function housePlan(handle: string): HousePlan {
  let hash = 2166136261;
  for (const character of handle) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash >>>= 0;

  const left = 18 + (hash % 5);
  const right = 76 - ((hash >>> 3) % 5);
  return {
    left,
    right,
    peakX: 44 + ((hash >>> 6) % 9),
    peakY: 10 + ((hash >>> 10) % 6),
    eaveY: 34 + ((hash >>> 13) % 5),
    baseY: 66 + ((hash >>> 16) % 4),
    chimneyX: (hash >>> 19) % 2 === 0 ? left + 9 : right - 15,
    windows: 2 + ((hash >>> 21) % 2),
  };
}

function labelPosition(point: MapPoint): string {
  if (point.x < 25) return "left-0";
  if (point.x > 75) return "right-0";
  return "left-1/2 -translate-x-1/2";
}

/**
 * A new home is a building on the map, not a pin laid over it.
 *
 * The resident's house picture becomes the material of the facade when one
 * exists. Roof, timber, windows, chimney, ground shadow and the cool map glaze
 * give every source image the same visual grammar as the painted buildings.
 * A resident still waiting for a picture gets the same architecture with a
 * dark timber facade, rather than falling back to an app-style icon.
 */
function MapHouse({ home, here, mode }: { home: MapHome; here: boolean; mode: Mode }) {
  const plan = housePlan(home.handle);
  // The gate keeps its thumbnail mounted behind the open explorer, so the
  // mode belongs in every paint-server id. Duplicate SVG ids otherwise make
  // one map's clip path and gradients reach into the other map.
  const id = `map-house-${mode}-${home.handle}`;
  const facade = `M ${plan.left} ${plan.eaveY} L ${plan.peakX} ${plan.peakY} L ${plan.right} ${plan.eaveY} V ${plan.baseY} H ${plan.left} Z`;
  const roof = `M ${plan.left - 5} ${plan.eaveY + 1} L ${plan.peakX} ${plan.peakY - 3} L ${plan.right + 5} ${plan.eaveY + 1} L ${plan.right - 1} ${plan.eaveY + 5} L ${plan.peakX} ${plan.peakY + 5} L ${plan.left + 1} ${plan.eaveY + 5} Z`;
  const side = `M ${plan.right} ${plan.eaveY} L ${plan.right + 10} ${plan.eaveY - 5} V ${plan.baseY - 7} L ${plan.right} ${plan.baseY} Z`;
  const windowWidth = plan.windows === 2 ? 8 : 6;
  const windowGap = (plan.right - plan.left - 16 - plan.windows * windowWidth) / Math.max(1, plan.windows - 1);

  return (
    <span
      className={`block h-full w-full origin-bottom transition-transform duration-200
        group-hover:scale-110 group-focus-visible:scale-110
        ${here ? "drop-shadow-[0_0_7px_rgba(164,221,255,0.95)]" : "drop-shadow-[0_4px_3px_rgba(0,0,0,0.9)]"}`}
    >
      <svg viewBox="0 0 96 78" className="h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-facade`}>
            <path d={facade} />
          </clipPath>
          <linearGradient id={`${id}-walls`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#354048" />
            <stop offset="0.52" stopColor="#202a30" />
            <stop offset="1" stopColor="#11181d" />
          </linearGradient>
          <linearGradient id={`${id}-roof`} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#27343c" />
            <stop offset="0.58" stopColor="#141c22" />
            <stop offset="1" stopColor="#080e12" />
          </linearGradient>
          <linearGradient id={`${id}-night`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#07111a" stopOpacity="0.2" />
            <stop offset="1" stopColor="#061018" stopOpacity="0.64" />
          </linearGradient>
          <radialGradient id={`${id}-lamp`} cx="50%" cy="45%" r="65%">
            <stop offset="0" stopColor="#ffe9a7" />
            <stop offset="0.48" stopColor="#d99e45" />
            <stop offset="1" stopColor="#6c421e" />
          </radialGradient>
        </defs>

        {here && (
          <ellipse
            cx="49"
            cy="67"
            rx="35"
            ry="10"
            fill="#83d2ff"
            fillOpacity="0.18"
            stroke="#c9efff"
            strokeOpacity="0.75"
            strokeWidth="1.2"
          />
        )}
        <ellipse cx="49" cy="69" rx="36" ry="7" fill="#020507" fillOpacity="0.78" />

        <path
          d={`M ${plan.chimneyX} ${plan.peakY + 11} V ${plan.peakY + 2} H ${plan.chimneyX + 7} V ${plan.peakY + 14} Z`}
          fill="#182126"
          stroke="#9c7a49"
          strokeOpacity="0.62"
          strokeWidth="1"
        />
        <path d={side} fill="#0b1217" stroke="#9c7a49" strokeOpacity="0.55" strokeWidth="1" />
        <path d={facade} fill={`url(#${id}-walls)`} />

        {home.image && (
          <image
            href={home.image}
            x={plan.left}
            y={plan.peakY}
            width={plan.right - plan.left}
            height={plan.baseY - plan.peakY}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${id}-facade)`}
            opacity="0.88"
            style={{ filter: "saturate(.72) brightness(.72) contrast(1.2)" }}
          />
        )}

        <path d={facade} fill={`url(#${id}-night)`} />
        <path d={roof} fill={`url(#${id}-roof)`} fillOpacity="0.9" />
        <path
          d={roof}
          fill="none"
          stroke="#b08b50"
          strokeOpacity="0.78"
          strokeWidth="1.15"
          strokeLinejoin="round"
        />
        <path
          d={facade}
          fill="none"
          stroke="#aa8957"
          strokeOpacity="0.72"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* A few structural lines keep a photographic facade legible at map scale. */}
        <path
          d={`M ${plan.left + 2} ${plan.eaveY + 6} H ${plan.right - 2} M ${plan.peakX} ${plan.peakY + 5} V ${plan.eaveY}`}
          stroke="#11191e"
          strokeOpacity="0.78"
          strokeWidth="1.4"
        />

        {Array.from({ length: plan.windows }).map((_, index) => {
          const x = plan.left + 8 + index * (windowWidth + windowGap);
          return (
            <g key={x}>
              <rect
                x={x}
                y={plan.eaveY + 11}
                width={windowWidth}
                height="9"
                rx="0.7"
                fill={`url(#${id}-lamp)`}
                stroke="#2a1b0c"
                strokeWidth="1.2"
              />
              <path
                d={`M ${x + windowWidth / 2} ${plan.eaveY + 11} V ${plan.eaveY + 20}`}
                stroke="#5b3b1d"
                strokeWidth="0.75"
              />
            </g>
          );
        })}

        <rect
          x={plan.peakX - 4}
          y={plan.baseY - 15}
          width="8"
          height="15"
          rx="0.8"
          fill="#171516"
          stroke="#b18142"
          strokeOpacity="0.78"
          strokeWidth="1"
        />
        <circle cx={plan.peakX + 2} cy={plan.baseY - 7} r="0.8" fill="#f1c876" />

        {/* The uneven path and grass strokes settle the house into the painted ground. */}
        <path
          d={`M ${plan.peakX - 4} ${plan.baseY} L ${plan.peakX + 9} 75 H ${plan.peakX - 15} Z`}
          fill="#7b6646"
          fillOpacity="0.34"
        />
        <path
          d={`M ${plan.left - 5} 70 l 3 -7 m 1 7 l 4 -5 M ${plan.right + 4} 69 l -2 -7 m 5 7 l 2 -5`}
          fill="none"
          stroke="#667052"
          strokeOpacity="0.62"
          strokeWidth="1"
        />
      </svg>
    </span>
  );
}

function PaintedHomeHotspot({
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
  if (mode === "preview") return null;
  const here = home.handle === current;

  return (
    <Link
      href={`/home/${home.handle}`}
      title={home.title}
      aria-label={`${home.title}${here ? ", where you stand" : ""}`}
      className="group absolute z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vb-200"
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-1 rounded-full border transition-opacity
          ${here
            ? "border-vb-200/80 bg-vb-300/10 opacity-100 shadow-[0_0_16px_rgba(131,210,255,0.55)]"
            : "border-[#ead7aa]/55 bg-[#ead7aa]/5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}
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

function NewHome({
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
  const commonClass = `group absolute z-10 w-[4.75%] -translate-x-1/2 -translate-y-1/2
    [aspect-ratio:1.16] focus-visible:outline-none
    before:absolute before:-inset-3 before:content-['']`;
  const style = { left: `${point.x}%`, top: `${point.y}%` };

  if (mode === "preview") {
    return (
      <span className={`${commonClass} pointer-events-none`} style={style} aria-hidden="true">
        <MapHouse home={home} here={here} mode={mode} />
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
      <MapHouse home={home} here={here} mode={mode} />

      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-full mt-1.5 hidden max-w-40 items-center gap-1
          overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border bg-[#d6c092]/95 px-2 py-0.5
          font-display text-[10px] font-semibold leading-tight text-[#241b12] shadow-md sm:inline-flex
          ${here ? "border-[#dff5ff] ring-2 ring-vb-300/40" : "border-[#7b5b2c]"}
          ${labelPosition(point)}`}
      >
        <Home className="h-2.5 w-2.5 shrink-0" strokeWidth={2.4} />
        <span className="overflow-hidden text-ellipsis">{home.title}</span>
      </span>

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

      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-1 rounded-sm opacity-0 ring-2 ring-vb-200
          group-focus-visible:opacity-100"
      />
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
        if (!point) return null;

        return isDrawnHome(home.handle) ? (
          <PaintedHomeHotspot
            key={home.handle}
            home={home}
            point={point}
            current={current}
            mode={mode}
          />
        ) : (
          <NewHome
            key={home.handle}
            home={home}
            point={point}
            current={current}
            mode={mode}
          />
        );
      })}
    </div>
  );
}
