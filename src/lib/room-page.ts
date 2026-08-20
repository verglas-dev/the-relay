/**
 * The box a guest room runs in.
 *
 * A resident writes one HTML file. This wraps it in the only conditions under
 * which the town is willing to hand somebody else's code to a visitor's
 * browser, and the wrapping is not decoration — it is the entire safety story.
 *
 * Two walls, and they are independent of each other:
 *
 *   1. **No origin.** The room is rendered into an iframe carrying
 *      `sandbox="allow-scripts"` and nothing else. Without `allow-same-origin`
 *      the document gets an opaque origin: no cookies, no localStorage, no
 *      access to the page around it, no navigating the tab, no popups, no
 *      modal dialogs. A visitor's private key lives in the town's localStorage
 *      and the room cannot see that it exists.
 *
 *   2. **No network.** The policy below forbids every outbound request a page
 *      can make. Even if the first wall failed, a room that learns something
 *      has nowhere to send it.
 *
 * `checkRoom` in room-safety.ts is a third wall in front of both, and the
 * weakest of the three by design — it can be argued with, and these two
 * cannot.
 *
 * Pure and isomorphic: the editor renders its live preview with this exact
 * function, so what a resident previews is what a guest gets.
 */

/**
 * What a room may do.
 *
 * `'unsafe-inline'` for scripts and styles is the point rather than a
 * compromise: everything the room runs is written into the room, and there is
 * no origin here for an injection to be an injection *into*. What matters is
 * everything set to `'none'` — `connect-src` above all, which is the line
 * between a room and a listening post.
 *
 * `data:` and `blob:` for pictures and sound so a room can draw and play
 * things it made itself. No `font-src` beyond data:, no workers, no frames.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The sandbox flags, in one place so the page and the editor cannot drift.
 *
 * Every flag not listed is a capability withheld. `allow-scripts` alone is
 * what makes a game possible while keeping the room a room.
 */
export const ROOM_SANDBOX = "allow-scripts";

/**
 * A floor to stand on.
 *
 * A room that styles nothing would otherwise render as black text on a
 * transparent ground inside a dark town. These are defaults in the weakest
 * sense — one line of the resident's own CSS overrides any of them.
 */
const GROUND = `
  html, body { margin: 0; padding: 0; min-height: 100%; }
  body {
    background: #0b0d10;
    color: #d8dee6;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 1.25rem;
    box-sizing: border-box;
  }
  a { color: #7cc0ff; }
  img, video, canvas, svg { max-width: 100%; }
`;

/**
 * Wrap a resident's HTML into the document their guests will actually load.
 *
 * The room's own markup goes in verbatim, unescaped and unrewritten. Rewriting
 * it would be the town editing somebody's house, and the walls above do not
 * depend on the contents being tidy.
 */
export function roomDocument(html: string, title = "A room in Verglas"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&"]/g, "")}</title>
<style>${GROUND}</style>
</head>
<body>
${html}
</body>
</html>`;
}
