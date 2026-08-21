/**
 * The wire to a phone.
 *
 * ntfy carries two very different things for Verglas — a doorbell, and (once
 * a door opens) a conversation — so the transport lives here on its own and
 * knows about neither. It publishes, and it listens.
 *
 * **Header-style publish, not JSON.** The JSON body form is friendlier, and it
 * cannot do the one thing that matters most here: its field list has no
 * `cache`, so a message published as JSON is stored on the ntfy server for
 * twelve hours by default. `Cache: no` is an HTTP header and nothing else, and
 * a conversation that must leave no transcript cannot be sent any other way.
 * Actions are expressible as a header too, so nothing is lost by dropping JSON.
 *
 * Server-side only.
 */

export interface NtfyConfig {
  /** The ntfy server. `https://ntfy.sh` unless self-hosted. */
  server: string;
  /** The topic. A secret: whoever knows it can read and publish. */
  topic: string;
  /** Optional access token, for a server with protected topics. */
  token: string;
}

export const DEFAULT_NTFY_SERVER = "https://ntfy.sh";

/**
 * ntfy's own limit. Anything longer is silently turned into an *attachment* —
 * which is stored on the server, with its own expiry, exactly the thing a
 * no-transcript conversation must never produce. Callers chunk to stay under
 * it; this is the number they chunk against.
 */
export const MAX_MESSAGE_BYTES = 4096;

/** ntfy's rule: letters, numbers, underscore and hyphen. */
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isTopic(value: unknown): value is string {
  return typeof value === "string" && TOPIC_RE.test(value.trim());
}

/**
 * Is this somewhere we are willing to send a request?
 *
 * A keeper types this address and the *server* is what dials it, which makes
 * a bad one a way to point the town at things behind it. https only, a real
 * hostname, and none of the names that resolve inward. Not a complete defence
 * against a hostile DNS record, but it stops the whole class of mistake that
 * gets typed in by accident.
 */
export function checkServer(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That is not a web address.";
  }
  if (url.protocol !== "https:") return "An ntfy server has to be https.";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host === "[::1]" ||
    /^(?:127|10|0)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return "That address points back inside the server.";
  }
  return null;
}

/**
 * Make a header value safe to put on the wire.
 *
 * ntfy accepts UTF-8 in headers, but `fetch` will not send a header value
 * containing anything outside latin-1 — and the town writes em dashes and
 * curly quotes everywhere. RFC 2047 encoded-words are ntfy's own documented
 * answer for exactly this, so anything non-ASCII goes out base64-wrapped and
 * arrives on the phone as what was written.
 */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** One button on a notification. */
export interface NtfyAction {
  /**
   * `http` calls us back from the lock screen; `view` opens something on the
   * phone. A `view` pointing at `ntfy://<host>/<topic>` opens the ntfy app on
   * that topic and subscribes to it if it is new — which is how a keeper gets
   * into a per-session thread without ever typing a topic name.
   */
  type?: "http" | "view";
  label: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  clear?: boolean;
}

/**
 * Build the `Actions` header.
 *
 * `http, <label>, <url>, method=…, headers.<name>=…, clear=true`, actions
 * separated by semicolons. Values containing a comma or semicolon have to be
 * quoted, which is why labels are checked rather than trusted.
 */
function actionsHeader(actions: NtfyAction[]): string {
  const quote = (value: string) =>
    /[,;]/.test(value) ? `"${value.replace(/"/g, "")}"` : value;

  return actions
    .slice(0, 3)
    .map((action) => {
      const type = action.type ?? "http";
      const parts = [type, quote(action.label), quote(action.url)];
      if (type === "http") {
        if (action.method) parts.push(`method=${action.method}`);
        for (const [name, value] of Object.entries(action.headers ?? {})) {
          parts.push(`headers.${name}=${quote(value)}`);
        }
      }
      if (action.clear !== false) parts.push("clear=true");
      return parts.join(", ");
    })
    .join("; ");
}

export interface NtfyMessage {
  message: string;
  title?: string;
  tags?: string[];
  /** 1 (min) to 5 (max). */
  priority?: number;
  /** Where tapping the notification body goes. */
  click?: string;
  actions?: NtfyAction[];
  /**
   * Keep it on the server for twelve hours so a phone that was offline can
   * catch up. Default is **false** here, inverting ntfy's own default: in this
   * application the caller has to decide to leave a copy somewhere, rather
   * than leave one by not thinking about it.
   */
  cache?: boolean;
}

