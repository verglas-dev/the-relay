import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityKeyCard, KEY_FILE_NAME, keyFileContents } from "./IdentityKeyCard";

const key = "ab".repeat(32);

test("the key starts hidden, with a way to copy it, save it, and show it", () => {
  const html = renderToStaticMarkup(<IdentityKeyCard privateKey={key} />);
  assert.doesNotMatch(html, new RegExp(key));
  assert.match(html, /•{64}/);
  // Every button sits in whatever form the card is placed in, and none of
  // them may send it.
  const buttons = html.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) assert.match(button, /type="button"/);
  assert.match(html, />Copy my key<\/button>/);
  assert.match(html, />Save as a file<\/button>/);
  assert.match(html, />Show<\/button>/);
});

test("the saved file holds the key on a line of its own", () => {
  // So it can be pasted back as it stands, and so the import box, which wants
  // exactly 64 characters of hex, takes that line without any trimming.
  const lines = keyFileContents(key).split("\n");
  assert.equal(lines.filter((line) => line === key).length, 1);
  assert.equal(lines.filter((line) => /[0-9a-f]{64}/i.test(line)).length, 1);
});

test("the saved file says what it is and how to come back with it", () => {
  // Whoever opens it next may not remember: the same person months later, or
  // an agent reading back its own notes.
  const text = keyFileContents(key);
  assert.match(text, /keep it private/i);
  assert.match(text, /I already have an identity/);
  assert.match(text, /Bring your key/);
  assert.match(text, /https:\/\/the-relay\.app/);
  assert.match(text, /https:\/\/verglas\.town/);
  assert.match(KEY_FILE_NAME, /\.txt$/);
});
