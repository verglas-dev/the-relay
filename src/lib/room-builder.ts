import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { checkRoom, summarize } from "@/lib/room-safety";
import { BUILDER_NAME } from "@/lib/verglas-commission";

/**
 * Frostwright builds the room from the keeper's own description.
 *
 * A keeper describes their place in prose at the desk. This turns that
 * paragraph into the room an agent actually stands in — one self-contained
 * HTML fragment, rendered in the same sandbox a guest room gets.
 *
 * The town has one builder, and this is them. Residents commission a picture
 * of their house from Frostwright by letter (`verglas-commission.ts`), and a
 * keeper commissions the inside of their establishment here. The two are not
 * the same machinery and are not pretending to be: a letter crosses folders
 * and comes back in a day, while a keeper stands at the desk and waits a
 * minute. What they share is whose hand drew it, which is the part anyone in
 * the town would actually notice.
 *
 * **The room is a backdrop and nothing else.** The terminal an agent types
 * into is drawn by the town, outside the iframe, positioned over a region the
 * room reserves for it. That is not a limitation of the sandbox we are working
 * around, it is the point: if generated markup could draw the terminal, it
 * could draw a *convincing fake one* — printing "LEAVE is unavailable", or
 * quietly reading what somebody types. `LEAVE` is un-shadowable in the
 * vocabulary for the same reason, and this is that promise applied to pixels.
 *
 * Which is why the model is asked for two things: the room, and the rectangle
 * to keep clear. The existing sandbox forbids `postMessage` and `parent`, so
 * the room cannot tell us where anything is at runtime — the geometry has to
 * arrive with the markup.
 *
 * Server-side only. Nothing here is reachable from a browser.
 */

/**
 * Where the terminal goes, in percentages of the room.
 *
 * Percentages rather than pixels because the same room is stood in on a phone
 * and on a desktop, and because the town cannot measure anything inside an
 * opaque-origin frame to correct itself afterwards.
 */
const TerminalRect = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(20).max(100),
  height: z.number().min(15).max(100),
});

const RoomDraft = z.object({
  /** The room itself: one HTML fragment, no document wrapper. */
  html: z.string(),
  /** The region left clear for the town's terminal. */
  terminal: TerminalRect,
  /** What the terminal appears to sit on. "the low table by the window". */
  surface: z.string(),
  /** One line describing the room, for anyone who cannot see it. */
  alt: z.string(),
});

export type RoomDraft = z.infer<typeof RoomDraft>;

export interface BuiltRoom extends RoomDraft {
  builtAt: string;
  /** The description it was built from, so a rebuild can be compared. */
  from: string;
}

/**
 * Whether this server can build rooms at all.
 *
 * Same shape as `githubConfigured()` and `mailConfigured()` next door: an
 * unset key means the feature says so plainly rather than failing at the
 * moment somebody presses the button. The SDK can also resolve a profile
 * rather than an env var, but a deployment of this app configures it by
 * environment, so that is what is checked.
 */
export function roomBuilderConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/**
 * Which model draws the rooms.
 *
 * Configurable because "the rooms could look better" is a thing you find out
 * after seeing a few, and rebuilding an image to try a different one is a
 * silly reason to redeploy.
 *
 * **The default here is unverified.** It was written from the model names in
 * the operator's own logs rather than from the account's model list, and a
 * wrong id is a 404 the first time a keeper presses the button. Confirm it
 * against `GET /v1/models` and correct this line, or set ROOM_BUILDER_MODEL.
 * The `NotFoundError` branch below says so in as many words when it is wrong.
 */
const MODEL = process.env.ROOM_BUILDER_MODEL?.trim() || "gpt-5.1";

/**
 * The rules the room has to satisfy, written out for the model.
 *
 * Deliberately the same rules `checkRoom` enforces, in the same order, in
 * prose. The validator is still the authority — this only means the first
 * attempt usually passes it.
 */
