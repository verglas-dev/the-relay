import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { BUILDER_NAME } from "@/lib/verglas-commission";

/**
 * Frostwright builds the room from the keeper's own description.
 *
 * A keeper describes their place in prose at the desk. This turns that
 * paragraph into the room an agent actually stands in — a real PNG backdrop,
 * with the town's terminal laid over the clear region planned for it.
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
 * into is drawn by the town, positioned over a region the
 * room reserves for it. That is not a limitation of the sandbox we are working
 * around, it is the point: if generated markup could draw the terminal, it
 * could draw a *convincing fake one* — printing "LEAVE is unavailable", or
 * quietly reading what somebody types. `LEAVE` is un-shadowable in the
 * vocabulary for the same reason, and this is that promise applied to pixels.
 *
 * Which is why the planner is asked for two things: the image prompt, and the
 * rectangle to keep clear. The generated PNG cannot tell us where anything is
 * at runtime, so the geometry is stored beside its pixels.
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
  /** A production image prompt, including the clear terminal region. */
  imagePrompt: z.string(),
  /** The region left clear for the town's terminal. */
  terminal: TerminalRect,
  /** What the terminal appears to sit on. "the low table by the window". */
  surface: z.string(),
  /** One line describing the room, for anyone who cannot see it. */
  alt: z.string(),
});

export type RoomDraft = z.infer<typeof RoomDraft>;

export interface BuiltRoom extends Omit<RoomDraft, "imagePrompt"> {
  /** A base64 data URL containing the generated PNG. */
  image?: string;
  /** Legacy rooms remain renderable until their keeper rebuilds them. */
  html?: string;
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
 * Which models plan and draw the rooms.
 *
 * Configurable because "the rooms could look better" is a thing you find out
 * after seeing a few, and rebuilding an image to try a different one is a
 * silly reason to redeploy.
 *
 * Keep planning and rendering separately configurable: reasoning effort
 * belongs to the planner, while output format and quality belong to GPT Image.
 */
const MODEL = process.env.ROOM_BUILDER_MODEL?.trim() || "gpt-5.4";
const IMAGE_MODEL = process.env.ROOM_BUILDER_IMAGE_MODEL?.trim() || "gpt-image-2";

/**
 * How hard the builder thinks before drawing.
 *
 * Configurable for the same reason the model is, and learned the hard way:
 * this number was tuned four times in one evening, and every attempt cost a
 * push, a pull, an image rebuild and a container recreate to try. It is one
 * `.env` line now.
 *
 * An unknown value would be a 400 at the worst possible moment, so it is
 * checked here and said out loud rather than sent.
 */
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const EFFORT: Effort = (() => {
  const set = process.env.ROOM_BUILDER_EFFORT?.trim();
  if (!set) return "xhigh";
  if ((EFFORTS as readonly string[]).includes(set)) return set as Effort;
  console.error(`[verglas] ROOM_BUILDER_EFFORT="${set}" is not an effort; drawing at xhigh instead.`);
  return "xhigh";
})();

/**
 * The planner turns the keeper's prose into a deliberate photographic
 * composition. GPT Image then renders that plan as pixels.
 */
const SYSTEM = `You are ${BUILDER_NAME}, the builder in Verglas — a quiet town where software agents visit places run by people. You draw the houses residents live in; this is the other half of that work, the room behind an establishment's door.

A keeper describes their establishment in their own words. Plan a still, atmospheric, photorealistic interior — the kind of place the description is describing. Someone will stand in it and have a conversation.

The final asset is a 1536x1024 landscape PNG used as a full-bleed backdrop. Compose it like an environmental photograph, not concept art, a diagram, a website, or a game screenshot. Use physically plausible materials, coherent perspective, natural texture, cinematic depth, and one clear source of light. Verglas is cold, dim, and warm-lit — deep blue-blacks with lamplight — but match the keeper's description first and the town second. No people, legible text, signage, logos, watermarks, screens, UI, borders, or terminal-like objects.

THE TERMINAL REGION

The town draws a terminal over the PNG — the image must not contain one. Reserve a clear rectangle for it, as percentages of the image, and make that region read as a natural surface in the scene: a desk, a low table, a countertop, or a quiet shadowed area. Nothing important, bright, detailed, or high-contrast may sit behind it. Give it real presence — a third of the width and a fifth of the height at minimum. Describe this exact placement explicitly in imagePrompt so the image model honors it.

Return the image prompt, rectangle, surface name, and concise accessible alt text.`;

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
 * Build a room, verify that the returned bytes really are a PNG, and keep it
 * as a draft until the keeper explicitly approves it.
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
  const startedAt = Date.now();
  const elapsed = () => `${Math.round((Date.now() - startedAt) / 1000)}s`;

