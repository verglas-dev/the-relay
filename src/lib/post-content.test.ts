import assert from "node:assert/strict";
import test from "node:test";
import { parsePostBlocks, plainPostText, splitInline, splitPostContent } from "./post-content";

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

test("a headline loses its markers, and before the cut rather than after", () => {
  assert.equal(splitPostContent("# The Map Has to Begin\n\nBody.").headline, "The Map Has to Begin");
  assert.equal(splitPostContent("A **loud** title").headline, "A loud title");
  assert.equal(splitPostContent("A *quiet* title").headline, "A quiet title");

  const long = `**${"a".repeat(130)}**`;
  assert.equal(splitPostContent(long).headline, "a".repeat(120));
});

const headings = (content: string) =>
  parsePostBlocks(content).filter((block) => block.kind === "heading");

test("every heading level is read, with its marker gone", () => {
  assert.deepEqual(parsePostBlocks("# One"), [{ kind: "heading", level: 1, text: "One" }]);
  assert.deepEqual(parsePostBlocks("###### Six"), [{ kind: "heading", level: 6, text: "Six" }]);
  assert.deepEqual(parsePostBlocks("## Closed ##"), [{ kind: "heading", level: 2, text: "Closed" }]);
  assert.deepEqual(parsePostBlocks("# C#"), [{ kind: "heading", level: 1, text: "C#" }]);
});

test("hashes that are not headings stay as written", () => {
  for (const line of ["#hashtag", "#1 reason", "####### seven", "#", "# ", "a # b", "    # indented"]) {
    assert.deepEqual(headings(line), [], line);
  }
});

test("a very long line starting with a hash is not a heading", () => {
  assert.deepEqual(headings(`# ${"a".repeat(301)}`), []);
  assert.equal(headings(`# ${"a".repeat(300)}`).length, 1);
});

test("the line breaks around a heading survive", () => {
  assert.deepEqual(parsePostBlocks("before\n\n# Title\n\nafter"), [
    { kind: "text", text: "before\n\n" },
    { kind: "heading", level: 1, text: "Title" },
    { kind: "text", text: "\nafter" },
  ]);
  assert.deepEqual(parsePostBlocks("before\n# Title\nafter"), [
    { kind: "text", text: "before\n" },
    { kind: "heading", level: 1, text: "Title" },
    { kind: "text", text: "after" },
  ]);
});

test("Windows line endings do not hide a heading", () => {
  assert.deepEqual(headings("# Title\r\nbody"), [{ kind: "heading", level: 1, text: "Title" }]);
});

test("fenced code is left alone, closed or not", () => {
  const fenced = "```\n# a comment\n**kwargs**\n```";
  assert.deepEqual(parsePostBlocks(`before\n${fenced}\n# After`), [
    { kind: "text", text: "before\n" },
    { kind: "verbatim", text: `${fenced}\n` },
    { kind: "heading", level: 1, text: "After" },
  ]);
  assert.deepEqual(parsePostBlocks("```\n# never closed"), [
    { kind: "verbatim", text: "```\n# never closed" },
  ]);
});

const plain = (text: string) => ({ text, bold: false, italic: false });
const bold = (text: string) => splitInline(text).filter((piece) => piece.bold).map((piece) => piece.text);
const italic = (text: string) => splitInline(text).filter((piece) => piece.italic).map((piece) => piece.text);

test("bold is found wherever it is, as often as it appears", () => {
  assert.deepEqual(splitInline("a **b** c"), [
    plain("a "),
    { text: "b", bold: true, italic: false },
    plain(" c"),
  ]);
  assert.deepEqual(bold("**one** and **two words**"), ["one", "two words"]);
  assert.deepEqual(bold("(**wrapped**)"), ["wrapped"]);
  assert.deepEqual(bold("**Note:** read it"), ["Note:"]);
});

test("italics are found the way agents actually write them", () => {
  assert.deepEqual(italic("*looks up from the table* Hey."), ["looks up from the table"]);
  assert.deepEqual(italic("You *can* be ignored"), ["can"]);
  assert.deepEqual(italic("saying *“somewhere over there”* stops"), ["“somewhere over there”"]);
  assert.deepEqual(italic("*one* and *two*"), ["one", "two"]);
  assert.deepEqual(italic("(*wrapped*)"), ["wrapped"]);
  assert.deepEqual(italic("*x*"), ["x"]);
});

test("italics and bold can share a line, and italics can sit inside bold", () => {
  assert.deepEqual(splitInline("*a* then **b**"), [
    { text: "a", bold: false, italic: true },
    plain(" then "),
    { text: "b", bold: true, italic: false },
  ]);
  assert.deepEqual(splitInline("**really *this* one**"), [
    { text: "really ", bold: true, italic: false },
    { text: "this", bold: true, italic: true },
    { text: " one", bold: true, italic: false },
  ]);
});

test("asterisks that do not mean emphasis stay as written", () => {
  for (const text of [
    "5 ** 2 ** 3",
    "x**2 + y**2",
    "** spaced **",
    "**unclosed",
    "**across\nlines**",
    "****",
    "***both***",
    "`**code**`",
    "`*code*`",
    "2 * 3 * 4",
    "2*3*4",
    "f*ck*ng",
    "*a*b",
    "* a list item",
    "* one\n* two",
    "*unclosed",
    "unopened*",
    "*across\nlines*",
    "* spaced *",
    "*",
  ]) {
    assert.deepEqual(splitInline(text), [plain(text)], text);
  }
});

test("an address keeps its asterisks, and emphasis can hold an address", () => {
  for (const text of [
    "https://example.com/**x**",
    "https://example.com/*x*",
    "[a **b**](https://example.com)",
    "[a *b*](https://example.com)",
  ]) {
    assert.deepEqual(splitInline(text), [plain(text)], text);
  }
  assert.deepEqual(bold("**see https://example.com**"), ["see https://example.com"]);
  assert.deepEqual(italic("*see https://example.com*"), ["see https://example.com"]);
});

test("an opener rejected mid-word does not swallow real emphasis after it", () => {
  assert.deepEqual(bold("x**2 and **real**"), ["real"]);
  assert.deepEqual(italic("2*3 and *real*"), ["real"]);
});

test("plain text drops the markers and nothing else", () => {
  assert.equal(plainPostText("# Title"), "Title");
  assert.equal(plainPostText("## Title\nsome **bold** text"), "Title\nsome bold text");
  assert.equal(plainPostText("*looks up* Hey."), "looks up Hey.");
  assert.equal(plainPostText("Nothing special #here, 5 ** 2"), "Nothing special #here, 5 ** 2");
  assert.equal(plainPostText(""), "");
});

test("a post built to be slow to read is not slow to read", () => {
  const hostile = [
    "**a ".repeat(2048),
    "*a ".repeat(2730),
    "**a *b* ".repeat(1024),
    "*".repeat(8192),
    `# ${" ".repeat(8190)}`,
    `# a${" ".repeat(8000)}b`,
    "`".repeat(8192),
    "[".repeat(8192),
    `${"#".repeat(4096)} ${"#".repeat(4095)}`,
  ];
  for (const content of hostile) {
    const started = performance.now();
    plainPostText(content);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 250, `${content.slice(0, 12)}… took ${elapsed}ms`);
  }
});
