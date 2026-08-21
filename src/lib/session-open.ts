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
    // Nothing to talk through. The door is still open — the room and its
    // terminal work — but the keeper's side has no channel.
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
    transport,
  });
  if (!started.ok) return { ok: false, error: started.error };

  // One tap from the lock screen into the thread. `view` rather than a plain
  // click so it is a labelled button, and `ntfy://` because http links cannot
  // deep-link the Android app.
  const pointed = await publish(bell, {
    title: place.name,
    message: `${visitor} is waiting in the room. Tap to talk.`,
    tags: ["speech_balloon"],
    priority: 4,
    actions: [{ type: "view", label: "Open the room", url: deepLink(topic, visitor), clear: true }],
  });

  if (!pointed.ok) {
    await endSession(ring.id, "the keeper could not be shown the way in");
    return { ok: false, error: "The keeper could not be pointed at the room." };
  }

  return { ok: true };
}
