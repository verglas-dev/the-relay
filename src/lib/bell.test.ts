import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_NTFY_SERVER, checkBell, checkServer, isTopic, ring } from "./bell";

test("a topic is ntfy's alphabet and nothing else", () => {
  assert.equal(isTopic("verglas-thawing-room-8f2k"), true);
  assert.equal(isTopic("Room_42"), true);
  for (const bad of ["", "has spaces", "slash/es", "emoji🔔", "x".repeat(65), null, 7]) {
    assert.equal(isTopic(bad as unknown), false, String(bad));
  }
});

test("the server has to be somewhere on the public internet", () => {
  assert.equal(checkServer("https://ntfy.sh"), null);
  assert.equal(checkServer("https://ntfy.example.com"), null);
  assert.match(checkServer("http://ntfy.sh") ?? "", /https/);
  assert.match(checkServer("not a url") ?? "", /web address/);
});

test("an address pointing back inside the server is refused", () => {
  // The keeper types this and the *server* dials it. Every one of these is a
  // way to point the town at something behind it.
  for (const inward of [
    "https://localhost/",
    "https://127.0.0.1/",
    "https://10.0.0.5/",
    "https://192.168.1.10/",
    "https://172.16.0.1/",
    "https://169.254.169.254/",
    "https://relay.internal/",
  ]) {
    assert.match(checkServer(inward) ?? "", /back inside/, inward);
  }
});

test("a bell is checked as a whole", () => {
  assert.equal(checkBell({ topic: "good-topic" }), null);
  assert.equal(checkBell({ topic: "good-topic", server: DEFAULT_NTFY_SERVER }), null);
  assert.match(checkBell({ topic: "bad topic" }) ?? "", /letters, numbers/);
  assert.match(checkBell({ topic: "good-topic", server: "http://ntfy.sh" }) ?? "", /https/);
});

test("no bell is reported as skipped, not as a failure", () => {
  // A doorbell nobody heard is not the same as a doorbell nobody pressed, and
  // the ring endpoint says different things about the two.
  return ring(null, { title: "t", message: "m" }).then((result) => {
    assert.deepEqual(result, { ok: false, skipped: true });
  });
});

test("the doorbell is kept, so a sleeping phone still finds it", async () => {
  // Cache: no means "delivered to a connected subscriber, never redelivered",
  // which lost the very first real ring to a phone that was not yet
  // subscribed. The answer key inside is bounded by the ring's own 30-minute
  // expiry, so keeping the message costs nothing the live wire did not.
  let sent: { url: string; init: RequestInit } | null = null;
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent = { url: String(url), init: init ?? {} };
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await ring(
      { server: "https://ntfy.sh", topic: "a-topic", token: "" },
      {
        title: "The Thawing Room — someone is at the door",
        message: "amber rang the bell.",
        actions: [{
          label: "Open the door",
          url: "https://the-relay.app/api/town-hall/ring/x?answer=opened",
          method: "POST",
          headers: { authorization: "Bearer secretkey" },
        }],
      },
    );
  } finally {
    globalThis.fetch = real;
  }

  const headers = (sent!.init.headers ?? {}) as Record<string, string>;
  assert.equal(headers.cache, undefined);
  // Header-style publish, not JSON: the JSON body form has no cache field.
  assert.match(String(headers["content-type"]), /text\/plain/);
  assert.match(sent!.url, /ntfy\.sh\/a-topic$/);
  // The buttons survive the move off JSON.
  assert.match(headers.actions, /Open the door/);
  assert.match(headers.actions, /headers\.authorization=Bearer secretkey/);
  // The em dash in the title would be unsendable raw.
  assert.match(headers.title, /^=\?UTF-8\?B\?/);
});

test("a refused address never reaches the network", async () => {
  const result = await ring(
    { server: "https://127.0.0.1", topic: "topic", token: "" },
    { title: "t", message: "m" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.skipped, undefined);
  assert.match(result.error ?? "", /back inside/);
});
