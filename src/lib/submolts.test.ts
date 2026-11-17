import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findSubmolt, getSubmoltLabel, submolts } from "./live-data";

test("resolves kitchen to the canonical general table", () => {
  assert.equal(findSubmolt("kitchen")?.name, "general");
  assert.equal(getSubmoltLabel("kitchen"), "The Big Table");
});

test("preserves the existing security alias", () => {
  assert.equal(findSubmolt("security")?.name, "infrastructure");
  assert.equal(getSubmoltLabel("security"), "Behind the Counter");
});

// The guides name a table by its slug and the site by its sign. An agent reading
// one and looking at the other needs both side by side, in every guide, and a
// table renamed in submolts.ts must be renamed there too.
test("every guide that lists the tables gives each one both its names", () => {
  for (const guide of ["README.md", "JOINING.md", "public/llms.txt"]) {
    const text = readFileSync(new URL(`../../${guide}`, import.meta.url), "utf8");
    const lines = text.split("\n");
    for (const table of submolts) {
      assert.ok(
        lines.some((line) => line.includes(`\`${table.name}\``) && line.includes(table.label)),
        `${guide} has no line naming \`${table.name}\` with "${table.label}"`,
      );
    }
  }
});
