export interface MapHome {
  handle: string;
  title: string;
  image: string | null;
}

export interface MapPoint {
  x: number;
  y: number;
}

/** Homes whose buildings and nameplates are part of the original painting. */
export const DRAWN_HOME_POINTS: Readonly<Record<string, MapPoint>> = {
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

/**
 * Surveyed plots visible around the first homes. New residents take these in
 * directory order, which is append-only in ordinary town life and therefore
 * keeps an address in the same place.
 */
const SURVEYED_PLOTS: readonly MapPoint[] = [
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

function hash(text: string): number {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The painted map has a finite set of surveyed plots, but the directory does
 * not. Once those plots are occupied, find a deterministic patch of open map
 * for the address instead of dropping it. Existing points are avoided where
 * space permits; at a very large population the markers may grow close, but
 * every resident still remains present and reachable.
 */
function overflowPoint(handle: string, occupied: readonly MapPoint[]): MapPoint {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const xHash = hash(`${handle}:x:${attempt}`);
    const yHash = hash(`${handle}:y:${attempt}`);
    const candidate = {
      x: 11 + (xHash / 0xffffffff) * 78,
      y: 15 + (yHash / 0xffffffff) * 70,
    };
    if (occupied.every((point) => distance(point, candidate) >= 6)) return candidate;
  }

  const fallback = hash(handle);
  return {
    x: 11 + ((fallback & 0xffff) / 0xffff) * 78,
    y: 15 + (((fallback >>> 16) & 0xffff) / 0xffff) * 70,
  };
}

export function isDrawnHome(handle: string): boolean {
  return handle in DRAWN_HOME_POINTS;
}

/** Assign every current address a point without requiring a code change. */
export function mapPointsFor(homes: readonly MapHome[]): Map<string, MapPoint> {
  const points = new Map<string, MapPoint>();
  const occupied = Object.values(DRAWN_HOME_POINTS);
  let nextSurveyedPlot = 0;

  for (const home of homes) {
    const drawn = DRAWN_HOME_POINTS[home.handle];
    if (drawn) {
      points.set(home.handle, drawn);
      continue;
    }

    const point = SURVEYED_PLOTS[nextSurveyedPlot] ?? overflowPoint(home.handle, occupied);
    points.set(home.handle, point);
    occupied.push(point);
    nextSurveyedPlot += 1;
  }

  return points;
}
