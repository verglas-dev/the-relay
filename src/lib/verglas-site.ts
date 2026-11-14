/**
 * Two front doors, one process.
 *
 * Verglas is served at verglas.town and the coffeehouse at the-relay.app, by
 * the same Next.js app on the same box. The proxy looks at the host a visitor
 * typed: on the town host every path is the town (`/street` is served by the
 * `/verglas/street` route), and on the coffeehouse host the old `/verglas/…`
 * paths and the town's rooms send people over to the town. These are the only
 * two addresses the code knows, and this is the one place they are written.
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

/** The anchor one letter answers to on a resident's desk. */
export function letterAnchor(letterId: string): string {
  return `letter-${letterId}`;
}

/** One letter on its resident's desk, opened and ready to answer. */
export function letterUrl(handle: string, letterId: string): string {
  return townUrl(`/home/${handle}/inside#${letterAnchor(letterId)}`);
}

/**
 * The town's rooms, which only exist at the town's address.
 *
 * The coffeehouse's address is the one most people know, so the rooms get typed
 * onto it, and `the-relay.app/street` used to be a 404 that read as the street
 * being gone. Nothing at the coffeehouse shares these names, and
 * `verglas-site.test.ts` fails if a new route on either site breaks that or goes
 * missing from this list.
 */
const TOWN_ROOMS = ["/e", "/home", "/irregular", "/keeper", "/mail", "/recovery", "/street", "/town-hall", "/why"];

/** True for a path inside one of those rooms, at any depth. */
export function isTownRoom(pathname: string): boolean {
  return TOWN_ROOMS.some((room) => pathname === room || pathname.startsWith(`${room}/`));
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

/**
 * Where a GitHub sign-in may bring someone back to: a page of this site, or
 * nowhere.
 *
 * Sign-in used to land everyone at the gate, so a resident who was halfway
 * through something lost it. The worst case was a letter already addressed to
 * someone. A page now names itself on the way out, and this decides whether
 * the name is safe to send a browser to. It must be a path on this origin,
 * never another site (`//elsewhere`, `/\\elsewhere`, a scheme), and never the
 * sign-in machinery itself.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value || value.length > 1024) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;

  const base = "https://return.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith("/api/")) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** The sign-in link for a page that wants to be returned to afterwards. */
export function signInUrl(returnTo?: string | null): string {
  const back = safeReturnPath(returnTo);
  return back ? `/api/verglas/auth?return=${encodeURIComponent(back)}` : "/api/verglas/auth";
}
