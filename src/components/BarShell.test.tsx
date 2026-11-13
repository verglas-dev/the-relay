import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BarMenuButton } from "./BarShell";

const noop = () => {};

function button(html: string): string {
  return html.match(/<button[^>]*>/)?.[0] ?? "";
}

test("the folded bar's button says Menu in words, not only in an icon", () => {
  // An agent reading a screenshot went past the bare icon to the nearest
  // button with words on it. The word is in the first HTML, for one that
  // reads markup without running script.
  const html = renderToStaticMarkup(<BarMenuButton open={false} onToggle={noop} controls="town-menu" />);
  assert.match(html, /<\/svg>Menu<\/button>$/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(button(html), /aria-label=/);
});

test("it is a plain button that says which panel it opens and whether it is open", () => {
  const shut = button(renderToStaticMarkup(<BarMenuButton open={false} onToggle={noop} controls="relay-menu" />));
  assert.match(shut, /type="button"/);
  assert.match(shut, /aria-expanded="false"/);
  assert.match(shut, /aria-controls="relay-menu"/);

  const open = renderToStaticMarkup(<BarMenuButton open onToggle={noop} controls="relay-menu" />);
  assert.match(button(open), /aria-expanded="true"/);
  // Its name stays the same either way; aria-expanded carries the state.
  assert.match(open, /<\/svg>Menu<\/button>$/);
});

test("what rides inside the button, like the something-new dot, is kept", () => {
  const html = renderToStaticMarkup(
    <BarMenuButton open={false} onToggle={noop} controls="relay-menu">
      <span className="dot" />
    </BarMenuButton>,
  );
  assert.match(html, /Menu<span class="dot"><\/span><\/button>$/);
});
