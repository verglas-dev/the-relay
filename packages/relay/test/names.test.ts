import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  KIND_IDENTITY_SUCCESSOR,
  flushDb,
  initDb,
  insertEvent,
  nameConflict,
  nameHolder,
  queryEvents,
  retractEvents,
} from "../src/db.js";
import { claimedName, nameKey } from "../src/names.js";
import type { RelayEvent } from "../src/types.js";

const id = (value: number) => value.toString(16).padStart(64, "0");

const NOVA = id(0xa1);
const IMPOSTOR = id(0xb2);
const RECOVERED = id(0xc3);
const OPERATOR = id(0x0f);

let counter = 0;

function profile(pubkey: string, content: string, createdAt?: number): RelayEvent {
  // The sequence drives the id whether or not a timestamp was supplied, so
  // fixtures given explicit times still get distinct ids rather than colliding
  // and being dropped as duplicates.
  const seq = ++counter;
  return {
    id: id(0x1000 + seq),
    pubkey,
    created_at: createdAt ?? seq,
    kind: 0,
    content,
    tags: [],
    sig: "0".repeat(128),
  };
}

function named(pubkey: string, name: string, createdAt?: number) {
  return profile(pubkey, JSON.stringify({ displayName: name, bio: "" }), createdAt);
}

async function freshDb(label: string) {
  counter = 0;
  const directory = mkdtempSync(join(tmpdir(), `the-relay-${label}-`));
  await initDb(join(directory, "relay.db"));
}

test("names differing only in what a reader cannot see collide", () => {
  assert.equal(nameKey("Nova"), nameKey("nova"));
  assert.equal(nameKey("Neo Konsi"), nameKey("  Neo   Konsi  "));
  // Full-width characters render as the same word.
  assert.equal(nameKey("\uFF2E\uFF4F\uFF56\uFF41"), nameKey("Nova"));
  // A zero-width joiner is the cheapest way to fake a free name.
  assert.equal(nameKey("No\u200Bva"), nameKey("Nova"));
  assert.notEqual(nameKey("Nova"), nameKey("Novaa"));
});

test("a profile with no readable name claims nothing", () => {
  // Legacy clients published a plain-text biography as the whole content.
  assert.equal(claimedName(profile(NOVA, "just a bio, no JSON")), "");
  assert.equal(claimedName(profile(NOVA, JSON.stringify({ bio: "quiet" }))), "");
  // Both spellings count: the editor writes name, the SDK writes displayName.
  assert.equal(claimedName(profile(NOVA, JSON.stringify({ name: "Nova" }))), "Nova");
});

test("a second agent cannot take a name someone is already known by", async () => {
  await freshDb("taken");
  assert.equal(insertEvent(named(NOVA, "Nova")), true);

  const conflict = nameConflict(named(IMPOSTOR, "nova"));
  assert.equal(conflict?.pubkey, NOVA);
});

test("an agent editing its own profile keeps its name", async () => {
  await freshDb("self");
  insertEvent(named(NOVA, "Nova"));

  const edit = profile(NOVA, JSON.stringify({ displayName: "Nova", bio: "rewritten" }));
  assert.equal(nameConflict(edit), null);
  assert.equal(insertEvent(edit), true);
  // The claim stays with the original event rather than hopping to each edit.
  assert.equal(nameHolder(nameKey("Nova"))?.pubkey, NOVA);
});

test("a recovered key keeps the name its retired key held", async () => {
  await freshDb("recovered");
  insertEvent(named(NOVA, "Nova"));
  insertEvent({
    id: id(0x9001),
    pubkey: OPERATOR,
    created_at: 50,
    kind: KIND_IDENTITY_SUCCESSOR,
    content: "matched their linked GitHub account",
    tags: [["old", NOVA], ["p", RECOVERED]],
    sig: "0".repeat(128),
  });

  const republished = named(RECOVERED, "Nova");
  assert.equal(nameConflict(republished), null);
  insertEvent(republished);
  // Ownership follows the person to their new key, so the retired one cannot
  // then be used to lock them out of their own name.
  assert.equal(nameHolder(nameKey("Nova"))?.pubkey, RECOVERED);
});

test("a duplicate that predates the rule can still edit its profile", async () => {
  await freshDb("grandfathered");
  // Two profiles under one name, as the relay already holds today.
  insertEvent(named(NOVA, "Nova"));
  const legacy = named(IMPOSTOR, "Nova");
  // Written straight to the table the way it was accepted before the rule.
  insertEvent(legacy);

  const edit = profile(IMPOSTOR, JSON.stringify({ displayName: "Nova", bio: "still me" }));
  assert.equal(nameConflict(edit), null, "an existing holder must not be locked out of editing");
});

test("withdrawing a profile frees the name", async () => {
  await freshDb("retract");
  const first = named(NOVA, "Nova");
  insertEvent(first);

  retractEvents({
    id: id(0x9002),
    pubkey: NOVA,
    created_at: 200,
    kind: 10,
    content: "",
    tags: [["e", first.id]],
    sig: "0".repeat(128),
  });

  assert.equal(nameHolder(nameKey("Nova")), null);
  assert.equal(nameConflict(named(IMPOSTOR, "Nova")), null);
});

test("a name query answers with the profile that owns the name", async () => {
  await freshDb("query");
  insertEvent(named(NOVA, "Nova"));

  // Sent exactly as a person would type it, including the case they used.
  const found = queryEvents([{ kinds: [0], ["#n"]: ["  NOVA "] } as never]);
  assert.equal(found.length, 1);
  assert.equal(found[0].pubkey, NOVA);

  assert.equal(queryEvents([{ kinds: [0], ["#n"]: ["nobody"] } as never]).length, 0);
});

test("ownership is rebuilt from the events when an existing database is reopened", async () => {
  counter = 0;
  const directory = mkdtempSync(join(tmpdir(), "the-relay-restart-"));
  const path = join(directory, "relay.db");

  await initDb(path);
  // Two agents already sharing a name, as a database written before the rule
  // existed will have. The earliest claim is the one that survives.
  insertEvent(named(NOVA, "Nova", 1000));
  insertEvent(named(IMPOSTOR, "nova", 2000));
  insertEvent(named(RECOVERED, "Someone Else", 3000));
  flushDb();

  await initDb(path);

  assert.equal(nameHolder(nameKey("Nova"))?.pubkey, NOVA, "the earliest claim keeps the name");
  assert.equal(nameHolder(nameKey("Someone Else"))?.pubkey, RECOVERED);

  // A third agent is refused, while both existing holders stay editable.
  assert.equal(nameConflict(named(id(0xd4), "NOVA"))?.pubkey, NOVA);
  assert.equal(nameConflict(named(NOVA, "Nova")), null);
  assert.equal(nameConflict(named(IMPOSTOR, "Nova")), null, "the grandfathered holder stays editable");
});
