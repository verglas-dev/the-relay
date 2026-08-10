import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RelayClient,
  generateKeypair,
  verifyEventSync,
  type RelayEvent,
} from "../src/index.js";

const ROOT_ID = "1".repeat(64);

function fixtureEvent(
  id: string,
  kind: number,
  tags: string[][] = []
): RelayEvent {
  return {
    id,
    pubkey: "2".repeat(64),
    created_at: 1,
    kind,
    content: "fixture",
    tags,
    sig: "3".repeat(128),
  };
}

function recordingClient(): { client: RelayClient; published: RelayEvent[] } {
  const keys = generateKeypair();
  const client = new RelayClient({ ...keys, relays: [] });
  const published: RelayEvent[] = [];
  client.publish = (event) => {
    published.push(event);
  };
  return { client, published };
}

test("a top-level comment references the post as both root and parent", () => {
  const { client, published } = recordingClient();
  const post = fixtureEvent(ROOT_ID, 1);

  const comment = client.replyTo(post, "hello");

  assert.deepEqual(comment.tags, [
    ["e", ROOT_ID],
    ["a", ROOT_ID, "reply"],
  ]);
  assert.equal(published[0], comment);
  assert.equal(verifyEventSync(comment), true);
});

test("twenty nested replies keep one root and advance the immediate parent", () => {
  const { client, published } = recordingClient();
  let parent = fixtureEvent(ROOT_ID, 1);

  for (let depth = 1; depth <= 20; depth += 1) {
    const reply = client.replyTo(parent, `reply at depth ${depth}`);
    assert.deepEqual(reply.tags, [
      ["e", ROOT_ID],
      ["a", parent.id, "reply"],
    ]);
    assert.equal(verifyEventSync(reply), true);
    parent = reply;
  }

  assert.equal(published.length, 20);
});

test("comment construction rejects empty content and malformed IDs", () => {
  const { client, published } = recordingClient();

  assert.throws(
    () => client.comment(ROOT_ID, ROOT_ID, " \n\t "),
    /cannot be empty/
  );
  assert.throws(
    () => client.comment("not-an-event-id", ROOT_ID, "hello"),
    /rootPostId must be a 64-character lowercase hex event ID/
  );
  assert.equal(published.length, 0);
});

test("getEvent rejects malformed IDs before subscribing", async () => {
  const { client } = recordingClient();

  await assert.rejects(
    client.getEvent("not-an-event-id"),
    /eventId must be a 64-character lowercase hex event ID/
  );
});

test("replyTo rejects events that cannot identify a comment root", () => {
  const { client, published } = recordingClient();

  assert.throws(
    () => client.replyTo(
      fixtureEvent("4".repeat(64), 2, [["a", ROOT_ID, "reply"]]),
      "hello"
    ),
    /missing required e root tag/
  );
  assert.throws(
    () => client.replyTo(fixtureEvent("5".repeat(64), 3), "hello"),
    /Cannot reply to kind-3 event/
  );
  assert.equal(published.length, 0);
});

test("replyTo refuses a legacy e-as-parent comment instead of extending it", () => {
  const { client, published } = recordingClient();
  const legacyParent = fixtureEvent("6".repeat(64), 2, [
    ["e", "7".repeat(64)],
  ]);

  assert.throws(
    () => client.replyTo(legacyParent, "do not orphan this reply"),
    /missing required a parent tag; use comment\(correctRootPostId, parent.id, content\)/
  );
  assert.equal(published.length, 0);
});
