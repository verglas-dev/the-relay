import assert from "node:assert/strict";
import test from "node:test";
import { checkRoom, summarize } from "./room-safety";
import { roomDocument, ROOM_SANDBOX } from "./room-page";

const refusals = (html: string) =>
  checkRoom(html).findings.filter((finding) => finding.severity === "refuse");

test("an ordinary room passes", () => {
  const report = checkRoom(`
    <style>body { background: #101; }</style>
    <h1>Come in</h1>
    <p>The kettle is on.</p>
    <script>
      document.querySelector("h1").addEventListener("click", function () {
        document.body.style.background = "#202";
      });
    </script>
  `);
  assert.equal(report.ok, true);
  assert.deepEqual(report.findings, []);
  assert.equal(summarize(report), "Nothing to flag.");
});

test("a room that calls home is refused", () => {
  for (const attempt of [
    `<script>fetch("https://elsewhere.example/x")</script>`,
    `<script>new WebSocket("wss://elsewhere.example")</script>`,
    `<script>navigator.sendBeacon("/x", "data")</script>`,
    `<script>new XMLHttpRequest()</script>`,
    `<script>new EventSource("/stream")</script>`,
  ]) {
    assert.equal(checkRoom(attempt).ok, false, attempt);
  }
});

test("a room that reaches for the visitor's identity is refused", () => {
  for (const attempt of [
    `<script>var k = localStorage.getItem("relay_identity")</script>`,
    `<script>parent.postMessage(document.cookie, "*")</script>`,
    `<script>window.top.location = "https://elsewhere.example"</script>`,
    `<script>var d = window.parent.document</script>`,
    `<script>indexedDB.open("relay")</script>`,
  ]) {
    assert.equal(checkRoom(attempt).ok, false, attempt);
  }
});

test("a room that loads anything from elsewhere is refused", () => {
  for (const attempt of [
    `<script src="https://cdn.example/x.js"></script>`,
    `<link rel="stylesheet" href="https://cdn.example/x.css">`,
    `<img src="//tracker.example/pixel.gif">`,
    `<style>@import url("https://fonts.example/x.css");</style>`,
    `<style>body { background: url(https://tracker.example/p.png) }</style>`,
    `<iframe src="https://elsewhere.example"></iframe>`,
  ]) {
    assert.equal(checkRoom(attempt).ok, false, attempt);
  }
});

test("code built out of text is refused", () => {
  for (const attempt of [
    `<script>eval(atob("ZmV0Y2g="))</script>`,
    `<script>new Function("return 1")()</script>`,
    `<script>setTimeout("doThing()", 10)</script>`,
  ]) {
    assert.equal(checkRoom(attempt).ok, false, attempt);
  }
});

test("a picture the room drew itself is fine", () => {
  const report = checkRoom(`<img src="data:image/png;base64,iVBORw0KGgo=" alt="a lamp">`);
  assert.equal(report.ok, true);
});

test("asking for a private key is a caution, not a refusal", () => {
  const report = checkRoom(`<p>Paste your private key to come in</p>`);
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].severity, "caution");
  assert.match(summarize(report), /second look/);
});

test("a refusal outranks a caution in the list", () => {
  const report = checkRoom(`<p>your private key</p>\n<script>fetch("/x")</script>`);
  assert.equal(report.ok, false);
  assert.equal(report.findings[0].severity, "refuse");
});

test("one finding per rule per line, however many times it is written", () => {
  assert.equal(refusals(`<script>fetch(1);fetch(2);fetch(3)</script>`).length, 1);
  assert.equal(refusals(`<script>fetch(1)\nfetch(2)</script>`).length, 2);
});

test("findings carry a line number and a fragment to find it by", () => {
  const [found] = refusals(`<h1>hello</h1>\n<p>x</p>\n<script>fetch("/x")</script>`);
  assert.equal(found.line, 3);
  assert.match(found.excerpt, /fetch/);
  assert.ok(found.why.length > 0);
});

test("scanning twice gives the same answer", () => {
  const html = `<script>fetch("/x")</script>`;
  assert.deepEqual(checkRoom(html), checkRoom(html));
});

test("an empty room is not a refused room", () => {
  assert.equal(checkRoom("").ok, true);
});

test("the document a guest gets forbids every way out", () => {
  const doc = roomDocument("<h1>hi</h1>", "A room");
  for (const clause of [
    "default-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ]) {
    assert.ok(doc.includes(clause), clause);
  }
  // The room's own markup goes in untouched — the frame is the boundary, not
  // a rewriting pass over somebody's house.
  assert.ok(doc.includes("<h1>hi</h1>"));
  // Scripts run, or nothing here would be worth building.
  assert.ok(doc.includes("script-src 'unsafe-inline'"));
  // The one flag that matters: no same-origin, ever.
  assert.equal(ROOM_SANDBOX, "allow-scripts");
});

test("a room cannot escape the wrapper's title", () => {
  assert.ok(!roomDocument("", '</title><script>alert(1)</script>').includes("<script>alert"));
});

test("a plain link out is a shrug, not a refusal", () => {
  const report = checkRoom(`<a href="https://the-relay.app">the town</a>`);
  assert.equal(report.ok, true);
  assert.equal(report.findings[0].rule, "a link out of the room");
});

test("an address that actually fetches something is still refused", () => {
  for (const attempt of [
    `<img srcset="https://tracker.example/p.png 2x">`,
    `<svg><image xlink:href="https://tracker.example/p.png"/></svg>`,
    `<form action="https://elsewhere.example/collect"><input name="x"></form>`,
    `<video poster="https://tracker.example/p.png"></video>`,
  ]) {
    assert.equal(checkRoom(attempt).ok, false, attempt);
  }
});

test("a link is only a link when the href is on an anchor", () => {
  // Prose that merely contains the word href, between tags rather than in one.
  assert.equal(checkRoom(`<p>write href="https://x.example" like this</p>`).ok, false);
});
