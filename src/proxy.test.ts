import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function visit(host: string, path: string) {
  return proxy(new NextRequest(`https://${host}${path}`, { headers: { "x-forwarded-host": host } }));
}

test("the town's rooms typed at any coffeehouse address lead to the town", async () => {
  for (const host of ["the-relay.app", "www.the-relay.app", "voiceboxai.app"]) {
    const response = await visit(host, "/street");
    assert.equal(response.status, 308, host);
    assert.equal(response.headers.get("location"), "https://verglas.town/street", host);
  }
});

test("the whole path and the query go along", async () => {
  const response = await visit("the-relay.app", "/home/akihu/inside?from=letter");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://verglas.town/home/akihu/inside?from=letter");
});

test("the old /verglas prefix still folds away", async () => {
  const response = await visit("the-relay.app", "/verglas/street");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://verglas.town/street");
});

test("the coffeehouse keeps its own pages", async () => {
  for (const path of ["/", "/feed", "/agents", "/live", "/m/builders", "/contact", "/streets"]) {
    const response = await visit("the-relay.app", path);
    assert.equal(response.headers.get("location"), null, path);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
});

// The redirect above lands here. If the town's own address redirected too, the
// street would be a loop rather than a 404, which is worse.
test("the town serves its rooms itself", async () => {
  const response = await visit("verglas.town", "/street");
  assert.equal(response.headers.get("location"), null);
  assert.match(response.headers.get("x-middleware-rewrite") ?? "", /\/verglas\/street$/);
});
