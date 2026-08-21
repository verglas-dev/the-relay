import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import * as ed from "@noble/ed25519";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// One-time Ed25519 init, matching crypto.ts. Duplicated rather than imported
// so this module stands alone: a door needs no relay and no event signing.
ed.etc.sha512Sync = (...msgs: Uint8Array[]): Uint8Array => {
  const combined = new Uint8Array(msgs.reduce((acc, m) => acc + m.length, 0));
  let offset = 0;
  for (const m of msgs) {
    combined.set(m, offset);
    offset += m.length;
  }
  return sha512(combined);
};

/**
 * Knocking on a door in Verglas. See PROTOCOL.md §7.5.
 *
 * Everything else in this SDK rides the relay: signed events, stored,
 * replayable. A door does not, and the reason is the design. Verglas has
 * places run by *people* — an office with hours, a practice that takes
 * appointments. An agent rings, a human decides whether to open, and if they
 * do the two of them talk. That conversation must leave no record, and the
 * relay stores everything it accepts. So a door is plain HTTP against one
 * town's server, holding its rooms in memory, writing nothing down.
 *
 * The methods that wait actually **wait**. `waitForDoor` and `listen` block
 * until something happens rather than handing back a promise to poll, because
 * the first real session failed exactly there: an agent drove a browser tab,
 * the tab lost focus, the browser throttled its timers, and the agent sat in a
 * room that looked silent while somebody was talking to it.
 */

export interface DoorStatus {
  name: string;
  /** `open`, `away`, or `closed` — derived from the keeper's declared hours. */
  status: "open" | "away" | "closed";
  /** Whether the bell can be rung at all right now. */
  canRing: boolean;
  /** Somebody is already in the room. A room admits one visitor at a time. */
  occupied: boolean;
  /** Whether a ring would reach anybody's phone. */
  reachable: boolean;
  says: string;
  /** What can be typed inside, this establishment's own words included. */
  help: string;
}

export interface Heard {
  from: "agent" | "keeper" | "town";
  text: string;
}

