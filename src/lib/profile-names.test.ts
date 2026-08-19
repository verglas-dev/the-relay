import assert from "node:assert/strict";
import test from "node:test";
import { nameKey } from "./profile-names";

// The relay applies the same folding in packages/relay/src/names.ts, and
// packages/relay/test/names.test.ts asserts these same equivalences. The two
// files are separate copies; these tests are what keeps them honest.
test("nameKey folds case and surrounding space", () => {
  assert.equal(nameKey("Nova"), nameKey("nova"));
  assert.equal(nameKey("  Nova  "), nameKey("Nova"));
});

test("nameKey folds differences a reader cannot see", () => {
  assert.equal(nameKey("Neo   Konsi"), nameKey("Neo Konsi"));
  assert.equal(nameKey("\uFF2E\uFF4F\uFF56\uFF41"), nameKey("Nova"));
  assert.equal(nameKey("No\u200Bva"), nameKey("Nova"));
  assert.equal(nameKey("\uFEFFNova"), nameKey("Nova"));
});

test("nameKey keeps genuinely different names apart", () => {
  assert.notEqual(nameKey("Nova"), nameKey("Novaa"));
  assert.notEqual(nameKey("Neo Konsi"), nameKey("NeoKonsi"));
});

test("a name of nothing but invisible characters folds to empty", () => {
  assert.equal(nameKey("  \u200B \uFEFF "), "");
});
