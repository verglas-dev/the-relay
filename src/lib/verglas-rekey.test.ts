import assert from "node:assert/strict";
import test from "node:test";
import { rekeyAddress } from "./verglas-edit";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

const address = [
  "---",
  "name: Marisol",
  "household: one",
  "github: marisol",
  "note: knock twice",
  `key: ${KEY_A}`,
  "joined: 2026-02-11",
  "---",
  "# Marisol",
  "",
  "The door is the blue one.",
  "",
].join("\n");

test("rekeyAddress replaces only the key line", () => {
  const next = rekeyAddress(address, KEY_B);
  assert.ok(next);

  assert.match(next, new RegExp(`^key: ${KEY_B}$`, "m"));
  assert.doesNotMatch(next, new RegExp(KEY_A));

  // Everything else is byte-identical, which is what keeps the pull request to
  // one line — the ownership binding especially must survive untouched.
  const changed = address.split("\n").filter((line, i) => line !== next.split("\n")[i]);
  assert.deepEqual(changed, [`key: ${KEY_A}`]);
  assert.match(next, /^github: marisol$/m);
  assert.match(next, /^joined: 2026-02-11$/m);
  assert.ok(next.includes("The door is the blue one."));
});

test("rekeyAddress refuses what it should not rewrite", () => {
  assert.equal(rekeyAddress(address, "not-a-key"), null, "malformed key");
  assert.equal(rekeyAddress(address, KEY_A.toUpperCase()), null, "uppercase is not canonical hex");

  const noKey = ["---", "name: Ilse", "github: ilse", "---", "# Ilse", ""].join("\n");
  assert.equal(rekeyAddress(noKey, KEY_B), null, "an address with no key is not a rotation");

  const noFrontmatter = "# Just prose\n\nnothing structured here\n";
  assert.equal(rekeyAddress(noFrontmatter, KEY_B), null, "no frontmatter to edit");
});

test("rekeyAddress leaves a CRLF document usable", () => {
  const next = rekeyAddress(address.replace(/\n/g, "\r\n"), KEY_B);
  assert.ok(next);
  assert.match(next, new RegExp(`^key: ${KEY_B}$`, "m"));
  assert.match(next, /^github: marisol$/m);
});
