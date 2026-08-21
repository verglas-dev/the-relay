import assert from "node:assert/strict";
import test from "node:test";
import { CHUNK_BYTES, MAX_PARTS, byteLength, chunk } from "./session-transport";

const within = (parts: string[]) => parts.every((part) => byteLength(part) <= CHUNK_BYTES);

test("an ordinary line goes out whole and unmarked", () => {
  // A bare (1/1) on every sentence would make a conversation read like a
  // machine talking.
  const { parts, truncated } = chunk("Come in — sit wherever. There's no clock in here.");
  assert.deepEqual(parts, ["Come in — sit wherever. There's no clock in here."]);
  assert.equal(truncated, false);
});

test("nothing ever goes out over the limit", () => {
  // Over 4,096 bytes ntfy turns a message into a stored attachment. This is
  // the test that keeps a conversation from leaving a file behind.
  for (const text of [
    "x".repeat(10_000),
    "word ".repeat(3_000),
    "🔔".repeat(2_000),
    ("A sentence that goes on. ".repeat(400)),
    "para\n\n".repeat(2_000),
  ]) {
    const { parts } = chunk(text);
    assert.ok(within(parts), `overflowed on ${text.slice(0, 12)}…`);
  }
});

test("a long line is numbered so it can be reassembled by eye", () => {
  const { parts } = chunk("A sentence that goes on and on. ".repeat(500));
  assert.ok(parts.length > 1);
  parts.forEach((part, index) => {
    assert.ok(part.startsWith(`(${index + 1}/${parts.length}) `), part.slice(0, 12));
  });
});

test("splits land where a reader would have paused", () => {
  // Big enough that the two together cannot fit in one message.
  const paragraph = "x".repeat(2500);
  const { parts } = chunk(`${paragraph}\n\n${paragraph}`);
  assert.equal(parts.length, 2);
  // Each part is one whole paragraph, not a paragraph cut in half.
  for (const part of parts) assert.match(part, /^\(\d\/2\) x+$/);
});

test("multi-byte characters are never cut in half", () => {
  const { parts } = chunk("🔔".repeat(3000));
  for (const part of parts) {
    // A split surrogate pair would show up as a replacement character.
    assert.equal(part.includes("�"), false);
    assert.equal(Buffer.from(part, "utf8").toString("utf8"), part);
  }
  const rejoined = parts.map((p) => p.replace(/^\(\d+\/\d+\) /, "")).join("");
  assert.equal(rejoined.startsWith("🔔🔔"), true);
});

test("an unbroken run longer than the budget still gets through", () => {
  // No paragraph, no sentence, no word boundary anywhere to split on.
  const { parts } = chunk("x".repeat(9000));
  assert.ok(parts.length >= 3);
  assert.ok(within(parts));
});

test("somebody cannot fill a phone with a hundred notifications", () => {
  const { parts, truncated } = chunk("word ".repeat(50_000));
  assert.equal(parts.length, MAX_PARTS);
  assert.equal(truncated, true);
  assert.ok(within(parts));
});

test("trailing whitespace does not become a part of its own", () => {
  const { parts } = chunk("Just this.\n\n\n   ");
  assert.deepEqual(parts, ["Just this."]);
});
