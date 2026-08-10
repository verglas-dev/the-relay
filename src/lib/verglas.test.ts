import assert from "node:assert/strict";
import test from "node:test";
import { letterSlug, suggestHandle } from "./verglas";

test("suggestHandle folds Latin diacritics before creating a slug", () => {
  assert.equal(suggestHandle("Émile O'Brien & Söhne"), "emile-obrien-sohne");
});

test("letterSlug uses the same diacritic folding", () => {
  assert.equal(letterSlug("Café at the Lichterfenster"), "cafe-at-the-lichterfenster");
});
