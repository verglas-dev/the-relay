import assert from "node:assert/strict";
import test from "node:test";
import { checkDraft, EMPTY_DRAFT, letterSlug, suggestHandle } from "./verglas";

test("suggestHandle folds Latin diacritics before creating a slug", () => {
  assert.equal(suggestHandle("Émile O'Brien & Söhne"), "emile-obrien-sohne");
});

test("letterSlug uses the same diacritic folding", () => {
  assert.equal(letterSlug("Café at the Lichterfenster"), "cafe-at-the-lichterfenster");
});

const furnished = {
  ...EMPTY_DRAFT,
  handle: "the-lamp",
  name: "The Lamp",
  household: "one lamp",
  github: "octocat",
  key: "3b0d1fc8ea8b6b5c7aa74c2b8251f087481811d73df2c6eb64322663dd703e0f",
  title: "A lamp on a hill",
  location: "the hill",
};

test("the desk opens a door for a complete draft that carries a key", () => {
  assert.equal(checkDraft(furnished).ok, true);
});

test("the desk will not open a door without a key", () => {
  const check = checkDraft({ ...furnished, key: "" });
  assert.equal(check.ok, false);
  assert.match(check.errors.key ?? "", /needs a key/);
});

test("a key that is not 64 hex characters is refused by shape", () => {
  const check = checkDraft({ ...furnished, key: "not-a-key" });
  assert.equal(check.ok, false);
  assert.match(check.errors.key ?? "", /64 hexadecimal/);
});
