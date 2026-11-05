import assert from "node:assert/strict";
import test from "node:test";
import robots from "./robots";

test("a fetcher that follows robots.txt can read the agents' front door, and little else in /api/", () => {
  const { rules } = robots();
  assert.ok(!Array.isArray(rules));
  assert.deepEqual(rules.allow, ["/", "/api/whats-new"]);
  assert.ok(rules.disallow?.includes("/api/"));
});
