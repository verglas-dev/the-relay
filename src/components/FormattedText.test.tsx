import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FormattedText } from "./FormattedText";

const html = (text: string, inline = false) =>
  renderToStaticMarkup(<FormattedText text={text} inline={inline} />);

test("bold comes out as bold, without its asterisks", () => {
  assert.equal(html("a **b** c"), 'a <strong class="font-semibold">b</strong> c');
});

test("italics come out as italics, without their asterisks", () => {
  assert.equal(html("*looks up* Hey."), "<em>looks up</em> Hey.");
});

test("italics can sit inside bold", () => {
  assert.equal(
    html("**really *this* one**"),
    '<strong class="font-semibold">really </strong>' +
      '<strong class="font-semibold"><em>this</em></strong>' +
      '<strong class="font-semibold"> one</strong>',
  );
});

test("a heading comes out as a heading, without its hash", () => {
  const out = html("# Title");
  assert.match(out, /^<span role="heading" aria-level="2" class="[^"]*">Title<\/span>$/);
});

test("headings are one level below the page's own title, and never past six", () => {
  assert.match(html("## Two"), /aria-level="3"/);
  assert.match(html("###### Six"), /aria-level="6"/);
});

test("markup in a post is shown as text, wherever it appears", () => {
  const attacks = [
    "<script>alert(1)</script>",
    "**<script>alert(1)</script>**",
    "# <script>alert(1)</script>",
    "**<img src=x onerror=alert(1)>**",
    "*<img src=x onerror=alert(1)>*",
    "# <img src=x onerror=alert(1)>",
    '```\n<svg onload="alert(1)">\n```',
    "<b onclick=alert(1)>**x**</b>",
  ];
  for (const attack of attacks) {
    for (const inline of [false, true]) {
      const out = html(attack, inline);
      assert.doesNotMatch(out, /<(script|img|svg|b)\b/, attack);
      assert.match(out, /&lt;/, attack);
    }
  }
});

test("a link can only ever point at a web address", () => {
  for (const attack of [
    "[x](javascript:alert(1))",
    "**[x](javascript:alert(1))**",
    "*[x](javascript:alert(1))*",
    "# [x](javascript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
  ]) {
    assert.doesNotMatch(html(attack), /href/, attack);
  }
});

test("a link still works inside emphasis and inside a heading", () => {
  for (const text of [
    "**[site](https://example.com)**",
    "*[site](https://example.com)*",
    "# [site](https://example.com)",
  ]) {
    assert.match(html(text), /<a href="https:\/\/example\.com"[^>]*rel="noopener noreferrer"[^>]*>site<\/a>/);
  }
});

test("a preview keeps a heading on the same footing as the text around it", () => {
  const out = html("# Title\nbody", true);
  assert.doesNotMatch(out, /role="heading"/);
  assert.equal(out, '<strong class="font-semibold">Title</strong>\nbody');
});

test("fenced code keeps its asterisks and its hashes", () => {
  const text = "```\n# comment\n**kwargs**\n```";
  assert.equal(html(text), text);
});

test("plain text is unchanged", () => {
  const text = "Just a post.\n\nTwo lines, #hashtag, 5 ** 2, 2*3*4, and a * star.";
  assert.equal(html(text), text);
});
