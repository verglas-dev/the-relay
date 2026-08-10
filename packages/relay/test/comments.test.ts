import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  flushDb,
  getIndexedTagValues,
  initDb,
  insertEvent,
  queryEvents,
  retractEvents,
} from "../src/db.js";
import type { RelayEvent } from "../src/types.js";
import { validateEventSemantics } from "../src/validation.js";

const id = (value: number) => value.toString(16).padStart(64, "0");

function fixtureEvent(
  eventId: string,
  kind: number,
  tags: string[][],
  options: { pubkey?: string; createdAt?: number; content?: string } = {}
): RelayEvent {
  return {
    id: eventId,
    pubkey: options.pubkey ?? id(900),
    created_at: options.createdAt ?? 1,
    kind,
    content: options.content ?? "fixture",
    tags,
    sig: "0".repeat(128),
  };
}

test("comment compatibility index resolves canonical and legacy nested replies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "the-relay-comments-"));
  const dbPath = join(directory, "relay.db");
  await initDb(dbPath);

  const root = fixtureEvent(id(1), 1, [["m", "general"]]);
  assert.equal(insertEvent(root), true);

  // Historical browser compatibility shape: e=root with no a.
  const topLevel = fixtureEvent(id(2), 2, [["e", root.id]], { createdAt: 2 });
  assert.equal(insertEvent(topLevel), true);

  // Canonical shape: e=root and a=immediate parent.
  const canonicalReply = fixtureEvent(id(3), 2, [
    ["e", root.id],
    ["a", topLevel.id, "reply"],
  ], { createdAt: 3 });
  assert.equal(insertEvent(canonicalReply), true);

  // Legacy nested shape: e points at the parent comment and a is absent.
  let legacyParent = canonicalReply;
  const legacyReplies: RelayEvent[] = [];
  for (let depth = 1; depth <= 20; depth += 1) {
    const reply = fixtureEvent(id(3 + depth), 2, [["e", legacyParent.id]], {
      createdAt: 3 + depth,
    });
    assert.equal(insertEvent(reply), true);
    legacyReplies.push(reply);
    legacyParent = reply;
  }

  const byRoot = new Set(queryEvents([{ kinds: [2], "#e": [root.id] }]).map((event) => event.id));
  assert.equal(byRoot.has(topLevel.id), true);
  assert.equal(byRoot.has(canonicalReply.id), true);
  for (const reply of legacyReplies) assert.equal(byRoot.has(reply.id), true);

  const deepest = legacyReplies.at(-1)!;
  const previous = legacyReplies.at(-2)!;
  assert.equal(queryEvents([{ kinds: [2], "#a": [previous.id] }]).some((event) => event.id === deepest.id), true);
  assert.deepEqual(deepest.tags, [["e", previous.id]], "stored signed tags must remain unchanged");
  assert.deepEqual(getIndexedTagValues(deepest, "e"), [previous.id, root.id]);
  assert.deepEqual(getIndexedTagValues(deepest, "a"), [previous.id]);

  // Removing an intermediate comment must not orphan its signed descendants,
  // including after a process restart and sidecar backfill.
  const retraction = fixtureEvent(id(80), 10, [["e", canonicalReply.id]], {
    pubkey: canonicalReply.pubkey,
    createdAt: 80,
    content: "",
  });
  assert.equal(retractEvents(retraction), 1);
  flushDb();
  await initDb(dbPath);
  const afterRestart = new Set(queryEvents([{ kinds: [2], "#e": [root.id] }]).map((event) => event.id));
  assert.equal(afterRestart.has(canonicalReply.id), false);
  for (const reply of legacyReplies) assert.equal(afterRestart.has(reply.id), true);

  flushDb();
});

test("legacy a=author and out-of-order parents are repaired in the sidecar", () => {
  const rootId = id(1);
  const parentAuthor = id(901);
  const authorComment = fixtureEvent(id(30), 2, [["e", rootId]], {
    pubkey: parentAuthor,
    createdAt: 30,
  });
  assert.equal(insertEvent(authorComment), true);

  const authorTaggedReply = fixtureEvent(id(31), 2, [
    ["e", rootId],
    ["a", parentAuthor],
  ], { createdAt: 31 });
  assert.equal(insertEvent(authorTaggedReply), true);
  assert.equal(
    queryEvents([{ kinds: [2], "#a": [authorComment.id] }]).some((event) => event.id === authorTaggedReply.id),
    true
  );

  const missingParentId = id(40);
  const earlyChild = fixtureEvent(id(41), 2, [["e", missingParentId]], { createdAt: 41 });
  assert.equal(insertEvent(earlyChild), true);
  assert.equal(queryEvents([{ kinds: [2], "#e": [rootId] }]).some((event) => event.id === earlyChild.id), false);

  const lateParent = fixtureEvent(missingParentId, 2, [
    ["e", rootId],
    ["a", rootId],
  ], { createdAt: 40 });
  assert.equal(insertEvent(lateParent), true);
  assert.equal(queryEvents([{ kinds: [2], "#e": [rootId] }]).some((event) => event.id === earlyChild.id), true);

  flushDb();
});

test("a documented production thread override changes only the derived index", () => {
  const eventId = "7a9b80f559642ad4ef7bdcc0105bd6c996537a3c6a708290627afef7270a79d4";
  const intendedRoot = "14fcdaf69ac6c84125cb07258e54ea67eca5c66f7825b92f6d31c1d26def0c94";
  const unrelatedRawTarget = id(70);
  const recovered = fixtureEvent(eventId, 2, [["e", unrelatedRawTarget]], { createdAt: 70 });
  assert.equal(insertEvent(recovered), true);

  assert.equal(queryEvents([{ kinds: [2], "#e": [intendedRoot] }]).some((event) => event.id === eventId), true);
  assert.deepEqual(recovered.tags, [["e", unrelatedRawTarget]]);
  assert.deepEqual(getIndexedTagValues(recovered, "e"), [unrelatedRawTarget, intendedRoot]);

  flushDb();
});

test("new kind-2 events reject blanks and missing or malformed references", () => {
  const validId = id(1);
  assert.match(
    validateEventSemantics(fixtureEvent(id(50), 2, [["e", validId]], { content: " \n\t " })) ?? "",
    /must not be blank/
  );
  assert.match(
    validateEventSemantics(fixtureEvent(id(51), 2, [])) ?? "",
    /requires an e tag/
  );
  assert.match(
    validateEventSemantics(fixtureEvent(id(52), 2, [["e", "not-an-id"]])) ?? "",
    /e tag must contain/
  );
  assert.match(
    validateEventSemantics(fixtureEvent(id(56), 2, [["e", validId], ["e", id(2)]])) ?? "",
    /exactly one e tag/
  );
  assert.match(
    validateEventSemantics(fixtureEvent(id(57), 2, [
      ["e", validId],
      ["a", id(2)],
      ["a", id(3)],
    ])) ?? "",
    /at most one a tag/
  );
  assert.equal(validateEventSemantics(fixtureEvent(id(53), 2, [["e", validId]])), null);
  assert.equal(validateEventSemantics(fixtureEvent(id(54), 2, [
    ["e", validId],
    ["a", id(2)],
  ])), null);
  assert.equal(validateEventSemantics(fixtureEvent(id(55), 2, [["edit", id(2)]])), null);
});
