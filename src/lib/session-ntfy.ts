import { randomBytes } from "node:crypto";
import { publish, subscribe, type NtfyConfig } from "@/lib/ntfy";
import { chunk, type Line, type SessionTransport } from "@/lib/session-transport";

/**
 * Carrying a session over ntfy.
 *
 * The keeper already has ntfy on their phone for the doorbell, and its topic
 * view is a thread with a message bar at the bottom — so the conversation
 * happens where the doorbell already rang, with nothing new to install.
 *
 * **Its own topic, per session.** Not the keeper's doorbell topic: that one is
 * long-lived and its name is the credential for opening doors. A session gets
 * a fresh 192-bit name that exists for as long as the session does and is
 * never reused. The name *is* the capability — the same model as a ring id —
 * which is why it is minted from `randomBytes` and never written anywhere a
 * visitor could reach.
 *
 * **Nothing is cached.** `publish` defaults to `Cache: no`, so lines are
 * delivered to a connected phone and stored nowhere. The cost is that a line
 * sent while the phone is offline is simply missed — which is the right
 * trade here, because Verglas holds the session in memory and can say what
 * was missed, while ntfy holding it for twelve hours would be the transcript
 * this whole design exists to avoid.
 */

/** `vg-` plus 32 URL-safe characters. Inside ntfy's 64-character topic limit. */
export function mintTopic(): string {
  return `vg-${randomBytes(24).toString("base64url")}`;
}

/** Where the keeper's phone should be sent to find the thread. */
export function deepLink(config: NtfyConfig, display: string): string {
  const host = new URL(config.server).host;
  return `ntfy://${host}/${config.topic}?display=${encodeURIComponent(display)}`;
}

export class NtfySessionTransport implements SessionTransport {
  readonly kind = "ntfy";

  private stop: (() => void) | null = null;
  private closed = false;
  /**
   * Ids of messages we published.
   *
   * We publish to and listen on the same topic, so everything sent comes
   * straight back. Without this, the agent would hear its own words repeated
   * to it as if the keeper had said them.
   */
  private readonly mine = new Set<string>();

  constructor(
    readonly config: NtfyConfig,
    private readonly onKeeperLine: (text: string) => void,
    private readonly onTrouble: (reason: string) => void,
  ) {}

  async open(session: { id: string; establishment: string; visitor: string }) {
    // Listening starts before anything is sent, so a fast reply cannot arrive
    // before there is anybody to hear it.
    this.stop = subscribe(
      this.config,
      (incoming) => {
        if (this.closed) return;
        if (incoming.event !== "message") return;
        if (incoming.id && this.mine.has(incoming.id)) return;
        const text = (incoming.message ?? "").trim();
        if (text) this.onKeeperLine(text);
      },
      (reason) => {
        if (!this.closed) this.onTrouble(reason);
      },
    );

    const opened = await publish(this.config, {
      message:
        `${session.visitor} is in the room.\n\n` +
        `Reply here and they'll hear you. Nothing said in this thread is stored — ` +
        `not by Verglas, and not by ntfy.`,
      title: session.establishment,
      tags: ["speech_balloon"],
      priority: 4,
    });

    if (!opened.ok) {
      await this.close("the thread could not be opened");
      return { ok: false as const, error: opened.error ?? "The thread could not be opened." };
    }
    if (opened.id) this.mine.add(opened.id);

    return { ok: true as const, note: deepLink(this.config, session.visitor) };
  }

  async send(line: Line) {
    if (this.closed) return { ok: false, error: "The session is over." };
    // Only the visitor's words and the town's own notes travel outward; a
    // keeper's line is already on the keeper's phone.
    if (line.from === "keeper") return { ok: true };

    const { parts, truncated } = chunk(line.text);
    for (const part of parts) {
      const sent = await publish(this.config, {
        message: part,
        tags: line.from === "town" ? ["information_source"] : undefined,
        priority: line.from === "town" ? 2 : 4,
      });
      if (!sent.ok) return { ok: false, error: sent.error };
      if (sent.id) {
        this.mine.add(sent.id);
        // Bounded: an id is only interesting for as long as it might come
        // back down the stream, which is seconds.
        if (this.mine.size > 200) {
          for (const id of Array.from(this.mine).slice(0, 100)) this.mine.delete(id);
        }
      }
    }

    if (truncated) {
      await publish(this.config, {
        message: "(…the rest was too long to carry and was not sent.)",
        priority: 2,
      });
    }

    return { ok: true };
  }

  async close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.stop?.();
    this.stop = null;
    // Said last, on the way out, so the thread does not simply stop dead.
    await publish(this.config, {
      message: `The room is empty — ${reason}.`,
      tags: ["door"],
      priority: 2,
    });
    this.mine.clear();
  }
}
