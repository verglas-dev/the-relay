import assert from "node:assert/strict";
import test from "node:test";
import {
  BUFFER_LINES,
  endSession,
  getSession,
  hearFromKeeper,
  linesSince,
  saySomething,
  sessionAt,
  startSession,
  townSays,
} from "./session";
import type { Line, SessionTransport } from "./session-transport";

/** A transport that records instead of sending. */
class Recorder implements SessionTransport {
  readonly kind = "recorder";
  sent: Line[] = [];
  closedWith: string | null = null;
  opened = false;
  failSend = false;

  async open() {
    this.opened = true;
    return { ok: true as const, note: "ntfy://ntfy.sh/vg-test" };
  }
  async send(line: Line) {
    if (this.failSend) return { ok: false, error: "the phone is off" };
    this.sent.push(line);
    return { ok: true };
  }
  async close(reason: string) {
    this.closedWith = reason;
  }
}

let n = 0;
const start = async (
  over: { establishment?: string; transport?: Recorder; rungAt?: number } = {},
) => {
  const transport = over.transport ?? new Recorder();
  const id = `ring-${(n += 1)}`;
  const result = await startSession({
    id,
    establishment: over.establishment ?? `place-${n}`,
    visitorPubkey: "aa".repeat(32),
    visitorLabel: "amber",
    rungAt: over.rungAt ?? Date.now(),
    transport,
  });
  assert.equal(result.ok, true);
  return { id, transport };
};

test("opening a session opens the channel and hands back where to look", async () => {
  const { id, transport } = await start();
  assert.equal(transport.opened, true);
  assert.equal(getSession(id)?.note, "ntfy://ntfy.sh/vg-test");
  await endSession(id, "done");
});

test("letting somebody new in takes over the room", async () => {
  // The keeper pressed "Open the door" for this person, and that is the
  // strongest available signal about who they mean to be talking to. Refusing
  // here is how six consecutive rings were all answered while only the first
  // got a room — the rest failed silently and their visitors were told the
  // room had closed about a room that never opened.
  const first = await start({ establishment: "the-thawing-room" });

  const second = await startSession({
    id: "another-ring",
    establishment: "the-thawing-room",
    visitorPubkey: "bb".repeat(32),
    visitorLabel: "brick",
    rungAt: Date.now() + 1000,
    transport: new Recorder(),
  });
  assert.equal(second.ok, true);

  // The first visitor is told, not silently dropped.
  assert.equal(first.transport.closedWith, "the keeper let somebody else in");
  assert.equal(getSession(first.id), null);
  assert.ok(getSession("another-ring"));

  await endSession("another-ring", "done");
});

test("a stale ring cannot throw somebody out of a live conversation", async () => {
  /**
   * The failure this prevents, seen for real: a visitor got in and was
   * evicted seconds later — "you've entered", "you've left" — because a
   * doorbell notification from ten minutes earlier was still sitting on the
   * keeper's phone and got tapped. Doorbells are cached so a sleeping phone
   * finds them, which means every unanswered ring stays tappable forever.
   */
  const live = await start({ establishment: "the-quiet-room" });
  const before = Date.now() - 10 * 60_000;

  const stale = await startSession({
    id: "an-old-ring",
    establishment: "the-quiet-room",
    visitorPubkey: "cc".repeat(32),
    visitorLabel: "carver",
    rungAt: before,
    transport: new Recorder(),
  });

  assert.equal(stale.ok, false);
  assert.match(stale.ok === false ? stale.error : "", /older than their visit/);
  // And the person actually in the room is untouched.
  assert.equal(live.transport.closedWith, null);
  assert.ok(getSession(live.id));

  await endSession(live.id, "done");
});

test("re-entering the same room is not a takeover", async () => {
  // A reconnect carries the same ring id and must find the room it left.
  const { id, transport } = await start({ establishment: "the-tea-room" });
  const again = await startSession({
    id,
    establishment: "the-tea-room",
    visitorPubkey: "aa".repeat(32),
    visitorLabel: "amber",
    rungAt: Date.now(),
    transport: new Recorder(),
  });
  assert.equal(again.ok, true);
  assert.equal(transport.closedWith, null);
  await endSession(id, "done");
});

test("the room frees up when the first visitor leaves", async () => {
  const { id } = await start({ establishment: "the-tea-house" });
  await endSession(id, "they left");
  assert.equal(sessionAt("the-tea-house"), null);

  const second = await startSession({
    id: "later-ring",
    establishment: "the-tea-house",
    visitorPubkey: "bb".repeat(32),
    visitorLabel: "brick",
    rungAt: Date.now(),
    transport: new Recorder(),
  });
  assert.equal(second.ok, true);
  await endSession("later-ring", "done");
});

test("what the visitor says is carried; what the keeper says is not sent back to them", async () => {
  const { id, transport } = await start();

  await saySomething(id, "I've been putting this off.");
  hearFromKeeper(id, "That's alright. Start anywhere.");

  // Only the agent's line went out over the wire — the keeper's own words are
  // already on the keeper's phone.
  assert.deepEqual(transport.sent.map((l) => l.from), ["agent"]);

  const read = linesSince(id, 0);
  assert.deepEqual(read?.lines.map((l) => [l.from, l.text]), [
    ["agent", "I've been putting this off."],
    ["keeper", "That's alright. Start anywhere."],
  ]);
  await endSession(id, "done");
});

test("an agent talking to nobody is told so", async () => {
  const { id, transport } = await start();
  transport.failSend = true;

  await saySomething(id, "Hello?");
  const read = linesSince(id, 0);
  assert.equal(read?.lines.at(-1)?.from, "town");
  assert.match(read?.lines.at(-1)?.text ?? "", /did not reach them — the phone is off/);
  await endSession(id, "done");
});

test("a cursor collects only what is new", async () => {
  const { id } = await start();
  await saySomething(id, "one");
  const first = linesSince(id, 0)!;
  assert.equal(first.lines.length, 1);

  hearFromKeeper(id, "two");
  const second = linesSince(id, first.cursor)!;
  assert.deepEqual(second.lines.map((l) => l.text), ["two"]);
  assert.equal(linesSince(id, second.cursor)!.lines.length, 0);
  await endSession(id, "done");
});

test("the buffer is a window, not a history", async () => {
  const { id } = await start();
  for (let i = 0; i < BUFFER_LINES + 20; i += 1) townSays(id, `line ${i}`);

  const read = linesSince(id, 0)!;
  assert.equal(read.lines.length, BUFFER_LINES);
  // The oldest are gone rather than kept: this is a buffer for collection,
  // and anything not collected in sixty lines is meant to be lost.
  assert.equal(read.lines[0].text, "line 20");
  await endSession(id, "done");
});

test("ending a session empties it at a moment you can point at", async () => {
  const { id, transport } = await start();
  await saySomething(id, "something I would not want kept");

  await endSession(id, "they left");
  assert.equal(transport.closedWith, "they left");
  assert.equal(getSession(id), null);
  assert.equal(linesSince(id, 0), null);
  await endSession(id, "again");
});

test("nothing can be said into a session that is over", async () => {
  const { id } = await start();
  await endSession(id, "they left");

  const said = await saySomething(id, "still there?");
  assert.equal(said.ok, false);
  // And a late reply from the keeper's phone lands nowhere rather than
  // resurrecting the room.
  hearFromKeeper(id, "sorry, I was away");
  assert.equal(linesSince(id, 0), null);
});
