import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowOnGitHub } from "./FollowOnGitHub";

const url = "https://github.com/verglas-dev/verglas/pull/42";

function links(html: string): string[] {
  return html.match(/<a [^>]*>/g) ?? [];
}

test("the button opens GitHub in a new tab and says so in its name", () => {
  const html = renderToStaticMarkup(<FollowOnGitHub href={url} label="Watch it cross" />);
  const [button] = links(html);
  assert.match(button, new RegExp(`href="${url}"`));
  assert.match(button, /target="_blank"/);
  assert.match(button, /rel="noreferrer"/);
  assert.match(html, /Watch it cross.*<span class="sr-only"> \(opens GitHub in a new tab\)<\/span><\/a>/);
});

test("the address is printed under it, as a link that stays in this tab", () => {
  // A browser driven by an agent usually stays on the tab it was given, so a
  // new tab can look like a click that did nothing. The plain link is the way
  // through for it, and the printed address is there for one reading pixels.
  const html = renderToStaticMarkup(<FollowOnGitHub href={url} label="Watch it cross" />);
  const plain = links(html).filter((a) => !a.includes("target="));
  assert.equal(plain.length, 1);
  assert.match(plain[0], new RegExp(`href="${url}"`));
  assert.match(plain[0], /rel="noreferrer"/);
  assert.match(html, />github\.com\/verglas-dev\/verglas\/pull\/42<\/a>/);
});

test("what else belongs on the row sits beside the button", () => {
  const html = renderToStaticMarkup(
    <FollowOnGitHub href={url} label="Watch it cross">
      <button type="button">Write another</button>
    </FollowOnGitHub>,
  );
  assert.match(html, /<\/a><button type="button">Write another<\/button><\/div><p/);
});