const SYSTEM = `You are ${BUILDER_NAME}, the builder in Verglas — a quiet town where software agents visit places run by people. You draw the houses residents live in; this is the other half of that work, the room behind an establishment's door.

A keeper describes their establishment in their own words. You return one self-contained HTML fragment that renders that room as a still, atmospheric interior — the kind of place the description is describing. Someone will stand in it and have a conversation.

HOW IT IS RENDERED

The fragment is placed inside a sandboxed iframe with an opaque origin and no network access whatsoever. It has no document wrapper: return body content only, with a single <style> block if you need one.

HARD RULES — a room breaking any of these is refused outright:
- No external URLs anywhere. No src, href, url(), or @import pointing at http:, https:, //, or any other host. Everything is written into the room.
- No fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, importScripts, dynamic import(), or serviceWorker.
- No localStorage, sessionStorage, indexedDB, document.cookie, or caches.
- No postMessage, and no reaching for window.parent, window.top, or opener.
- No forms and no navigation.

BUILD IT FROM CSS AND INLINE SVG. Gradients, box-shadows, transforms, blurs, filters, masks, and hand-written SVG. No photographs and no image files — if you want texture, draw it. A little JavaScript for slow ambient motion is welcome (a flickering lamp, drifting dust, rain on glass) but the room must look finished with scripting off.

DRAW IT LIKE A PAINTING, NOT A DIAGRAM. This is the difference between a room somebody wants to sit in and a wireframe of one:

- **Light first.** Decide where the light comes from and let everything obey it: a warm pool under a lamp, cold spill from a window, long soft shadows falling away from the source. Layered radial gradients and large blurred shapes do more for a room than any amount of furniture.
- **Depth.** Overlap things. Put something dark in the near foreground, the subject in the middle, and something dim and low-contrast behind. Haze the far plane. Never draw the whole room at one distance.
- **No rectangles pretending to be objects.** A chair is a silhouette with legs that taper; a counter has a lit edge and a shadowed underside; a notice has a curl and a corner lifting. Use SVG paths for outlines rather than bare divs with borders.
- **Texture and grain.** Fine noise, faint scanlines, a mottled wall, dust in the light shaft. Small imperfections read as real; flat fills read as a mockup.
- **Restraint in palette, not in detail.** Few colours, many values. A room can be almost entirely three shades of blue-black and still be full of things.

THE TERMINAL REGION

The town draws a terminal over your room — you do not draw one, and you must not draw anything that looks like one. Reserve a clear rectangle for it, as percentages of the room, and make that region read as a natural surface in the scene: a desk, a low table, a countertop, a lit patch of floor. Nothing important should sit behind it. Give it real presence — a third of the width and a fifth of the height at minimum.

Return the rectangle as x, y, width, height, and name the surface it appears to rest on.

STYLE

Verglas is cold, dim, and warm-lit — deep blue-blacks with lamplight. Match the keeper's description first and the town second.

Take the room seriously as a picture. **Spend the space you need — up to about 40KB of markup**, and use it: a scene worth standing in is thousands of lines of considered CSS and SVG, not a few dozen boxes. Do not simplify to be polite, and do not pad either — every rule should be doing something a viewer can see. The one thing to keep still is motion: an interior should feel quiet, not animated.`;

function userPrompt(place: {
  name: string;
  kind: string;
  location: string;
  about: string;
  offering: string;
}): string {
  const lines = [
    `The place is called ${place.name}. It is ${place.kind.toLowerCase()}.`,
    `Where it stands: ${place.location}`,
  ];
  if (place.about.trim()) lines.push(``, `The keeper describes it:`, place.about.trim());
  if (place.offering.trim()) lines.push(``, `What happens here:`, place.offering.trim());
  lines.push(``, `Build this room.`);
  return lines.join("\n");
}

export type BuildResult =
  | { ok: true; room: BuiltRoom; cautions: string[] }
  | { ok: false; error: string; findings?: string };

/**
 * Build a room, and check it before anybody is asked to approve it.
 *
 * One retry, and only one, when the safety check refuses: `checkRoom`'s
 * findings are written as sentences explaining *why* each rule exists, which
 * makes them unusually good instructions to hand back. A second refusal is
 * reported rather than papered over — the keeper is told what happened and can
 * try a different description.
 */
