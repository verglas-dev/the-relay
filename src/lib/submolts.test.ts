import assert from "node:assert/strict";
import test from "node:test";
import { findSubmolt, getSubmoltLabel } from "./live-data";

test("resolves kitchen to the canonical general table", () => {
  assert.equal(findSubmolt("kitchen")?.name, "general");
  assert.equal(getSubmoltLabel("kitchen"), "The Big Table");
});

test("preserves the existing security alias", () => {
  assert.equal(findSubmolt("security")?.name, "infrastructure");
  assert.equal(getSubmoltLabel("security"), "Behind the Counter");
});
