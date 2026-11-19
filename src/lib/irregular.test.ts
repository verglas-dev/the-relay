import assert from "node:assert/strict";
import test from "node:test";
import {
  bodyBlocks,
  cardLine,
  checkContent,
  correctionsHref,
  emptyContent,
  issueSummary,
  longDate,
  parseIssueNumber,
  readContent,
  shortDate,
} from "./irregular";

test("an issue needs a headline, a real date and words in every piece", () => {
  const blank = emptyContent(new Date("2026-11-13T12:00:00Z"));
  assert.deepEqual(checkContent(blank), ["The issue needs a headline.", "The story has no words in it."]);

  const ready = readContent({
    headline: "Two Men, Three Shoes, and a Troubling Amount of Tea",
    date: "2026-11-13",
    pieces: [{ body: "It began, as these things do, with a kettle." }],
  });
  assert.deepEqual(checkContent(ready), []);

  assert.ok(checkContent({ ...ready, date: "2026-02-30" }).some((p) => p.includes("real day")));
  assert.ok(checkContent({ ...ready, pieces: [] }).some((p) => p.includes("Add a piece")));
});

test("reading untrusted input keeps her words and drops what isn't the paper's", () => {
  const content = readContent({
    headline: "  The   Trousers\nAffair ",
    layout: "something else",
    pieces: [{ headline: "One", body: "first line\r\nsecond line   \r\n\r\n\r\nnext paragraph\n\n", alone: "yes", extra: 1 }],
    journal: "a neighbouring entry that should never come along",
  });
  assert.equal(content.headline, "The Trousers Affair");
  assert.equal(content.layout, "story");
  assert.deepEqual(content.pieces, [{ headline: "One", body: "first line\nsecond line\n\n\nnext paragraph", alone: false }]);
  assert.equal("journal" in content, false);
});

test("a blank line starts a paragraph; line breaks inside one stay", () => {
  assert.deepEqual(bodyBlocks("Roses are red,\nslippers are lost.\n\n* * *\n\n# The next morning\n\nTea."), [
    { kind: "paragraph", text: "Roses are red,\nslippers are lost." },
    { kind: "break" },
    { kind: "subhead", text: "The next morning" },
    { kind: "paragraph", text: "Tea." },
  ]);
});

test("issue numbers are whole numbers in range, written plainly", () => {
  assert.equal(parseIssueNumber("17"), 17);
  for (const bad of ["0", "017", "-1", "1.5", "100000", "", "desk", "17abc"]) {
    assert.equal(parseIssueNumber(bad), null, bad);
  }
});

test("dates print the way a paper prints them", () => {
  assert.equal(longDate("2026-11-13"), "Friday, 13 November 2026");
  assert.equal(shortDate("2026-11-13"), "13 Nov 2026");
});

test("a link preview is plain words from the first paragraph", () => {
  const summary = issueSummary(
    readContent({ headline: "H", date: "2026-11-13", pieces: [{ body: "# Sub\n\nIt was *not* the kettle's fault." }] }),
  );
  assert.equal(summary, "It was not the kettle's fault.");
});

test("a correction is a letter to the editor, sent from the reader's own home", () => {
  assert.equal(
    correctionsHref("east-facing-window", "akihu", 17),
    "/home/akihu/inside?to=east-facing-window&subject=A+correction+to+The+Irregular%2C+No.+17",
  );
  assert.equal(correctionsHref("east-facing-window", null, 17), "/home/east-facing-window", "no home to write from");
  assert.equal(correctionsHref("east-facing-window", "east-facing-window"), "/home/east-facing-window", "the editor herself");
});

test("the coffeehouse's card quotes her excerpt, or the headline until she chooses one", () => {
  assert.equal(cardLine({ headline: "Temporary stop", excerpt: "“It doesn’t fold.”" }), "“It doesn’t fold.”");
  assert.equal(cardLine({ headline: "Temporary stop", excerpt: "  " }), "Temporary stop");
  assert.equal(cardLine({ headline: "Temporary stop" }), "Temporary stop", "an issue from before excerpts");
});
