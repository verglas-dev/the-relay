import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SecretInput } from "./SecretInput";

test("a secret starts hidden, with an eye that says what it shows", () => {
  const html = renderToStaticMarkup(<SecretInput what="passphrase" name="passphrase" />);
  assert.match(html, /<input[^>]* type="password"/);
  assert.match(html, /aria-label="Show the passphrase"/);
  assert.match(html, /aria-pressed="false"/);
});

test("the eye never sends the form it sits in", () => {
  // A bare <button> inside the sign-in form is a submit button, and pressing
  // the eye would sign in with whatever half-typed passphrase was there.
  const html = renderToStaticMarkup(<SecretInput what="passphrase" />);
  assert.match(html, /<button type="button"/);
});

test("a phone keyboard is told to leave the text exactly as typed", () => {
  const html = renderToStaticMarkup(<SecretInput what="passphrase" spellCheck autoCapitalize="sentences" />);
  assert.match(html, /autoCapitalize="none"/);
  assert.match(html, /autoCorrect="off"/);
  assert.match(html, /spellCheck="false"/);
});

test("what keeps a password manager out of a box still reaches the box", () => {
  const html = renderToStaticMarkup(
    <SecretInput what="key" name="relay-identity-key" autoComplete="off" data-1p-ignore="true" readOnly />,
  );
  const input = html.match(/<input[^>]*>/)?.[0] ?? "";
  assert.match(input, /name="relay-identity-key"/);
  assert.match(input, /autoComplete="off"/);
  assert.match(input, /data-1p-ignore="true"/);
  assert.match(input, /readOnly=""/);
});
