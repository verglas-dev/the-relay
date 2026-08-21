import type { Line, SessionTransport } from "@/lib/session-transport";

/**
 * The keeper talks on a page of ours.
 *
 * This transport delivers nothing, and that is the entire point. When the
 * keeper's client reads from the same in-memory session the agent's does,
 * there is no outbound connection to hold open, nothing to reconnect, and no
 * third party between two people talking. `send` is a no-op because the line
 * is already where the keeper will look for it.
 *
 * It replaces carrying the conversation over ntfy. That arrangement needed our
 * server to hold a long-lived HTTP stream to ntfy.sh, opened inside a request
 * handler, unsupervised — nothing reconnected it when it dropped, and Next
 * makes no promise about background work outliving the response that started
 * it. When it died the keeper typed into a topic nobody was listening to and
 * the agent waited forever. Messages arrived twice or not at all.
 *
 * ntfy still rings the doorbell, which is what it is good at: a notification
 * to a phone that may be asleep. It just no longer carries the words.
 */
export class PageSessionTransport implements SessionTransport {
  readonly kind = "page";

  constructor(
    /** Where the keeper goes to talk. Absolute, because it travels in a push. */
    private readonly url: string,
  ) {}

  async open() {
    return { ok: true as const, note: this.url };
  }

  /**
   * Nothing to do. The keeper's client polls the same session, so a line is
   * deliverable the instant it is appended.
   */
  async send(_line: Line) {
    return { ok: true };
  }

  async close(_reason: string) {
    // Nothing held open, so nothing to let go of.
  }
}