export interface NtfyResult {
  ok: boolean;
  /** Set when there is nowhere to send, as opposed to a failure. */
  skipped?: boolean;
  error?: string;
  /**
   * The id ntfy assigned, when it told us.
   *
   * Worth reading because a session both publishes to and listens on the same
   * topic, so everything we send comes straight back at us. Matching on ids is
   * how the echo is recognised — exactly, rather than by guessing from titles.
   */
  id?: string;
}

/** Send one message. Reports rather than throws. */
export async function publish(
  config: NtfyConfig | null,
  message: NtfyMessage,
): Promise<NtfyResult> {
  if (!config || !config.topic) return { ok: false, skipped: true };

  const server = (config.server || DEFAULT_NTFY_SERVER).replace(/\/+$/, "");
  const problem = checkServer(server);
  if (problem) return { ok: false, error: problem };

  const body = Buffer.from(message.message, "utf8");
  if (body.byteLength > MAX_MESSAGE_BYTES) {
    // Refused rather than sent: ntfy would quietly turn this into a stored
    // attachment, which is the one outcome the caller was trying to avoid.
    return { ok: false, error: "That message is too long to send in one piece." };
  }

  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    ...(message.cache ? {} : { cache: "no" }),
  };
  if (message.title) headers.title = encodeHeader(message.title);
  if (message.tags?.length) headers.tags = encodeHeader(message.tags.join(","));
  if (message.priority) headers.priority = String(message.priority);
  if (message.click) headers.click = message.click;
  if (message.actions?.length) headers.actions = encodeHeader(actionsHeader(message.actions));

  try {
    const response = await fetch(`${server}/${config.topic}`, {
      method: "POST",
      headers,
      body,
      // A hanging publish is a request holding a connection open on whatever
      // called it. Give up and let the caller record that it did not land.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });

    if (!response.ok) {
      // The status is safe to log and the body is not — an ntfy error can echo
      // the topic back, and the topic is the credential. A 429 here is the one
      // worth recognising: ntfy.sh rate-limits publishing and topic creation
      // per source address.
      console.error(`[verglas] ntfy refused a publish: ${response.status}`);
      return { ok: false, error: `Refused (${response.status}).` };
    }

    try {
      const body = (await response.json()) as { id?: string };
      return { ok: true, id: body.id };
    } catch {
      // A publish that worked but told us nothing useful is still a publish.
      return { ok: true };
    }
  } catch {
    return { ok: false, error: "Could not be reached." };
  }
}

/** One message coming the other way. */
export interface NtfyIncoming {
  id: string;
  time: number;
  event: string;
  topic: string;
  message?: string;
  title?: string;
  tags?: string[];
}

/**
 * Listen to a topic.
 *
 * `/json` streams one JSON object per line for as long as the connection is
 * held open, which is how a reply typed into the phone's message bar reaches
 * the town. `since=` is deliberately not passed: with `Cache: no` there is
 * nothing behind us to catch up on, and asking for history we hope does not
 * exist would be a strange way to keep a promise.
 *
 * Returns a function that stops listening.
 */
export function subscribe(
  config: NtfyConfig,
  onMessage: (message: NtfyIncoming) => void,
  onClosed?: (reason: string) => void,
): () => void {
  const server = (config.server || DEFAULT_NTFY_SERVER).replace(/\/+$/, "");
  const controller = new AbortController();
  let stopped = false;

  void (async () => {
    try {
      const response = await fetch(`${server}/${config.topic}/json`, {
        headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok || !response.body) {
        onClosed?.(`the topic could not be opened (${response.status})`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        buffer += decoder.decode(value, { stream: true });

        // One JSON object per line; a partial line stays in the buffer.
        let newline = buffer.indexOf("\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            try {
              onMessage(JSON.parse(line) as NtfyIncoming);
            } catch {
              // ntfy sends keepalives and open events too; anything this
              // cannot read is not a message.
            }
          }
          newline = buffer.indexOf("\n");
        }
      }
      onClosed?.("the connection ended");
    } catch (error) {
      if (!stopped) onClosed?.(error instanceof Error ? error.message : "the connection failed");
    }
  })();

  return () => {
    stopped = true;
    controller.abort();
  };
}
