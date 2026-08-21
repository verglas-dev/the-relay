/**
 * The doorbell.
 *
 * ntfy rather than web push, and the difference is not small: web push would
 * mean VAPID keys, a service worker, and a subscription object per device that
 * expires quietly and takes the notification with it. ntfy is an HTTP POST to
 * a topic the keeper is already subscribed to on their phone. It self-hosts,
 * and — the part that decides it — its notifications carry **action buttons**,
 * so *Open the door* and *Not now* are two taps on a lock screen rather than a
 * website the keeper has to go and find.
 *
 * **A topic name is a credential.** Anyone who knows it can read every
 * notification sent to it, publish their own, and — because the ring's answer
 * key travels inside the notification — open the door. So it is stored
 * server-side, never rendered, never returned by any endpoint, never logged.
 *
 * **The doorbell is cached; the conversation is not.** These look like the same
 * decision and are not.
 *
 * `Cache: no` means ntfy delivers to a *connected* subscriber and never
 * redelivers. For the session that is exactly right: the words are gone and
 * the town still holds them for a moment. For a doorbell it is fatal — a phone
 * that was asleep, or subscribed to the topic a minute later, simply never
 * hears it, and a doorbell that only works if you are already holding the
 * phone is not a doorbell. That happened on the first real ring.
 *
 * The reason for switching it off was that the ring's answer key rides inside
 * the notification, and a cache holds it for twelve hours. But **a ring expires
 * after thirty minutes** (`RING_TTL_MINUTES`), and `answerRing` refuses an
 * expired one — so the key is worthless long before the cache lets it go. The
 * exposure was never twelve hours; it was the ring's own lifetime, and that is
 * true whether the message is cached or read live off the wire by anybody
 * already subscribed.
 *
 * So: cached, and reliable.
 *
 * **A topic name is still a credential.** Anyone who knows it can read every
 * notification sent to it, publish their own, and answer a ring that is still
 * open. It is stored server-side, never rendered, never returned by any
 * endpoint, never logged.
 *
 * Server-side only.
 */

import {
  DEFAULT_NTFY_SERVER,
  checkServer,
  isTopic,
  publish,
  type NtfyAction,
  type NtfyConfig,
  type NtfyResult,
} from "@/lib/ntfy";

/** The doorbell's wiring is just an ntfy destination. */
export type BellConfig = NtfyConfig;

export { DEFAULT_NTFY_SERVER, checkServer, isTopic };
export type BellResult = NtfyResult;
export type BellAction = NtfyAction;

export function checkBell(config: Partial<BellConfig>): string | null {
  if (!isTopic(config.topic ?? "")) {
    return "An ntfy topic is letters, numbers, underscores and hyphens.";
  }
  return checkServer(config.server?.trim() || DEFAULT_NTFY_SERVER);
}

export interface BellMessage {
  title: string;
  message: string;
  tags?: string[];
  /** 1 (min) to 5 (max). A doorbell is a 4. */
  priority?: number;
  click?: string;
  actions?: BellAction[];
}

/**
 * Ring it.
 *
 * Reports honestly rather than throwing: a ring that could not be delivered
 * still happened, the agent still rang, and the record of it is what the
 * keeper sees when they next open the page. A doorbell nobody heard is not the
 * same as a doorbell nobody pressed, and the caller needs to say which.
 */
export async function ring(config: BellConfig | null, message: BellMessage): Promise<BellResult> {
  return publish(config, {
    message: message.message,
    title: message.title,
    tags: message.tags ?? ["bell"],
    priority: message.priority ?? 4,
    click: message.click,
    actions: message.actions,
    // Kept, so a phone that was asleep still finds it. See the note above on
    // why the answer key inside does not make this a leak.
    cache: true,
  });
}
