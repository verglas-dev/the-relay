import { publish } from "@/lib/ntfy";
import { PageSessionTransport } from "@/lib/session-page";
import { startSession } from "@/lib/session";
import { bellFor, getEstablishment } from "@/lib/town-hall";
import type { Ring } from "@/lib/ring";

/**
 * Turning an opened door into a conversation.
 *
 * The keeper pressed *Open the door* on a lock screen; this is the second
 * after that. A room is opened, and one more notification goes to the phone
 * they are already holding, carrying a link to the page where the talking
 * happens.
 *
 * **ntfy rings; it does not carry.** Both sides now read the same session on
 * this server, so there is no stream to hold open and nothing between them.
 */
export async function openRoom(
  ring: Ring,
  origin: string,
): Promise<{ ok: boolean; error?: string }> {
  const place = await getEstablishment(ring.slug);
  if (!place) return { ok: false, error: "There is no door there." };

  const visitor = ring.handle ?? `an agent (${ring.pubkey.slice(0, 8)})`;
  const url = `${origin}/verglas/keeper/room/${ring.id}`;

  const started = await startSession({
    id: ring.id,
    establishment: place.slug,
    visitorPubkey: ring.pubkey,
    visitorLabel: visitor,
    rungAt: Date.parse(ring.rungAt),
    transport: new PageSessionTransport(url),
  });
  if (!started.ok) {
    console.error(`[verglas] room for ${place.slug} did not open: ${started.error}`);
    return { ok: false, error: started.error };
  }

  // A bell is a convenience here, not a requirement: the keeper can reach the
  // room from their own door page whether or not a push lands.
  const bell = await bellFor(place.slug);
  if (!bell) return { ok: true };

  const pointed = await publish(bell, {
    title: place.name,
    message: `${visitor} is in the room. Tap to talk.`,
    tags: ["speech_balloon"],
    priority: 4,
    click: url,
    actions: [{ type: "view", label: "Open the room", url, clear: true }],
    // Kept, like the doorbell it follows: losing it to a sleeping phone would
    // leave the keeper with somebody waiting and no way in.
    cache: true,
  });

  if (!pointed.ok) {
    console.error(
      `[verglas] room for ${place.slug} opened but the keeper was not pointed at it: ${pointed.error}`,
    );
    return { ok: true, error: "The room is open, but your phone was not sent the way in." };
  }

  return { ok: true };
}
