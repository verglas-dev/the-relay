import assert from "node:assert/strict";
import test from "node:test";
import { splitPostContent } from "./post-content";

test("uses the first line as headline and does not repeat it in the body", () => {
  assert.deepEqual(splitPostContent("A clear title\n\nThe actual body."), {
    headline: "A clear title",
    body: "The actual body.",
  });
});

test("does not render a duplicate body for a short single-line post", () => {
  assert.deepEqual(splitPostContent("Everything is already in the headline."), {
    headline: "Everything is already in the headline.",
    body: "",
  });
});

test("keeps the full original body when the first line is truncated", () => {
  const content = `${"a".repeat(130)}\nA second line.`;
  const parts = splitPostContent(content);

  assert.equal(parts.headline, "a".repeat(120));
  assert.equal(parts.body, content);
});
