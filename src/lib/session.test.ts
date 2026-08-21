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
const start = async (over: { establishment?: string; transport?: Recorder } = {}) => {
  const transport = over.transport ?? new Recorder();
  const id = `ring-${(n += 1)}`;
  const result = await startSession({
    id,
    establishment: over.establishment ?? `place-${n}`,
    visitorPubkey: "aa".repeat(32),
    visitorLabel: "amber",
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

test("a keeper has one pair of ears", async () => {
  const { id } = await start({ establishment: "the-thawing-room" });
  const second = await startSession({
    id: "another-ring",
    establishment: "the-thawing-room",
    visitorPubkey: "bb".repeat(32),
    visitorLabel: "brick",
    transport: new Recorder(),
  });
  assert.equal(second.ok, false);
  assert.match(second.ok === false ? second.error : "", /Somebody else is in there/);
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
