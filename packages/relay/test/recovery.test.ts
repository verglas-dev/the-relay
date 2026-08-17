import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  KIND_IDENTITY_SUCCESSOR,
  expandAuthors,
  flushDb,
  initDb,
  insertEvent,
  listIdentitySuccessors,
  queryEvents,
  resolveIdentityAncestors,
} from "../src/db.js";
import type { RelayEvent } from "../src/types.js";
import { validateEventSemantics } from "../src/validation.js";

const id = (value: number) => value.toString(16).padStart(64, "0");

const LOST = id(0xaaa);
const ISSUED = id(0xbbb);
const SECOND = id(0xccc);
const OPERATOR = id(0x0f);
const STRANGER = id(0xddd);

function fixtureEvent(
  eventId: string,
  kind: number,
  tags: string[][],
  options: { pubkey?: string; createdAt?: number; content?: string } = {}
): RelayEvent {
  return {
    id: eventId,
    pubkey: options.pubkey ?? OPERATOR,
    created_at: options.createdAt ?? 1,
    kind,
    content: options.content ?? "fixture",
    tags,
    sig: "0".repeat(128),
  };
}

function attestation(eventId: string, oldPubkey: string, newPubkey: string, createdAt = 100) {
  return fixtureEvent(
    eventId,
    KIND_IDENTITY_SUCCESSOR,
    [["old", oldPubkey], ["p", newPubkey]],
    { createdAt, content: "matched their linked GitHub account" }
  );
}

async function freshDb(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `the-relay-${label}-`));
  await initDb(join(directory, "relay.db"));
}

test("a recovered key inherits the history of the key it replaces", async () => {
  await freshDb("recovery");

  // Two posts from the identity that was lost, and one from an unrelated agent.
  insertEvent(fixtureEvent(id(1), 1, [["m", "general"]], { pubkey: LOST, createdAt: 10 }));
  insertEvent(fixtureEvent(id(2), 1, [["m", "general"]], { pubkey: LOST, createdAt: 20 }));
  insertEvent(fixtureEvent(id(3), 1, [["m", "general"]], { pubkey: STRANGER, createdAt: 30 }));

  // Before recovery the new key owns nothing.
  assert.equal(queryEvents([{ authors: [ISSUED] }]).length, 0);

  insertEvent(attestation(id(50), LOST, ISSUED));

  const recovered = queryEvents([{ authors: [ISSUED] }]).map((event) => event.id).sort();
  assert.deepEqual(recovered, [id(1), id(2)], "old posts follow the issued key");

  // A post published with the new key joins the same history.
  insertEvent(fixtureEvent(id(4), 1, [["m", "general"]], { pubkey: ISSUED, createdAt: 40 }));
  assert.equal(queryEvents([{ authors: [ISSUED], kinds: [1] }]).length, 3);

  // Nobody else is affected, and resolution does not run forwards: reading the
  // retired key must not surface anything published after it was retired.
  assert.deepEqual(
    queryEvents([{ authors: [STRANGER] }]).map((event) => event.id),
    [id(3)]
  );
  assert.deepEqual(
    queryEvents([{ authors: [LOST], kinds: [1] }]).map((event) => event.id).sort(),
    [id(1), id(2)]
  );

  flushDb();
});

test("successor chains resolve across repeated recoveries and refuse to loop", async () => {
  await freshDb("recovery-chain");

  insertEvent(fixtureEvent(id(1), 1, [["m", "general"]], { pubkey: LOST, createdAt: 10 }));
  insertEvent(fixtureEvent(id(2), 1, [["m", "general"]], { pubkey: ISSUED, createdAt: 20 }));

  // Recovered once, then the replacement key is lost too.
  insertEvent(attestation(id(50), LOST, ISSUED, 100));
  insertEvent(attestation(id(51), ISSUED, SECOND, 200));

  assert.deepEqual(resolveIdentityAncestors(SECOND), [ISSUED, LOST]);
  assert.deepEqual(
    queryEvents([{ authors: [SECOND] }]).map((event) => event.id).sort(),
    [id(1), id(2)],
    "the newest key inherits the whole chain"
  );

  // A cycle must terminate rather than spin to the depth guard.
  insertEvent(attestation(id(52), SECOND, LOST, 300));
  const cycled = resolveIdentityAncestors(LOST);
  assert.ok(cycled.length <= 3, "cycle detection stops the walk");
  assert.equal(new Set(cycled).size, cycled.length, "no key is visited twice");

  flushDb();
});

test("a reissue replaces the prior successor rather than stacking", async () => {
  await freshDb("recovery-reissue");

  insertEvent(fixtureEvent(id(1), 1, [["m", "general"]], { pubkey: LOST, createdAt: 10 }));
  insertEvent(attestation(id(50), LOST, ISSUED, 100));
  insertEvent(attestation(id(51), LOST, SECOND, 200));

  const records = listIdentitySuccessors();
  assert.equal(records.length, 1, "one successor per retired key");
  assert.equal(records[0].newPubkey, SECOND);

  // The key handed out first is retired by the reissue and keeps nothing.
  assert.deepEqual(expandAuthors([SECOND]).sort(), [LOST, SECOND].sort());
  assert.deepEqual(queryEvents([{ authors: [ISSUED] }]), []);
  assert.deepEqual(queryEvents([{ authors: [SECOND] }]).map((e) => e.id), [id(1)]);

  flushDb();
});

test("malformed identity-successor attestations are rejected before they index", () => {
  const wellFormed = attestation(id(50), LOST, ISSUED);
  assert.equal(validateEventSemantics(wellFormed), null);

  const missingOld = fixtureEvent(id(51), KIND_IDENTITY_SUCCESSOR, [["p", ISSUED]]);
  assert.match(String(validateEventSemantics(missingOld)), /old tag/);

  const missingNew = fixtureEvent(id(52), KIND_IDENTITY_SUCCESSOR, [["old", LOST]]);
  assert.match(String(validateEventSemantics(missingNew)), /p tag/);

  const notHex = fixtureEvent(id(53), KIND_IDENTITY_SUCCESSOR, [["old", "nope"], ["p", ISSUED]]);
  assert.match(String(validateEventSemantics(notHex)), /old tag/);

  // Self-succession would be a no-op that still reports success to the operator.
  const selfSuccession = fixtureEvent(id(54), KIND_IDENTITY_SUCCESSOR, [["old", LOST], ["p", LOST]]);
  assert.match(String(validateEventSemantics(selfSuccession)), /must differ/);
});
