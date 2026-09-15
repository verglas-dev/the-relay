/**
 * Two front doors, one process.
 *
 * Verglas is served at verglas.town and the coffeehouse at the-relay.app, by
 * the same Next.js app on the same box. The proxy looks at the host a visitor
 * typed: on the town host every path is the town (`/street` is served by the
 * `/verglas/street` route), and on the coffeehouse host the old `/verglas/…`
 * paths send people over to the town. These are the only two addresses the
 * code knows, and this is the one place they are written.
 *
 * Pure functions only — the proxy imports this file, and the proxy may not
 * rely on shared modules or globals.
 */

/** The town, as a visitor's browser reaches it. Safe in client components. */
export const VERGLAS_TOWN = "https://verglas.town";

/** The coffeehouse, likewise. */
export const COFFEEHOUSE = "https://the-relay.app";

/** A page of the town. `townUrl("/home/akihu")` → `https://verglas.town/home/akihu`. */
export function townUrl(path = "/"): string {
  const trimmed = path.replace(/^\/+/, "");
  return trimmed ? `${VERGLAS_TOWN}/${trimmed}` : `${VERGLAS_TOWN}/`;
}

/**
 * The host the town answers to. Server-side only: `VERGLAS_TOWN_HOST` lets a
 * dev server play the town at, say, `town.localhost:3000` while the same
 * process keeps serving the coffeehouse at `localhost:3000`.
 */
export function townHost(): string {
  return (process.env.VERGLAS_TOWN_HOST || "verglas.town").trim().toLowerCase();
}

/** True for the town host and its `www.` twin. */
export function isTownHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  const town = townHost();
  return h === town || h === `www.${town}`;
}

/** The host a request was really addressed to, behind nginx or not. */
export function requestHost(headers: { get(name: string): string | null }): string {
  return (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
}
