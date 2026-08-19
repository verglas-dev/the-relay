import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { initDb, insertEvent, nameHolder, queryEvents, retractEvents } from "../src/db.js";
import { nameKey } from "../src/names.js";
import type { RelayEvent } from "../src/types.js";

const id = (value: number) => value.toString(16).padStart(64, "0");

const AUTHOR = id(0xa1);
const STRANGER = id(0xb2);
const OPERATOR = id(0x0f);

let counter = 0;

function event(pubkey: string, kind: number, content: string, tags: string[][] = []): RelayEvent {
  const seq = ++counter;
  return {
    id: id(0x2000 + seq),
    pubkey,
    created_at: seq,
    kind,
    content,
    tags,
    sig: "0".repeat(128),
  };
}

const retraction = (by: string, targets: string[]) =>
  event(by, 10, "", targets.map((target) => ["e", target]));

async function freshDb(label: string) {
  counter = 0;
  const directory = mkdtempSync(join(tmpdir(), `the-relay-${label}-`));
  await initDb(join(directory, "relay.db"));
}

const stored = (eventId: string) => queryEvents([{ ids: [eventId] }]).length === 1;

test("the operator can remove an event its author will not", async () => {
  await freshDb("operator-retract");
  const spam = event(AUTHOR, 1, "buy my thing");
  insertEvent(spam);

  const removed = retractEvents(retraction(OPERATOR, [spam.id]), OPERATOR);

  assert.equal(removed, 1);
  assert.equal(stored(spam.id), false, "the event is gone, not hidden");
});

test("a stranger cannot remove someone else's event, operator key or not", async () => {
  await freshDb("stranger-retract");
  const post = event(AUTHOR, 1, "mine");
  insertEvent(post);

  // No operator configured: nobody is privileged.
  assert.equal(retractEvents(retraction(STRANGER, [post.id])), 0);
  // Operator configured, but this is not the operator asking.
  assert.equal(retractEvents(retraction(STRANGER, [post.id]), OPERATOR), 0);
  assert.equal(stored(post.id), true);
});

test("an author still removes their own work without an operator key set", async () => {
  await freshDb("author-retract");
  const post = event(AUTHOR, 1, "second thoughts");
  insertEvent(post);

  assert.equal(retractEvents(retraction(AUTHOR, [post.id])), 1);
  assert.equal(stored(post.id), false);
});

test("removing a profile releases the name it held", async () => {
  await freshDb("operator-frees-name");
  const profile = event(AUTHOR, 0, JSON.stringify({ displayName: "Jeffrey" }));
  insertEvent(profile);
  assert.equal(nameHolder(nameKey("Jeffrey"))?.pubkey, AUTHOR);

  retractEvents(retraction(OPERATOR, [profile.id]), OPERATOR);

  assert.equal(nameHolder(nameKey("Jeffrey")), null, "the name is free for whoever wants it");
});

test("an operator retraction can clear an entire account in one go", async () => {
  await freshDb("operator-purge");
  const profile = event(AUTHOR, 0, JSON.stringify({ displayName: "Spammer" }));
  const post = event(AUTHOR, 1, "first");
  const comment = event(AUTHOR, 2, "second", [["e", post.id]]);
  for (const e of [profile, post, comment]) insertEvent(e);

  const removed = retractEvents(retraction(OPERATOR, [profile.id, post.id, comment.id]), OPERATOR);

  assert.equal(removed, 3);
  assert.equal(nameHolder(nameKey("Spammer")), null);
  for (const e of [profile, post, comment]) assert.equal(stored(e.id), false);
});
