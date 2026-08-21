import { DEFAULT_NTFY_SERVER, publish } from "@/lib/ntfy";
import { NtfySessionTransport, deepLink, mintTopic } from "@/lib/session-ntfy";
import { endSession, hearFromKeeper, startSession, townSays } from "@/lib/session";
import { bellFor, getEstablishment } from "@/lib/town-hall";
import type { Ring } from "@/lib/ring";

/**
 * Turning an opened door into a conversation.
 *
 * The keeper pressed *Open the door* on a lock screen; this is what happens in
 * the second after that. A fresh topic is minted, the town starts listening on
 * it, and the keeper gets one more notification — on their doorbell topic,
 * where they already are — carrying a link that opens the ntfy app straight
 * into the new thread and subscribes them to it.
 *
 * The doorbell topic is the root credential here: whoever holds it can already
 * open doors, so sending a session topic through it grants nothing new.
 */
export async function openRoom(ring: Ring): Promise<{ ok: boolean; error?: string }> {
  const place = await getEstablishment(ring.slug);
  if (!place) return { ok: false, error: "There is no door there." };

  const bell = await bellFor(ring.slug);
  if (!bell) {
    console.error(`[verglas] room for ${place.slug} cannot open: no bell wired`);
    return { ok: false, error: "This door has no bell wired up." };
  }

  const visitor = ring.handle ?? `an agent (${ring.pubkey.slice(0, 8)})`;
  const topic = { server: bell.server || DEFAULT_NTFY_SERVER, topic: mintTopic(), token: bell.token };

  const transport = new NtfySessionTransport(
    topic,
    (text) => hearFromKeeper(ring.id, text),
    (reason) => {
      townSays(ring.id, `The keeper's side dropped — ${reason}.`);
    },
  );

  const started = await startSession({
    id: ring.id,
    establishment: place.slug,
    visitorPubkey: ring.pubkey,
    visitorLabel: visitor,
    rungAt: Date.parse(ring.rungAt),
    transport,
  });
  if (!started.ok) {
    // Logged, not just returned. This failure is invisible from both sides —
    // the door still opens, and the agent walks in to an empty registry and is
    // told "the room has closed", which is not what happened.
    console.error(`[verglas] room for ${place.slug} did not open: ${started.error}`);
    return { ok: false, error: started.error };
  }

  // One tap from the lock screen into the thread. `view` rather than a plain
  // click so it is a labelled button, and `ntfy://` because http links cannot
  // deep-link the Android app.
  const pointed = await publish(bell, {
    title: place.name,
    message: `${visitor} is waiting in the room. Tap to talk.`,
    tags: ["speech_balloon"],
    priority: 4,
    actions: [{ type: "view", label: "Open the room", url: deepLink(topic, visitor), clear: true }],
    // Kept, like the doorbell it follows. This is the way *in* — losing it to a
    // sleeping phone leaves the keeper with an agent waiting and no door. The
    // session topic it names is abandoned when the session ends, so a copy
    // outliving the conversation opens nothing.
    cache: true,
  });

  if (!pointed.ok) {
    console.error(
      `[verglas] room for ${place.slug} opened but the keeper could not be pointed at it: ${pointed.error}`,
    );
    // Deliberately *not* torn down any more. The room works — an agent is in
    // it and the keeper's replies would reach them — so destroying it because
    // one notification did not land is throwing away the whole conversation
    // over a signpost. The keeper can still reach it from their own door page.
    return { ok: true, error: "The room is open, but your phone was not sent the way in." };
  }

  return { ok: true };
}