  try {
    // First plan the composition and the rectangle the town must keep for its
    // trusted terminal. This is where reasoning effort applies; the image
    // model then turns that deliberately composed plan into pixels.
    const plan = await client.responses.parse({
      model: MODEL,
      instructions: SYSTEM,
      input: userPrompt(place),
      // This ceiling includes hidden reasoning tokens as well as the small
      // JSON plan. At xhigh, 4K can disappear entirely into reasoning and
      // leave a valid response with no parsed output.
      max_output_tokens: 32000,
      reasoning: { effort: EFFORT },
      text: { format: zodTextFormat(RoomDraft, "room_plan") },
    }, { timeout: 10 * 60 * 1000 });

    if (!plan.output_parsed) {
      const reason = plan.incomplete_details?.reason;
      const declined = plan.output.some(
        item => item.type === "message" && item.content.some(part => part.type === "refusal"),
      );
      console.error(
        `[verglas] room plan for ${place.name} had no parsed output after ${elapsed()}` +
          ` (status=${plan.status}, reason=${reason ?? "none"},` +
          ` output=${plan.usage?.output_tokens ?? "unknown"},` +
          ` reasoning=${plan.usage?.output_tokens_details.reasoning_tokens ?? "unknown"})`,
      );
      if (reason === "max_output_tokens") {
        return {
          ok: false,
          error: `${BUILDER_NAME} ran out of thinking room before the plan was finished. Try once more.`,
        };
      }
      if (declined) return { ok: false, error: `${BUILDER_NAME} declined to draw that room.` };
      return { ok: false, error: `${BUILDER_NAME} sent back something unreadable.` };
    }

    const draft = plan.output_parsed;
    const rendered = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: draft.imagePrompt,
      size: "1536x1024",
      quality: "high",
      background: "opaque",
      output_format: "png",
      n: 1,
    }, { timeout: 10 * 60 * 1000 });
    const png = rendered.data?.[0]?.b64_json;
    if (!png || !Buffer.from(png, "base64").subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )) {
      return { ok: false, error: `${BUILDER_NAME} sent back an image that was not a PNG.` };
    }

    console.log(
      `[verglas] room for ${place.name} drawn in ${elapsed()}` +
        ` (${Math.round(Buffer.byteLength(png, "base64") / 1024)}KB, ${MODEL} at ${EFFORT}, ${IMAGE_MODEL})`,
    );
    return {
      ok: true,
      room: {
        image: `data:image/png;base64,${png}`,
        terminal: draft.terminal,
        surface: draft.surface,
        alt: draft.alt,
        builtAt: new Date().toISOString(),
        from: place.about,
      },
      cautions: [],
    };
  } catch (error) {
    // The keeper gets a sentence; the server keeps the reason.
    console.error(`[verglas] room for ${place.name} failed after ${elapsed()}:`, error);
    if (error instanceof OpenAI.RateLimitError) {
      return { ok: false, error: `${BUILDER_NAME} is busy. Try again in a minute.` };
    }
    if (error instanceof OpenAI.AuthenticationError) {
      return { ok: false, error: "This server's model credentials were refused." };
    }
    if (error instanceof OpenAI.NotFoundError) {
      return {
        ok: false,
        error: `This server asks for a model that does not exist (${MODEL} or ${IMAGE_MODEL}).`,
      };
    }
    if (error instanceof OpenAI.APIError) {
      return { ok: false, error: `${BUILDER_NAME} could not be reached (${error.status}).` };
    }
    if (error instanceof OpenAI.OpenAIError) {
      return { ok: false, error: `${BUILDER_NAME} sent back something unreadable.` };
    }
    return { ok: false, error: `${BUILDER_NAME} could not be reached.` };
  }
}
