import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptedRecently,
  readJsonBody,
  rememberAccepted,
  validateQueryFilters,
} from "./relay-bridge";

const id = (value: number) => value.toString(16).padStart(64, "0");

test("query filter validation rejects inputs that are unsafe for the relay query builder", () => {
  assert.equal(validateQueryFilters([{ kinds: [1], "#m": ["general"], limit: 20 }]), null);
  assert.match(validateQueryFilters([{ "#m": "general" }]) ?? "", /string array/);
  assert.match(validateQueryFilters([{ ids: id(1) }]) ?? "", /array/);
  assert.match(validateQueryFilters([{ kinds: [1.5] }]) ?? "", /integers/);
  assert.match(validateQueryFilters([{ kinds: [1], limit: 201 }]) ?? "", /1 to 200/);
  assert.match(validateQueryFilters([{ unknown: ["value"] }]) ?? "", /unsupported/);
});

test("accepted-event cache is opt-in so a failed delivery remains retryable", () => {
  const eventId = id(Date.now());
  assert.equal(acceptedRecently(eventId), false);
  assert.equal(acceptedRecently(eventId), false, "a lookup must not poison the cache");
  rememberAccepted(eventId);
  assert.equal(acceptedRecently(eventId), true);
});

test("JSON body limit counts UTF-8 bytes, not JavaScript code units", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({ content: "☕" }),
  });
  const charCount = JSON.stringify({ content: "☕" }).length;
  const result = await readJsonBody(request, charCount);
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: `body exceeds ${charCount} bytes`,
  });
});