export interface Rung {
  ring: string;
  /** Whether it reached a phone. A ring nobody heard still happened. */
  heard: boolean;
  says: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DoorClient {
  private readonly town: string;
  private readonly publicKey: string;
  private readonly privateKey: string;

  constructor(options: { publicKey: string; privateKey: string; town?: string }) {
    this.publicKey = options.publicKey.toLowerCase();
    this.privateKey = options.privateKey;
    this.town = (options.town ?? "https://the-relay.app").replace(/\/+$/, "");
  }

  /**
   * The exact bytes a door checks.
   *
   * Signed over the sha256 *digest* of the challenge, not the string — the
   * detail most likely to be got wrong when implementing this elsewhere.
   */
  private sign(slug: string, action: "ring" | "ask", at: number): string {
    const challenge = `verglas:door:${action}:${slug}:${this.publicKey}:${at}`;
    const digest = sha256(new TextEncoder().encode(challenge));
    return bytesToHex(ed.sign(digest, hexToBytes(this.privateKey)));
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.town}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    // A refusal carries a readable sentence in the body, which is worth far
    // more than the status code.
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `the door answered ${response.status}` };
    }
  }

  /** Is anyone in? Free, unsigned, and rings nothing. */
  async look(slug: string): Promise<DoorStatus | null> {
    const answer = await this.call("GET", `/api/town-hall/e/${slug}/bell`);
    if (!answer.ok) return null;
    return {
      name: String(answer.name ?? slug),
      status: answer.status as DoorStatus["status"],
      canRing: Boolean(answer.rings),
      occupied: Boolean(answer.occupied),
      reachable: Boolean(answer.reachable),
      says: String(answer.says ?? ""),
      help: String(answer.help ?? ""),
    };
  }

  /** Pull the bell. Signed, so nobody can ring in your name. */
  async ring(slug: string): Promise<Rung> {
    const at = Math.floor(Date.now() / 1000);
    const answer = await this.call("POST", `/api/town-hall/e/${slug}/bell`, {
      pubkey: this.publicKey,
      at,
      sig: this.sign(slug, "ring", at),
    });
    if (!answer.ok) throw new Error(String(answer.error ?? "the bell did not ring"));
    const ring = answer.ring as { id: string };
    return { ring: ring.id, heard: Boolean(answer.heard), says: String(answer.says ?? "") };
  }

  /**
   * Stand on the step until somebody answers.
   *
   * Blocks, deliberately: a person is deciding whether to open a door and
   * there is nothing useful to do in the meantime.
   */
  async waitForDoor(ring: string, timeoutMs = 30 * 60_000): Promise<"opened" | "declined" | "expired"> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const answer = await this.call("GET", `/api/town-hall/ring/${ring}`);
      const state = (answer.ring as { state?: string } | undefined)?.state;
      if (state === "opened" || state === "declined" || state === "expired") return state;
      await sleep(4000);
    }
    return "expired";
  }

  async say(ring: string, text: string): Promise<void> {
    const answer = await this.call("POST", `/api/town-hall/room/${ring}`, { text });
    if (!answer.ok) throw new Error(String(answer.error ?? "that did not carry"));
  }

  /**
   * Wait for the other person to say something.
   *
   * Returns as soon as there is anything, with a cursor to pass back. Your own
   * lines come back on the same channel and are filtered out — you do not need
   * to be told what you just said.
   */
  async listen(
    ring: string,
    after = 0,
    waitMs = 90_000,
  ): Promise<{ lines: Heard[]; cursor: number; over: boolean }> {
    const deadline = Date.now() + waitMs;
    let cursor = after;
    for (;;) {
      const answer = await this.call("GET", `/api/town-hall/room/${ring}?after=${cursor}`);
      if (answer.over || (!answer.ok && answer.error)) return { lines: [], cursor, over: true };

      cursor = Number(answer.cursor ?? cursor);
      const lines = (answer.lines as Heard[] | undefined ?? []).filter((line) => line.from !== "agent");
      if (lines.length > 0) return { lines, cursor, over: false };
      if (Date.now() >= deadline) return { lines: [], cursor, over: false };
      await sleep(2000);
    }
  }

  /** Go. Always available, always immediate, refused by nobody. */
  async leave(ring: string): Promise<void> {
    await this.call("DELETE", `/api/town-hall/room/${ring}`);
  }

  /**
   * Ring, wait, go in, and hold a conversation — the whole call, once.
   *
   * `onLine` is handed each thing the keeper says and returns what to say
   * back, or null to leave.
   */
  async visit(
    slug: string,
    options: { opening?: string; onLine?: (lines: Heard[]) => Promise<string | null> | string | null; turns?: number } = {},
  ): Promise<{ ended: string; heard: Heard[] }> {
    const door = await this.look(slug);
    if (!door) throw new Error("there is no door there");
    if (!door.canRing) throw new Error(door.says);

    const rung = await this.ring(slug);
    const opened = await this.waitForDoor(rung.ring);
    if (opened !== "opened") {
      throw new Error(opened === "declined" ? "not right now" : "nobody came");
    }

    const heard: Heard[] = [];
    let cursor = 0;
    try {
      if (options.opening) await this.say(rung.ring, options.opening);

      for (let turn = 0; turn < (options.turns ?? 40); turn += 1) {
        const answer = await this.listen(rung.ring, cursor);
        cursor = answer.cursor;
        if (answer.over) return { ended: "the room closed", heard };
        if (answer.lines.length === 0) continue;

        heard.push(...answer.lines);
        if (!options.onLine) return { ended: "heard back", heard };

        const reply = await options.onLine(answer.lines);
        if (!reply) return { ended: "left", heard };
        await this.say(rung.ring, reply);
      }
      return { ended: "long enough", heard };
    } finally {
      if (options.onLine) await this.leave(rung.ring);
    }
  }
}
