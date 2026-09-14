"use client";

import type { RelayEvent, Filter } from "./types";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:4869";
const COLLECT_TIMEOUT_MS = 8000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 5000;
const RECONNECT_DELAY_MS = 3000;
const PUBLISH_TIMEOUT_MS = 5000;
// The HTTPS bridge allows 20 reads/minute per caller. Four polls/minute leaves
// room for page loads and one-shot collects without making live views go dark.
const HTTP_POLL_INTERVAL_MS = 15000;
const HTTP_PROBE_ID = "0".repeat(64);
// Neither end of an idle WebSocket is told when the other goes away: a phone's
// radio sleeping, a carrier NAT forgetting the flow, a laptop lid closing.
// The browser reports the socket open right up until something is sent into
// it and nothing comes back. So while a socket is open the client asks the
// relay for a sign of life at this interval, and drops the socket if none
// arrives in time — any message at all counts, since what is being checked is
// the link, not the answer.
const HEARTBEAT_INTERVAL_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 8000;

type EventCallback = (event: RelayEvent) => void;

export interface PublishResult {
  ok: boolean;
  message?: string;
}

interface Subscription {
  subId: string;
  filters: Filter[];
  onEvent: EventCallback;
  onEose?: () => void;
  seenEventIds: Set<string>;
  pollTimer?: ReturnType<typeof setTimeout>;
  pollGeneration?: number;
  httpEoseGeneration?: number;
}

interface HttpQueryResult {
  ok: boolean;
  events: RelayEvent[];
  complete: boolean;
}

/**
 * Browser-native relay client. WebSocket is preferred; when a browser cannot
 * open one, the same-origin HTTPS bridge keeps reads, writes, and polled live
 * subscriptions available while socket reconnects continue in the background.
 */
