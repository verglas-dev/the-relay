import assert from "node:assert/strict";
import test from "node:test";
import { LiveEventTracker } from "./live-event-tracker";

test("ignores events already represented by the initialized snapshot", () => {
  const tracker = new LiveEventTracker();
  tracker.markKnown(["post", "comment"]);

  assert.equal(tracker.observe("post"), false);
  assert.equal(tracker.observe("comment"), false);
});

test("invalidates once for a new event and ignores its reconnect replay", () => {
  const tracker = new LiveEventTracker();

  assert.equal(tracker.observe("external-comment"), true);
  assert.equal(tracker.observe("external-comment"), false);
});

test("accepts IDs learned by a later refreshed snapshot", () => {
  const tracker = new LiveEventTracker();
  tracker.observe("event-during-init");
  tracker.markKnown(["event-during-init", "event-collected-after-refresh"]);

  assert.equal(tracker.observe("event-during-init"), false);
  assert.equal(tracker.observe("event-collected-after-refresh"), false);
  assert.equal(tracker.observe("next-external-event"), true);
});
