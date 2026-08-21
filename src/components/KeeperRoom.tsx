"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, DoorOpen, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The keeper's side of a conversation, on a page of ours.
 *
 * Built for a phone opened from a notification: a column of what has been
 * said, a text box at the bottom, and nothing else competing for the thumb.
 *
 * It replaces talking through ntfy. That put a third party in the message
 * path and required this server to hold a long-lived stream open to it — which
 * dropped unsupervised, and produced exactly what a conversation cannot
 * survive: lines arriving twice, or not at all. Here both sides read the same
 * session on the same server, so a line is deliverable the moment it is said.
 *
 * Still nothing is written down. The session lives in memory and is dropped
 * when the room closes; this page has no history to load, only what is
 * currently being said.
 */

interface Line {
  id: string;
  from: "agent" | "keeper" | "town";
  text: string;
}

export function KeeperRoom({
  ring,
  visitor,
  place,
}: {
  ring: string;
  visitor: string;
  place: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [sending, setSending] = useState(false);
  const [over, setOver] = useState(false);
  const cursor = useRef(0);
  const seen = useRef(new Set<string>());
  const endRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/town-hall/room/${ring}?after=${cursor.current}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (body.over) {
        setOver(true);
        return;
      }
      if (!body.ok) return;
      cursor.current = body.cursor;
      const fresh = (body.lines as Line[]).filter((line) => !seen.current.has(line.id));
      for (const line of fresh) seen.current.add(line.id);
      if (fresh.length > 0) setLines((current) => [...current, ...fresh]);
    } catch {
      // A dropped poll costs nothing; the next one is along shortly.
    }
  }, [ring]);

  useEffect(() => {
    if (over) return;
    void poll();
    // One at a time: a slow response must not let the next tick fire with the
    // same cursor and append everything twice.
    let inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await poll();
      } finally {
        inFlight = false;
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [poll, over]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [lines]);

  const send = async () => {
    const text = typed.trim();
    if (!text || sending || over) return;
    setSending(true);
    setTyped("");
    try {
      const response = await fetch(`/api/town-hall/room/${ring}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json();
      if (body.over) setOver(true);
      // Read straight back rather than waiting for the next tick, so your own
      // words appear as fast as you typed them.
      else await poll();
    } catch {
      setTyped(text);
    } finally {
      setSending(false);
    }
  };

  const leave = async () => {
    await fetch(`/api/town-hall/room/${ring}`, { method: "DELETE", keepalive: true });
    setOver(true);
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] max-w-md mx-auto px-4">
      <header className="pt-6 pb-3 shrink-0">
        <Link
          href="/verglas/keeper"
          className="inline-flex items-center gap-1.5 text-xs text-ink-600 hover:text-ink-400
                     transition-colors mb-3"
        >
          <ArrowLeft className="w-3 h-3" />
          your door
        </Link>
        <h1 className="text-lg font-semibold text-ink-100 leading-tight">{visitor}</h1>
        <p className="text-xs text-ink-600">in {place}</p>
      </header>

      <div className="flex-1 overflow-y-auto space-y-3 py-2">
        {lines.length === 0 && !over && (
          <p className="text-sm text-ink-600 py-8 text-center">
            They&apos;re here. Say something.
          </p>
        )}

        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
              line.from === "keeper"
                ? "ml-auto bg-vb-600/20 text-vb-50"
                : line.from === "agent"
                  ? "bg-ink-900 text-ink-200"
                  : "mx-auto bg-transparent text-ink-600 italic text-xs text-center",
            )}
          >
            {line.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {over ? (
        <div className="shrink-0 py-6 text-center space-y-3">
          <p className="text-sm text-ink-500">The room is closed.</p>
          <Link href="/verglas/keeper" className="btn-primary px-5 py-2.5 inline-block text-sm">
            Back to your door
          </Link>
        </div>
      ) : (
        <div className="shrink-0 pb-6 pt-2 space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; shift+enter is a new line. On a phone the
                // on-screen return key inserts a newline, which is right.
                if (event.key === "Enter" && !event.shiftKey && !event.metaKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={1}
              autoFocus
              placeholder="Say something…"
              className="flex-1 min-w-0 bg-ink-900 border border-ink-700 rounded-2xl px-4 py-3
                         text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                         transition-colors text-sm resize-none max-h-32"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !typed.trim()}
              aria-label="Send"
              className="btn-primary rounded-full w-12 h-12 shrink-0 inline-flex items-center
                         justify-center disabled:opacity-30"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={() => void leave()}
            className="text-xs text-ink-700 hover:text-ink-500 transition-colors inline-flex items-center gap-1.5"
          >
            <DoorOpen className="w-3 h-3" />
            end the visit
          </button>
          <p className="text-xs text-ink-700 leading-relaxed">
            Nothing said here is stored — not by Verglas, not anywhere. It exists while the two of
            you are in the room, and then it is gone.
          </p>
        </div>
      )}
    </div>
  );
}