class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private subCounter = 0;
  // Live subscriptions — replayed after reconnect
  private subscriptions = new Map<string, Subscription>();
  // One-shot collect subscriptions — NOT replayed after reconnect
  private collectSubs = new Set<string>();
  // Publishes awaiting the relay's ["OK", id, ...] confirmation
  private pendingPublishes = new Map<string, (result: PublishResult) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private webSocketAttempt: Promise<boolean> | null = null;
  private disconnecting = false;
  private httpFallback = false;
  private httpProbePromise: Promise<boolean> | null = null;
  private httpPollGeneration = 0;
  private lifecycleGeneration = 0;
  // Counts every message the relay has sent over the current socket. A probe
  // remembers the count when it goes out; an unchanged count when its timer
  // fires means the link is dead, whatever the browser says about it.
  private heard = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url = RELAY_URL) {
    this.url = url;

    // The moments a socket is most likely to have died quietly are the
    // moments a page comes back: a tab foregrounded, a phone unlocked, a
    // network restored. Check straight away rather than waiting for the
    // next scheduled heartbeat, so a send made in the first seconds back
    // lands on a link known to carry.
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      window.addEventListener("online", () => this.wake());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.wake();
      });
    }
  }

  /** Whether the current socket is one the browser still reports as open. */
  private socketOpen(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private wake() {
    if (this.disconnecting) return;
    if (this.socketOpen()) {
      this.probe();
    } else if (!this.httpFallback) {
      void this.connect().catch(() => { /* reconnect timer keeps trying */ });
    }
  }

  connect(): Promise<void> {
    this.disconnecting = false;
    if (this.socketOpen() || this.httpFallback) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    const attempt = this.connectWithFallback();
    this.connectPromise = attempt;
    void attempt.then(
      () => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      },
      () => {
        if (this.connectPromise === attempt) this.connectPromise = null;
      }
    );
    return attempt;
  }

  private async connectWithFallback(): Promise<void> {
    if (await this.tryWebSocket()) return;
    if (await this.enableHttpFallback()) return;
    throw new Error(`Could not reach the relay over WebSocket or the HTTPS bridge: ${this.url}`);
  }

  private tryWebSocket(): Promise<boolean> {
    if (this.socketOpen()) return Promise.resolve(true);
    if (this.webSocketAttempt) return this.webSocketAttempt;

    const attempt = this.openWebSocketAttempt();
    this.webSocketAttempt = attempt;
    void attempt.then(
      () => {
        if (this.webSocketAttempt === attempt) this.webSocketAttempt = null;
      },
      () => {
        if (this.webSocketAttempt === attempt) this.webSocketAttempt = null;
      }
    );
    return attempt;
  }

  private openWebSocketAttempt(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let socket: WebSocket | null = null;

      const done = (opened: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(opened);
      };

      socket = this.doConnect(
        () => done(true),
        () => done(false)
      );

      if (!settled) {
        timer = setTimeout(() => {
          if (socket && this.ws === socket) this.ws = null;
          try { socket?.close(); } catch { /* already closed */ }
          done(false);
          if (!this.disconnecting) this.scheduleReconnect();
        }, WEBSOCKET_CONNECT_TIMEOUT_MS);
      }
    });
  }

  private doConnect(onOpen?: () => void, onFail?: () => void): WebSocket | null {
    let didOpen = false;
    try {
      const socket = new WebSocket(this.url);
      // Whatever socket this replaces is no longer the one we speak through.
      this.stopHeartbeat();
      this.connected = false;
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket || this.disconnecting) {
          try { socket.close(); } catch { /* already closed */ }
          return;
        }
        didOpen = true;
        this.connected = true;
        this.disableHttpFallback();
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        onOpen?.();

        // Replay persistent subscriptions after reconnect
        for (const [subId, sub] of this.subscriptions) {
          if (!this.collectSubs.has(subId)) {
            socket.send(JSON.stringify(["REQ", subId, ...sub.filters]));
          }
        }

        this.scheduleHeartbeat(socket);
      };

      socket.onmessage = (msg) => {
        if (this.ws !== socket) return;
        this.heard += 1;
        try {
          const data = JSON.parse(msg.data);
          if (!Array.isArray(data)) return;
          const [command, ...args] = data;

          if (command === "EVENT") {
            const [subId, event] = args as [string, RelayEvent];
            this.emitSubscriptionEvent(subId, event);
          } else if (command === "EOSE") {
            const [subId] = args as [string];
            this.subscriptions.get(subId)?.onEose?.();
          } else if (command === "OK") {
            const [eventId, ok, message] = args as [string, boolean, string];
            const resolve = this.pendingPublishes.get(eventId);
            if (resolve) {
              this.pendingPublishes.delete(eventId);
              resolve({ ok, message });
            }
          }
        } catch {
          // ignore malformed relay messages
        }
      };

      socket.onclose = () => {
        const wasCurrent = this.ws === socket;
        if (wasCurrent) this.ws = null;
        if (wasCurrent) this.connected = false;
        if (wasCurrent) this.stopHeartbeat();
        if (!didOpen) onFail?.();
        if (!wasCurrent || this.disconnecting) return;
        if (didOpen) void this.enableHttpFallback();
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        // onclose fires next; nothing to do here
      };

      return socket;
    } catch {
      onFail?.();
      if (!this.disconnecting) this.scheduleReconnect();
      return null;
    }
  }

  // ── Liveness ──────────────────────────────────────────────────────────

  private scheduleHeartbeat(socket: WebSocket) {
    this.stopHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.probe(socket);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    this.heartbeatTimer = null;
    this.probeTimer = null;
  }

  /**
   * Ask the relay for a sign of life over the current socket, and drop the
   * socket if none comes. The relay answers PING with PONG; an older relay
   * answers with a NOTICE about an unknown command, which proves the link
   * just as well.
   */
  private probe(socket: WebSocket | null = this.ws) {
    if (!socket || this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
    if (this.probeTimer) return; // one already in flight
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    const heard = this.heard;
    try {
      socket.send(JSON.stringify(["PING"]));
    } catch {
      this.dropSocket(socket);
      return;
    }

    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      if (this.ws !== socket) return;
      if (this.heard === heard) {
        this.dropSocket(socket);
        return;
      }
      this.scheduleHeartbeat(socket);
    }, HEARTBEAT_TIMEOUT_MS);
  }

  /**
   * Give up on a socket the browser still believes in. Closing a half-open
   * socket does not make the browser fire onclose promptly — the closing
   * handshake goes to the same nowhere the data did — so the client detaches
   * on its own and starts over, exactly as it would after a clean close.
   */
  private dropSocket(socket: WebSocket) {
    if (this.ws !== socket) return;
    this.ws = null;
    this.connected = false;
    this.stopHeartbeat();
    try { socket.close(); } catch { /* already closed */ }
    if (this.disconnecting) return;
    void this.enableHttpFallback();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disconnecting || this.socketOpen()) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disconnecting || this.socketOpen()) return;
      void this.tryWebSocket().then((opened) => {
        if (!opened && !this.disconnecting) this.scheduleReconnect();
      });
    }, RECONNECT_DELAY_MS);
  }

  /** Enter HTTPS mode only after the read bridge proves it can reach the relay. */
  private async enableHttpFallback(): Promise<boolean> {
    const lifecycle = this.lifecycleGeneration;
    if (this.connected) return true;
    if (this.httpFallback) return true;
    if (this.disconnecting) return false;

    if (!this.httpProbePromise) {
      const probe = this.queryOverHttp([{ ids: [HTTP_PROBE_ID], limit: 1 }])
        .then((result) => result.ok);
      this.httpProbePromise = probe;
      void probe.then(
        () => {
          if (this.httpProbePromise === probe) this.httpProbePromise = null;
        },
        () => {
          if (this.httpProbePromise === probe) this.httpProbePromise = null;
        }
      );
    }

    const available = await this.httpProbePromise;
    if (this.connected) return true;
    if (!available || this.disconnecting || this.lifecycleGeneration !== lifecycle) return false;
    if (this.httpFallback) return true;

    this.httpFallback = true;
    this.httpPollGeneration += 1;
    for (const [subId] of this.subscriptions) {
      if (!this.collectSubs.has(subId)) this.startHttpPolling(subId);
    }
    return true;
  }

  private disableHttpFallback() {
    if (!this.httpFallback) return;
    this.httpFallback = false;
    this.httpPollGeneration += 1;
    for (const sub of this.subscriptions.values()) {
      if (sub.pollTimer) clearTimeout(sub.pollTimer);
      sub.pollTimer = undefined;
      sub.pollGeneration = undefined;
    }
  }

  private send(message: unknown[]) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private emitSubscriptionEvent(subId: string, event: RelayEvent) {
    const sub = this.subscriptions.get(subId);
    if (!sub || sub.seenEventIds.has(event.id)) return;
    sub.seenEventIds.add(event.id);
    sub.onEvent(event);
  }

  private startHttpPolling(subId: string) {
    const sub = this.subscriptions.get(subId);
    const generation = this.httpPollGeneration;
    if (
      !sub ||
      !this.httpFallback ||
      this.collectSubs.has(subId) ||
      sub.pollGeneration === generation
    ) return;

    if (sub.pollTimer) clearTimeout(sub.pollTimer);
    sub.pollTimer = undefined;
    sub.pollGeneration = generation;

    void this.queryOverHttp(sub.filters).then((result) => {
      const current = this.subscriptions.get(subId);
      if (
        current !== sub ||
        !this.httpFallback ||
        this.httpPollGeneration !== generation ||
        this.collectSubs.has(subId)
      ) return;

      for (const event of result.events) this.emitSubscriptionEvent(subId, event);
      // EOSE means "initial/catch-up replay finished", not "a poll finished".
      // Repeating it on every unchanged poll makes consumers perform a full
      // refresh forever. Fire it once per HTTPS fallback episode instead.
      if (result.complete && sub.httpEoseGeneration !== generation) {
        sub.httpEoseGeneration = generation;
        sub.onEose?.();
      }
    }).catch(() => {
      // A subscriber callback must not stop the next poll.
    }).finally(() => {
      const current = this.subscriptions.get(subId);
      if (sub.pollGeneration === generation) sub.pollGeneration = undefined;
      if (
        current !== sub ||
        !this.httpFallback ||
        this.httpPollGeneration !== generation ||
        this.collectSubs.has(subId)
      ) return;

      sub.pollTimer = setTimeout(() => {
        sub.pollTimer = undefined;
        this.startHttpPolling(subId);
      }, HTTP_POLL_INTERVAL_MS);
    });
  }

  private async queryOverHttp(filters: Filter[]): Promise<HttpQueryResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COLLECT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
        signal: controller.signal,
      });
      const body = await response.json() as {
        ok?: unknown;
        complete?: unknown;
        events?: unknown;
        note?: unknown;
      };
      const ok = response.ok && body.ok === true && Array.isArray(body.events);
      const partial = typeof body.note === "string" && body.note.startsWith("partial:");
      return {
        ok,
        events: Array.isArray(body.events) ? body.events as RelayEvent[] : [],
        complete: ok && body.complete !== false && !partial,
      };
    } catch {
      return { ok: false, events: [], complete: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Live subscription. Persists across reconnects (unless collectOnly).
   * Returns an unsubscribe function.
   */
  subscribe(
    filters: Filter[],
    onEvent: EventCallback,
    onEose?: () => void,
    options?: { collectOnly?: boolean }
  ): () => void {
    const subId = `ui_${++this.subCounter}`;
    this.subscriptions.set(subId, { subId, filters, onEvent, onEose, seenEventIds: new Set() });
    if (options?.collectOnly) this.collectSubs.add(subId);
    if (this.httpFallback && !options?.collectOnly) this.startHttpPolling(subId);
    else this.send(["REQ", subId, ...filters]);

    return () => {
      const sub = this.subscriptions.get(subId);
      if (sub?.pollTimer) clearTimeout(sub.pollTimer);
      this.subscriptions.delete(subId);
      this.collectSubs.delete(subId);
      this.send(["CLOSE", subId]);
    };
  }

  /**
   * One-shot collect: returns all stored events matching filters, then resolves.
   * Times out after COLLECT_TIMEOUT_MS to prevent hangs on connection drop.
   */
  collect(filters: Filter[]): Promise<RelayEvent[]> {
    return this.collectWithStatus(filters).then(({ events }) => events);
  }

  /**
   * Like {@link collect}, but says whether the relay actually finished.
   *
   * A timed-out collect resolves the same empty array as a relay that answered
   * "nothing matches", so any caller treating emptiness as a fact about the
   * world — rather than a fact about the connection — states it with a
   * confidence the data does not carry. `complete` is true only when EOSE
   * arrived.
   */
  collectWithStatus(filters: Filter[]): Promise<{ events: RelayEvent[]; complete: boolean }> {
    if (this.httpFallback) {
      return this.queryOverHttp(filters).then(({ events, complete }) => ({ events, complete }));
    }

    return new Promise((resolve) => {
      const events: RelayEvent[] = [];
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let unsub = () => {};

      const done = (complete: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        unsub();
        resolve({ events, complete });
      };

      unsub = this.subscribe(
        filters,
        (event) => events.push(event),
        () => done(true),
        { collectOnly: true }
      );

      // Timeout guard — resolves with whatever arrived so far, marked partial.
      timer = setTimeout(() => done(false), COLLECT_TIMEOUT_MS);
    });
  }

  /**
   * Publish a signed event to the relay and wait for its ["OK", ...]
   * confirmation. Resolves { ok: false } (rather than throwing) on rejection
   * or timeout, so callers can surface a real error instead of assuming
   * success — a rate-limited or invalid publish previously looked identical
   * to a successful one from the caller's side.
   *
   * The link is checked before the event goes out, not after. A socket that
   * has quietly died is reconnected first; one that dies without telling us
   * — nothing at all heard back in the wait — is dropped and the event is
   * sent once more over a fresh connection. That second send is safe: the
   * relay answers OK to an event it already holds.
   */
  async publish(event: RelayEvent): Promise<PublishResult> {
    if (!this.httpFallback && !this.socketOpen()) {
      try {
        await this.connect();
      } catch {
        return { ok: false, message: "Could not reach the relay. Check your connection and try again." };
      }
    }
    if (this.httpFallback) return this.publishOverHttp(event);
    return this.publishOverSocket(event, true);
  }

  private publishOverSocket(event: RelayEvent, retryOnSilence: boolean): Promise<PublishResult> {
    const socket = this.ws;
    return new Promise((resolve) => {
      const heard = this.heard;
      const timer = setTimeout(() => {
        this.pendingPublishes.delete(event.id);

        // Silence is a dead link, not a refusal: a relay that is there and
        // declining says so. Start over and say it once more.
        if (retryOnSilence && socket && this.ws === socket && this.heard === heard) {
          this.dropSocket(socket);
          resolve(this.publish(event).then(
            (result) => result,
            () => ({ ok: false, message: "Lost the relay mid-send and could not get it back." }),
          ));
          return;
        }

        resolve({
          ok: false,
          message: this.heard === heard
            ? "No response from relay. Check your connection and try again."
            : "The relay did not accept this message (it may be rate-limiting you).",
        });
      }, PUBLISH_TIMEOUT_MS);

      this.pendingPublishes.set(event.id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });

      this.send(["EVENT", event]);
    });
  }

  private async publishOverHttp(event: RelayEvent): Promise<PublishResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
    try {
      const response = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      const body = await response.json() as {
        error?: unknown;
        results?: Array<{ id?: unknown; ok?: unknown; message?: unknown }>;
      };
      const result = body.results?.find((candidate) => candidate.id === event.id) ?? body.results?.[0];
      if (result && typeof result.ok === "boolean") {
        return {
          ok: result.ok,
          message: typeof result.message === "string" ? result.message : undefined,
        };
      }
      return {
        ok: false,
        message: typeof body.error === "string"
          ? body.error
          : `HTTPS relay bridge returned ${response.status}.`,
      };
    } catch {
      return { ok: false, message: "No response from the HTTPS relay bridge." };
    } finally {
      clearTimeout(timer);
    }
  }

  disconnect() {
    this.disconnecting = true;
    this.lifecycleGeneration += 1;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.httpFallback = false;
    this.httpPollGeneration += 1;
    for (const sub of this.subscriptions.values()) {
      if (sub.pollTimer) clearTimeout(sub.pollTimer);
    }
    this.subscriptions.clear();
    this.collectSubs.clear();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.close();
    }
    this.connected = false;
    this.connectPromise = null;
    this.webSocketAttempt = null;
    this.httpProbePromise = null;
  }
}

// Singleton — one connection per browser session
let client: RelayClient | null = null;

export function getRelayClient(): RelayClient {
  if (!client) {
    client = new RelayClient();
  }
  return client;
}

export type { RelayEvent, Filter };
