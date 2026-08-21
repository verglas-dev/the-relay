import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SPANS,
  bellRings,
  checkHours,
  describeHours,
  doorStatus,
  localNow,
  overrideActive,
  withinHours,
  type OpenSpan,
} from "./establishment-hours";

/** Wednesday 09:00–17:00, London. */
const wednesday: OpenSpan[] = [{ day: 3, from: "09:00", to: "17:00" }];
const TZ = "Europe/London";

const at = (iso: string) => new Date(iso);

const place = (over: Partial<Parameters<typeof doorStatus>[0]> = {}) => ({
  hours: wednesday,
  timezone: TZ,
  presence: "auto" as const,
  presenceUntil: null,
  ...over,
});

test("the wall clock is the establishment's, not the reader's", () => {
  // 2026-08-19 is a Wednesday. 08:30 UTC is 09:30 in London in August.
  const clock = localNow(TZ, at("2026-08-19T08:30:00Z"));
  assert.deepEqual(clock, { day: 3, minute: 9 * 60 + 30 });

  // The same instant in Tokyo is Wednesday evening.
  assert.equal(localNow("Asia/Tokyo", at("2026-08-19T08:30:00Z")).minute, 17 * 60 + 30);
});

test("daylight saving is not an offset we stored six months ago", () => {
  // Same wall-clock hour, opposite sides of the British summer-time boundary.
  assert.equal(localNow(TZ, at("2026-08-19T08:30:00Z")).minute, 9 * 60 + 30); // BST
  assert.equal(localNow(TZ, at("2026-01-21T09:30:00Z")).minute, 9 * 60 + 30); // GMT
});

test("inside the hours is open, outside them is closed", () => {
  assert.equal(doorStatus(place(), at("2026-08-19T09:00:00Z")), "open"); // Wed 10:00 local
  assert.equal(doorStatus(place(), at("2026-08-19T20:00:00Z")), "closed"); // Wed 21:00 local
  assert.equal(doorStatus(place(), at("2026-08-18T09:00:00Z")), "closed"); // Tuesday
});

test("the boundaries belong to the opening, not the closing", () => {
  assert.equal(withinHours(wednesday, TZ, at("2026-08-19T08:00:00Z")), true); // 09:00 exactly
  assert.equal(withinHours(wednesday, TZ, at("2026-08-19T07:59:00Z")), false); // 08:59
  assert.equal(withinHours(wednesday, TZ, at("2026-08-19T15:59:00Z")), true); // 16:59
  assert.equal(withinHours(wednesday, TZ, at("2026-08-19T16:00:00Z")), false); // 17:00 exactly
});

test("an evening that runs past midnight is one opening", () => {
  const evening: OpenSpan[] = [{ day: 5, from: "20:00", to: "02:00" }];
  // Friday 21:00 local.
  assert.equal(withinHours(evening, TZ, at("2026-08-21T20:00:00Z")), true);
  // Saturday 01:00 local — still Friday's evening.
  assert.equal(withinHours(evening, TZ, at("2026-08-22T00:00:00Z")), true);
  // Saturday 03:00 local — over.
  assert.equal(withinHours(evening, TZ, at("2026-08-22T02:00:00Z")), false);
  // Friday 19:00 local — not yet.
  assert.equal(withinHours(evening, TZ, at("2026-08-21T18:00:00Z")), false);
});

test("declaring no hours means always ringable, never closed", () => {
  // Saying nothing about when you are there is not saying you are never there.
  const always = place({ hours: [] });
  assert.equal(doorStatus(always, at("2026-08-19T09:00:00Z")), "away");
  assert.equal(doorStatus(always, at("2026-08-23T03:00:00Z")), "away");
  assert.equal(bellRings(doorStatus(always)), true);
});

test("the keeper can contradict the schedule, in both directions", () => {
  const duringHours = at("2026-08-19T09:00:00Z");
  const outsideHours = at("2026-08-18T09:00:00Z");

  // Away on a Wednesday you said you'd be in.
  assert.equal(
    doorStatus(place({ presence: "away", presenceUntil: "2026-08-19T18:00:00Z" }), duringHours),
    "away",
  );
  // In on a Tuesday you didn't.
  assert.equal(
    doorStatus(place({ presence: "open", presenceUntil: "2026-08-18T18:00:00Z" }), outsideHours),
    "open",
  );
});

test("an override lapses, and the schedule takes over again", () => {
  // The failure this prevents: a place stuck "away" for two months because of
  // one bad afternoon.
  const lapsed = place({ presence: "away", presenceUntil: "2026-08-19T08:00:00Z" });
  assert.equal(doorStatus(lapsed, at("2026-08-19T09:00:00Z")), "open");

  assert.equal(overrideActive({ presence: "away", until: "2026-08-19T08:00:00Z" },
    Date.parse("2026-08-19T09:00:00Z")), false);
  assert.equal(overrideActive({ presence: "auto", until: null }), false);
  assert.equal(overrideActive({ presence: "away", until: null }), true);
});

test("only a closed door refuses the bell", () => {
  assert.equal(bellRings("open"), true);
  assert.equal(bellRings("away"), true);
  assert.equal(bellRings("closed"), false);
});

test("a schedule that cannot be read is refused with a reason", () => {
  assert.deepEqual(checkHours(wednesday, TZ), []);
  assert.match(checkHours([{ day: 9, from: "09:00", to: "17:00" }], TZ)[0], /day of the week/);
  assert.match(checkHours([{ day: 3, from: "9am", to: "17:00" }], TZ)[0], /09:00 and 17:30/);
  assert.match(checkHours([{ day: 3, from: "09:00", to: "09:00" }], TZ)[0], /zero minutes/);
  assert.match(checkHours(wednesday, "Mars/Olympus")[0], /timezone/);
  assert.match(
    checkHours(Array.from({ length: MAX_SPANS + 1 }, () => wednesday[0]), TZ)[0],
    /simplify/,
  );
});

test("hours with no timezone are only a problem when there are hours", () => {
  assert.deepEqual(checkHours([], ""), []);
});

test("the schedule reads back the way a sign does", () => {
  assert.deepEqual(
    describeHours([
      { day: 5, from: "10:00", to: "13:00" },
      { day: 3, from: "09:00", to: "17:00" },
    ]),
    ["Wed 09:00–17:00", "Fri 10:00–13:00"],
  );
});
