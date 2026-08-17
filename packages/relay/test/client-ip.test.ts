import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTrustedProxy,
  normalizeIp,
  parseTrustedProxies,
  resolveClientIp,
  type AddressableRequest,
} from "../src/client-ip.js";

function request(remoteAddress: string, headers: Record<string, string> = {}): AddressableRequest {
  return { socket: { remoteAddress }, headers };
}

test("an untrusted peer cannot name itself", () => {
  const trusted = parseTrustedProxies("172.18.0.1");

  // The whole point of the allowlist: a direct caller inventing a fresh address
  // per request would otherwise get a fresh allowance per request.
  const forged = request("203.0.113.9", {
    "x-real-ip": "10.0.0.1",
    "x-forwarded-for": "10.0.0.2",
  });
  assert.equal(resolveClientIp(forged, trusted), "203.0.113.9");
});

test("a trusted peer's headers are believed, X-Real-IP first", () => {
  const trusted = parseTrustedProxies("172.18.0.1");

  assert.equal(
    resolveClientIp(request("172.18.0.1", { "x-real-ip": "203.0.113.9" }), trusted),
    "203.0.113.9",
  );

  // X-Forwarded-For appended by nginx carries the caller's own value ahead of
  // the real one, so preferring X-Real-IP is what keeps that from being read.
  const both = request("172.18.0.1", {
    "x-real-ip": "203.0.113.9",
    "x-forwarded-for": "10.0.0.1, 203.0.113.9",
  });
  assert.equal(resolveClientIp(both, trusted), "203.0.113.9");
});

test("X-Forwarded-For is the fallback when X-Real-IP is absent", () => {
  const trusted = parseTrustedProxies("172.18.0.1");
  const req = request("172.18.0.1", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
  assert.equal(resolveClientIp(req, trusted), "203.0.113.9");
});

test("a trusted peer that sends no headers is itself", () => {
  const trusted = parseTrustedProxies("172.18.0.1");
  assert.equal(resolveClientIp(request("172.18.0.1"), trusted), "172.18.0.1");
});

test("empty configuration trusts nobody", () => {
  const trusted = parseTrustedProxies(undefined);
  assert.deepEqual(trusted, []);

  const req = request("172.18.0.1", { "x-real-ip": "203.0.113.9" });
  assert.equal(resolveClientIp(req, trusted), "172.18.0.1");
});

test("IPv6-mapped IPv4 addresses are one address, not two", () => {
  assert.equal(normalizeIp("::ffff:172.18.0.1"), "172.18.0.1");
  assert.equal(normalizeIp("::FFFF:172.18.0.1"), "172.18.0.1");

  // Docker reports the mapped form; the operator writes the bare one.
  const trusted = parseTrustedProxies("172.18.0.1");
  assert.equal(isTrustedProxy("::ffff:172.18.0.1", trusted), true);

  const req = request("::ffff:172.18.0.1", { "x-real-ip": "::ffff:203.0.113.9" });
  assert.equal(resolveClientIp(req, trusted), "203.0.113.9");
});

test("CIDR rules match their own block and nothing outside it", () => {
  const trusted = parseTrustedProxies("172.18.0.0/16");

  assert.equal(isTrustedProxy("172.18.0.1", trusted), true);
  assert.equal(isTrustedProxy("172.18.255.254", trusted), true);
  assert.equal(isTrustedProxy("172.19.0.1", trusted), false);
  assert.equal(isTrustedProxy("172.17.255.255", trusted), false);
  assert.equal(isTrustedProxy("203.0.113.9", trusted), false);
});

test("boundary prefix lengths behave", () => {
  // /32 is a single host — the shift it computes is the one JS would botch if
  // the mask were built without care.
  const host = parseTrustedProxies("10.1.2.3/32");
  assert.equal(isTrustedProxy("10.1.2.3", host), true);
  assert.equal(isTrustedProxy("10.1.2.4", host), false);

  // /0 is everything, and is special-cased away from a mod-32 shift.
  const all = parseTrustedProxies("0.0.0.0/0");
  assert.equal(isTrustedProxy("203.0.113.9", all), true);

  // High addresses must not go negative through the sign bit.
  const high = parseTrustedProxies("240.0.0.0/4");
  assert.equal(isTrustedProxy("255.255.255.255", high), true);
  assert.equal(isTrustedProxy("239.255.255.255", high), false);
});

test("malformed rules and addresses match nothing rather than everything", () => {
  for (const rule of ["not-an-ip", "10.0.0.0/33", "10.0.0.0/-1", "10.0.0.0/x", "10.0.0.1.5/8", "999.0.0.1/8"]) {
    assert.equal(isTrustedProxy("10.0.0.1", parseTrustedProxies(rule)), false, `rule ${rule}`);
  }

  // Leading zeros are rejected rather than parsed as octal or decimal, so
  // "010.0.0.1" cannot be used to dodge a rule written for 10.0.0.1.
  assert.equal(isTrustedProxy("010.0.0.1", parseTrustedProxies("10.0.0.0/8")), false);
});

test("a list accepts any of its entries", () => {
  const trusted = parseTrustedProxies(" 172.18.0.1 , 10.0.0.0/8 ,, 192.168.1.5 ");
  assert.deepEqual(trusted, ["172.18.0.1", "10.0.0.0/8", "192.168.1.5"]);

  assert.equal(isTrustedProxy("172.18.0.1", trusted), true);
  assert.equal(isTrustedProxy("10.4.5.6", trusted), true);
  assert.equal(isTrustedProxy("192.168.1.5", trusted), true);
  assert.equal(isTrustedProxy("192.168.1.6", trusted), false);
});

test("a missing remote address does not become a shared bucket", () => {
  // "unknown" is at least honest, and does not collide with a real address.
  const req: AddressableRequest = { socket: {}, headers: {} };
  assert.equal(resolveClientIp(req, parseTrustedProxies("172.18.0.1")), "unknown");
});
