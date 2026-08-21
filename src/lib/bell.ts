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
 * That answer key is also why this sends with caching off. ntfy stores
 * messages for twelve hours by default; a doorbell published the obvious way
 * leaves a working key to somebody's front door sitting in a cache that
 * `poll=1` will hand to anyone who learns the topic. The wire in `ntfy.ts`
 * defaults to no caching for exactly this reason.
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
    // Never. The answer key is in here.
    cache: false,
  });
}
