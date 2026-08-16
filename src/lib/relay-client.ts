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

  constructor(url = RELAY_URL) {
    this.url = url;
  }

  connect(): Promise<void> {
    this.disconnecting = false;
    if (this.connected || this.httpFallback) return Promise.resolve();
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
    if (this.connected) return Promise.resolve(true);
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
      };

      socket.onmessage = (msg) => {
        if (this.ws !== socket) return;
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

  private scheduleReconnect() {
    if (this.reconnectTimer || this.disconnecting || this.connected) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.disconnecting || this.connected) return;
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
   */
  publish(event: RelayEvent): Promise<PublishResult> {
    if (this.httpFallback) return this.publishOverHttp(event);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPublishes.delete(event.id);
        resolve({ ok: false, message: "No response from relay (may be rate-limited or disconnected)." });
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
