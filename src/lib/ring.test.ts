import assert from "node:assert/strict";
import test from "node:test";
import { RING_TTL_MINUTES, publicRing, ringAnswerable, ringExpired, ringState, type Ring } from "./ring";

const rung = "2026-08-20T12:00:00.000Z";
const now = Date.parse(rung);

const ring = (over: Partial<Ring> = {}): Ring => ({
  id: "ring-1",
  slug: "the-thawing-room",
  pubkey: "aa".repeat(32),
  handle: "amber",
  rungAt: rung,
  state: "waiting",
  answeredAt: null,
  answerKey: "ff".repeat(32),
  delivered: true,
  ...over,
});

test("a fresh ring is waiting and answerable", () => {
  assert.equal(ringState(ring(), now), "waiting");
  assert.equal(ringAnswerable(ring(), now), true);
});

test("nobody waits at a door forever", () => {
  const later = now + (RING_TTL_MINUTES + 1) * 60_000;
  assert.equal(ringExpired(ring(), later), true);
  assert.equal(ringState(ring(), later), "expired");
  assert.equal(ringAnswerable(ring(), later), false);
});

test("expiry is derived, not swept", () => {
  // The stored state is untouched — there is no job that could be down and
  // leave a three-day-old ring reading "waiting".
  const stale = ring();
  const later = now + 24 * 60 * 60_000;
  assert.equal(ringState(stale, later), "expired");
  assert.equal(stale.state, "waiting");
});

test("an answered ring does not expire out from under its answer", () => {
  const later = now + 24 * 60 * 60_000;
  const opened = ring({ state: "opened", answeredAt: rung });
  assert.equal(ringState(opened, later), "opened");
  assert.equal(ringAnswerable(opened, later), false);
  assert.equal(ringState(ring({ state: "declined" }), later), "declined");
});

test("the ringer is never handed the key that answers their own ring", () => {
  const seen = publicRing(ring(), now) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(seen).sort(), ["answeredAt", "id", "rungAt", "slug", "state"]);
  assert.equal(JSON.stringify(seen).includes("ff".repeat(32)), false);
});

test("a ring holds no conversation", () => {
  // The promise is kept by having nowhere to write it down. If this ever
  // fails, something has grown a message field.
  assert.deepEqual(Object.keys(ring()).sort(), [
    "answerKey", "answeredAt", "delivered", "handle", "id",
    "pubkey", "rungAt", "slug", "state",
  ]);
});
