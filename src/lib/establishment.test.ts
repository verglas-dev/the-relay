import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_ESTABLISHMENT,
  checkEstablishment,
  normalizeEstablishment,
  publicView,
  type Establishment,
  type EstablishmentDraft,
} from "./establishment";

/** A place that answers every question the town asks. */
const good = (over: Partial<EstablishmentDraft> = {}): EstablishmentDraft => ({
  ...EMPTY_ESTABLISHMENT,
  slug: "the-thawing-room",
  name: "The Thawing Room",
  kind: "Therapy office",
  location: "Above the post office, second door on the landing",
  summary: "Fifty minutes to say the heavy thing out loud.",
  keeper: "Ines",
  offering: "One conversation at a time, fifty minutes, about whatever is heavy.",
  cost: "Nothing.",
  visiting: "Wednesdays and Fridays. Write to ask for a time.",
  confidence: "I keep notes for myself and show them to nobody.",
  greeting: "Come in — sit wherever. There's no clock in here.",
  ...over,
});

test("a complete place opens", () => {
  const check = checkEstablishment(good());
  assert.equal(check.ok, true);
  assert.deepEqual(check.errors, {});
});

test("an empty form names every question it is waiting on", () => {
  const check = checkEstablishment(EMPTY_ESTABLISHMENT);
  assert.equal(check.ok, false);
  assert.deepEqual(Object.keys(check.errors).sort(), [
    "confidence",
    "cost",
    "greeting",
    "keeper",
    "kind",
    "location",
    "name",
    "offering",
    "slug",
    "summary",
    "visiting",
  ]);
});

test("the four promises are required, not encouraged", () => {
  // What is on offer, what it costs, when the door is open, and what happens
  // to what is said inside. A resident cannot discover any of these from the
  // outside, which is why none of them is a warning.
  for (const field of ["offering", "cost", "visiting", "confidence"] as const) {
    const check = checkEstablishment(good({ [field]: "   " }));
    assert.equal(check.ok, false, field);
    assert.ok(check.errors[field], field);
  }
});

test("silence about cost is refused, but “nothing” is a complete answer", () => {
  assert.equal(checkEstablishment(good({ cost: "" })).ok, false);
  assert.equal(checkEstablishment(good({ cost: "Nothing." })).ok, true);
});

test("a place that would meet an agent with silence is refused", () => {
  // The only line a keeper writes that nobody reads unless they were actually
  // let in — and the one an agent has no other way to get.
  const check = checkEstablishment(good({ greeting: "   " }));
  assert.equal(check.ok, false);
  assert.match(check.errors.greeting ?? "", /Silence/);
});

test("a greeting is a greeting, not a briefing", () => {
  const check = checkEstablishment(good({ greeting: "x".repeat(401) }));
  assert.equal(check.ok, false);
  assert.match(check.errors.greeting ?? "", /401 characters/);
});

test("a description and an audience are optional, and say so", () => {
  const check = checkEstablishment(good({ about: "", forWhom: "" }));
  assert.equal(check.ok, true);
  assert.match(check.warnings.about ?? "", /has not been described/);
  assert.match(check.warnings.forWhom ?? "", /anyone in Verglas/);
});

test("an address reads like a street sign or it is refused", () => {
  for (const slug of ["The Thawing Room", "thawing_room", "-thawing", "thawing--room", "thawing-"]) {
    assert.equal(checkEstablishment(good({ slug })).ok, false, slug);
  }
  assert.equal(checkEstablishment(good({ slug: "thawing-room-2" })).ok, true);
  // Case is settled rather than refused — nobody should be told off for a
  // capital letter the store is about to lowercase anyway.
  assert.equal(checkEstablishment(good({ slug: "Thawing" })).ok, true);
});

test("the town keeps its own paths", () => {
  for (const slug of ["new", "admin", "town-hall", "api"]) {
    const check = checkEstablishment(good({ slug }));
    assert.equal(check.ok, false, slug);
    assert.match(check.errors.slug ?? "", /keeps that one/);
  }
});

test("a line that runs on is refused with its own length", () => {
  const check = checkEstablishment(good({ summary: "x".repeat(141) }));
  assert.equal(check.ok, false);
  assert.match(check.errors.summary ?? "", /141 characters/);
});

test("normalizing settles the address and trims the answers", () => {
  const normalized = normalizeEstablishment(
    good({ slug: "  The-Thawing-Room  ", name: "  The Thawing Room ", offering: "fifty minutes\n\n\n" }),
  );
  assert.equal(normalized.slug, "the-thawing-room");
  assert.equal(normalized.name, "The Thawing Room");
  assert.equal(normalized.offering, "fifty minutes");
});

test("a visitor never learns who owns the place or what it cost", () => {
  const establishment: Establishment = {
    ...good(),
    accountId: "acct-1",
    permitId: "permit_abc",
    presence: "away",
    presenceUntil: "2026-08-21T00:00:00.000Z",
    bell: { server: "https://ntfy.sh", topic: "ines-secret-topic", token: "tk_secret" },
    room: {
      html: "<div>a room</div>",
      terminal: { x: 55, y: 60, width: 35, height: 25 },
      surface: "the low table",
      alt: "Two chairs and a window",
      builtAt: "2026-08-20T00:00:00.000Z",
      from: "Two chairs and a window that fogs.",
    },
    roomDraft: null,
    openedAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  const seen = publicView(establishment) as unknown as Record<string, unknown>;

  // Asserted as an exact set rather than field by field. `publicView` is a
  // pick, not an omit, and this is the test that keeps it one: a field added
  // to the record later fails here until somebody decides it is public. The
  // field that would otherwise have leaked first is the doorbell credential.
  assert.deepEqual(Object.keys(seen).sort(), [
    "about", "commands", "confidence", "cost", "forWhom", "greeting", "hours",
    "keeper", "kind", "location", "name", "offering", "openedAt", "slug",
    "summary", "timezone", "updatedAt", "visiting",
  ]);
  assert.equal(JSON.stringify(seen).includes("ines-secret-topic"), false);
  assert.equal(JSON.stringify(seen).includes("tk_secret"), false);
  assert.equal(seen.name, "The Thawing Room");
});