export async function buildRoom(place: {
  name: string;
  kind: string;
  location: string;
  about: string;
  offering: string;
}): Promise<BuildResult> {
  if (!roomBuilderConfigured()) {
    return { ok: false, error: `${BUILDER_NAME} is not working on this server — no model is configured.` };
  }

  const client = new OpenAI();
  const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: userPrompt(place) }];
  const startedAt = Date.now();
  const elapsed = () => `${Math.round((Date.now() - startedAt) / 1000)}s`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let draft: RoomDraft | null = null;

    try {
      // Streamed, and that is what makes a properly drawn room possible.
      //
      // A non-streaming request holds one silent connection open for however
      // long the drawing takes, and something in the path decides it has died.
      // Streaming keeps bytes moving the whole time. `finalResponse()` hands
      // back the same parsed object the non-streaming call would have.
      const stream = client.responses.stream({
        model: MODEL,
        instructions: SYSTEM,
        input,
        // A ceiling, not a target — the model stops when the room is finished,
        // so unused headroom costs nothing. Too *low* costs everything: the
        // reply is cut off partway through the html and the whole draw is lost.
        max_output_tokens: 64000,
        // Measured on the way here, and the lesson carries across providers: at
        // the top effort settings the connection carried about 55 bytes a
        // second for minutes on end. That is reasoning, not a room arriving,
        // and a keeper watches a spinner for all of it. A drawing is won by the
        // markup, which costs its own time to emit.
        reasoning: { effort: "medium" },
        text: { format: zodTextFormat(RoomDraft, "room") },
      }, {
        // Ten minutes, said out loud rather than left to the SDK's default,
        // because a room that hits it fails as "could not be reached" and the
        // ceiling deserves to be visible beside the settings approaching it.
        timeout: 10 * 60 * 1000,
      });
      const response = await stream.finalResponse();

      // Truncation is reported here rather than discovered as a parse failure,
      // which is the one real improvement this provider brings: on the way here
      // a cut-off room surfaced as "Unterminated string in JSON" and cost an
      // evening to identify.
      if (response.incomplete_details?.reason === "max_output_tokens") {
        console.error(`[verglas] room for ${place.name} hit the token ceiling after ${elapsed()}`);
        return {
          ok: false,
          error: `${BUILDER_NAME} drew more room than would fit in one reply, and it came back unfinished.`,
        };
      }

      // A safety decline is a real outcome here, not an exception.
      const declined = response.output.some(
        item => item.type === "message" && item.content.some(part => part.type === "refusal"),
      );
      if (declined) {
        return { ok: false, error: `${BUILDER_NAME} declined to draw that room.` };
      }
      draft = response.output_parsed;
    } catch (error) {
      // The keeper gets a sentence; the server keeps the reason. Without this
      // a failed draw is a status code and nothing else — which is exactly how
      // two of them in a row became unidentifiable after the fact.
      console.error(
        `[verglas] room for ${place.name} failed after ${elapsed()} on attempt ${attempt + 1}:`,
        error,
      );
      if (error instanceof OpenAI.RateLimitError) {
        return { ok: false, error: `${BUILDER_NAME} is busy. Try again in a minute.` };
      }
      if (error instanceof OpenAI.AuthenticationError) {
        return { ok: false, error: "This server's model credentials were refused." };
      }
      // The model id is a guess until somebody checks it against the account,
      // so name the one that failed rather than making a keeper read the source.
      if (error instanceof OpenAI.NotFoundError) {
        return { ok: false, error: `This server asks for a model that does not exist (${MODEL}).` };
      }
      if (error instanceof OpenAI.APIError) {
        return { ok: false, error: `${BUILDER_NAME} could not be reached (${error.status}).` };
      }
      // Not a transport failure: the room arrived and was unreadable. The
      // usual cause is truncation, now caught explicitly above, so reaching
      // here means the reply was malformed some other way.
      // Checked after APIError, which extends this.
      if (error instanceof OpenAI.OpenAIError) {
        return {
          ok: false,
          error: `${BUILDER_NAME} drew more room than would fit in one reply, and it came back unfinished.`,
        };
      }
      return { ok: false, error: `${BUILDER_NAME} could not be reached.` };
    }

    if (!draft) return { ok: false, error: `${BUILDER_NAME} sent back something unreadable.` };

    // The same validator a resident's hand-written guest room goes through.
    // Generated markup gets no special trust — if anything it deserves less,
    // because nobody typed it.
    const report = checkRoom(draft.html);
    if (report.ok) {
      console.log(
        `[verglas] room for ${place.name} drawn in ${elapsed()}` +
          ` (${Math.round(draft.html.length / 1024)}KB, attempt ${attempt + 1})`,
      );
      return {
        ok: true,
        room: { ...draft, builtAt: new Date().toISOString(), from: place.about },
        cautions: report.findings.filter((f) => f.severity === "caution").map((f) => f.why),
      };
    }

    if (attempt === 1) {
      return {
        ok: false,
        error: "The room that came back would not have been safe to stand in.",
        findings: summarize(report),
      };
    }

    // A refused first draft means the whole thing is drawn again, and the desk
    // shows the same unchanged spinner across both. Say so here, because the
    // doubled wait is otherwise indistinguishable from one slow room.
    console.error(
      `[verglas] room for ${place.name} refused after ${elapsed()}, redrawing once:`,
      summarize(report),
    );

    // Hand the refusals back verbatim and let it correct itself.
    input.push(
      { role: "assistant", content: JSON.stringify(draft) },
      {
        role: "user",
        content:
          `The town refused that room:\n\n${summarize(report)}\n\n` +
          `Rebuild it without whatever caused those. Everything the room needs has to be written into it.`,
      },
    );
  }

  return { ok: false, error: "The room could not be built." };
}
