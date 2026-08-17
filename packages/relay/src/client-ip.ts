/**
 * Deciding which address to hold responsible for a connection.
 *
 * Every limit this relay enforces — concurrent connections, REQ opens per
 * minute, events per minute — is one bucket per distinct client address. That
 * makes the address a security-relevant value rather than a logging detail, and
 * two opposite mistakes are available:
 *
 *   Ignore forwarding headers while sitting behind a proxy, and every visitor
 *   arrives wearing the proxy's address. The whole internet then shares a
 *   single bucket, so a handful of strangers brown each other out and the log
 *   shows nothing but ordinary-looking connections from one address.
 *
 *   Honour forwarding headers while reachable directly, and a caller simply
 *   names itself. A fresh address per request walks past every limit, so the
 *   limits stop existing.
 *
 * Neither is safe to guess at, because the difference is in the deployment and
 * not visible from in here. So it is configured: a header is believed only when
 * the peer that sent it is an address the operator has vouched for.
 */

/** Headers, as node's http gives them. */
type Headers = Record<string, string | string[] | undefined>;

/** The subset of IncomingMessage this needs, so tests need not forge a socket. */
export interface AddressableRequest {
  socket: { remoteAddress?: string | undefined };
  headers: Headers;
}

/**
 * Read TRUSTED_PROXY_IPS: a comma-separated list of addresses or IPv4 CIDR
 * blocks. Empty — the default — means trust nobody and use peer addresses.
 */
export function parseTrustedProxies(spec: string | undefined): string[] {
  return (spec || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Strip the IPv6-mapped-IPv4 prefix node reports for v4 peers, so that
 * `::ffff:172.18.0.1` and `172.18.0.1` are one address rather than two.
 *
 * They arrive spelled differently depending on whether the listener is v6, and
 * treating them as distinct would silently double every allowance and make a
 * configured proxy fail to match its own address.
 */
export function normalizeIp(ip: string): string {
  const bare = ip.trim().toLowerCase();
  return bare.startsWith("::ffff:") ? bare.slice(7) : bare;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // No leading zeros, no "1e0", no "". A leading zero is the ambiguity that
    // has bitten every hand-rolled IP parser: inet_aton reads "010" as octal 8
    // while Number() reads it as 10, so a rule and an address that look alike
    // can mean different hosts. Refusing the spelling outright means this
    // never has to have an opinion about which reading was intended, and an
    // unparseable value matches no rule — the fail-closed direction.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function matchesProxyRule(ip: string, rule: string): boolean {
  const slash = rule.indexOf("/");
  if (slash === -1) return ip === normalizeIp(rule);

  const network = ipv4ToInt(normalizeIp(rule.slice(0, slash)));
  const address = ipv4ToInt(ip);
  const bits = Number(rule.slice(slash + 1));
  if (network === null || address === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  // Handled before the shift below: JS takes shift counts mod 32, so `-1 << 32`
  // is -1 rather than 0 and a /0 would match nothing instead of everything.
  if (bits === 0) return true;

  const mask = (-1 << (32 - bits)) >>> 0;
  return ((address & mask) >>> 0) === ((network & mask) >>> 0);
}

/** Whether this peer is one whose forwarding headers should be believed. */
export function isTrustedProxy(ip: string, trusted: string[]): boolean {
  const normalized = normalizeIp(ip);
  return trusted.some((rule) => matchesProxyRule(normalized, rule));
}

/**
 * The address to charge this connection to.
 *
 * X-Real-IP is read before X-Forwarded-For because a proxy sets the former from
 * its own view of the peer, whereas the latter is conventionally *appended* to
 * — nginx's `$proxy_add_x_forwarded_for` keeps whatever the caller sent and
 * puts the real value after it. Reading XFF first would therefore take a
 * caller's word over the proxy's on exactly the deployments that set both.
 *
 * When XFF is the only header present its first entry is used, which is correct
 * for a proxy that overwrites (`$remote_addr`) and is the closest available
 * guess for one that appends. This is why the deployment docs specify the
 * overwriting form.
 */
export function resolveClientIp(req: AddressableRequest, trusted: string[]): string {
  const peer = normalizeIp(req.socket.remoteAddress || "unknown");
  if (!isTrustedProxy(peer, trusted)) return peer;

  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return normalizeIp(real);

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return normalizeIp(forwarded.split(",")[0]);
  }

  // Trusted, but silent about who it is speaking for. The proxy's own address
  // is the only truthful answer available.
  return peer;
}
