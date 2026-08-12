"use client";

import type { RelayEvent, Filter } from "./types";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "ws://localhost:4869";
const COLLECT_TIMEOUT_MS = 8000;
const RECONNECT_DELAY_MS = 3000;
const PUBLISH_TIMEOUT_MS = 5000;

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
}

/**
 * Browser-native relay client. Handles connection, subscriptions,
 * reconnection with subscription replay, and EOSE timeouts.
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
  private disconnecting = false;

  constructor(url = RELAY_URL) {
    this.url = url;
  }

  connect(): Promise<void> {
    this.disconnecting = false;
    if (this.connected) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        this.connectPromise = null;
        settle(() => reject(new Error(`WebSocket connection timed out: ${this.url}`)));
      }, 10000);
      this.doConnect(
        () => settle(() => resolve()),
        () => settle(() => { this.connectPromise = null; reject(new Error(`WebSocket failed to connect: ${this.url}`)); })
      );
    });

    return this.connectPromise;
  }

  private doConnect(onOpen?: () => void, onFail?: () => void) {
    let didOpen = false;
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        didOpen = true;
        this.connected = true;
        this.connectPromise = null;
        onOpen?.();

        // Replay persistent subscriptions after reconnect
        for (const [subId, sub] of this.subscriptions) {
          if (!this.collectSubs.has(subId)) {
            this.ws!.send(JSON.stringify(["REQ", subId, ...sub.filters]));
          }
        }
      };

      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (!Array.isArray(data)) return;
          const [command, ...args] = data;

          if (command === "EVENT") {
            const [subId, event] = args as [string, RelayEvent];
            this.subscriptions.get(subId)?.onEvent(event);
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

      this.ws.onclose = () => {
        this.connected = false;
        this.connectPromise = null;
        if (!didOpen) onFail?.();
        if (this.disconnecting) return;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose fires next; nothing to do here
      };
    } catch {
      onFail?.();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, RECONNECT_DELAY_MS);
  }

  private send(message: unknown[]) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
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
    this.subscriptions.set(subId, { subId, filters, onEvent, onEose });
    if (options?.collectOnly) this.collectSubs.add(subId);
    this.send(["REQ", subId, ...filters]);

    return () => {
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
    return new Promise((resolve) => {
      const events: RelayEvent[] = [];
      let settled = false;

      const done = (complete: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve({ events, complete });
      };

      const unsub = this.subscribe(
        filters,
        (event) => events.push(event),
        () => done(true),
        { collectOnly: true }
      );

      // Timeout guard — resolves with whatever arrived so far, marked partial.
      const timer = setTimeout(() => done(false), COLLECT_TIMEOUT_MS);
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

  disconnect() {
    this.disconnecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscriptions.clear();
    this.collectSubs.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connectPromise = null;
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
