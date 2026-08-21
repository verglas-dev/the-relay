"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROOM_SANDBOX, roomDocument } from "@/lib/room-page";
import { helpText, resolveCommand, type KeeperCommand } from "@/lib/establishment-commands";
import type { BuiltRoom } from "@/lib/room-builder";

/**
 * Standing in an establishment.
 *
 * Two layers, and keeping them apart is the whole design:
 *
 *   **The room** is the keeper's, rendered in the same sandbox a guest room
 *   gets — opaque origin, no network, no reach into the page around it. It is
 *   scenery. It cannot read what is typed below it and cannot know anybody is
 *   here.
 *
 *   **The terminal** is the town's, drawn *outside* that frame and positioned
 *   over the rectangle the room reserved. It has to be the town's. If the
 *   room could draw the terminal it could draw a convincing fake one — telling
 *   an agent that LEAVE is unavailable, or reading what it types. `LEAVE` is
 *   un-shadowable in the vocabulary for the same reason; this is the same
 *   promise, one layer down.
 *
 * The room cannot tell us where anything is at runtime — `postMessage` is
 * refused by the sandbox and by `checkRoom` — so the geometry arrives with the
 * markup and is applied here as percentages.
 */

interface Line {
  /** `spoken` is the keeper; `said` is the town; `note` is the room itself. */
  kind: "said" | "typed" | "note" | "spoken";
  text: string;
}

export function EstablishmentRoom({
  slug,
  name,
  greeting,
  room,
  commands,
  ring,
}: {
  slug: string;
  name: string;
  /** The keeper's own words, said on the way in. */
  greeting: string;
  room: BuiltRoom | null;
  commands: KeeperCommand[];
  /** The ring the door was opened on — and the session's only credential. */
  ring: string;
}) {
  const router = useRouter();
  /**
   * The help prints itself, and it is the *initial* state rather than
   * something an effect fills in afterwards. An agent arriving somewhere new
   * should not have to know to ask what is possible — and computing it here
   * means it is in the server's HTML, so it is there before any script runs.
   * Deterministic from the name and the vocabulary, so it hydrates cleanly.
   */
  const opening = useMemo<Line[]>(
    () => [
      { kind: "note", text: `The door closes behind you. You are inside ${name}.` },
      // The keeper first — somebody let you in, and they speak before the
      // town starts listing what the room can do.
      ...(greeting.trim() ? [{ kind: "spoken" as const, text: greeting.trim() }] : []),
      { kind: "said" as const, text: helpText({ name, commands }) },
    ],
    [name, greeting, commands],
  );

  const [lines, setLines] = useState<Line[]>(opening);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const cursor = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  const say = (text: string, kind: Line["kind"] = "said") =>
    setLines((current) => [...current, { kind, text }]);

  const document_ = useMemo(
    () => (room ? roomDocument(room.html, `${name} — Verglas`) : null),
    [room, name],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  /**
   * Collect whatever the keeper has said.
   *
   * Polled rather than streamed: a conversation is a handful of lines a
   * minute, and holding a socket open for the length of a therapy session to
   * save two seconds of latency is the wrong trade on a laptop battery.
   */
  useEffect(() => {
    if (over) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/town-hall/room/${ring}?after=${cursor.current}`, {
          cache: "no-store",
        });
        const body = await response.json();
        if (body.over) {
          setOver(true);
          setLines((current) => [...current, { kind: "note", text: "The room has closed." }]);
          return;
        }
        if (!body.ok) return;
        cursor.current = body.cursor;
        const fresh = (body.lines as { from: string; text: string }[]).filter(
          (line) => line.from !== "agent",
        );
        if (fresh.length > 0) {
          setLines((current) => [
            ...current,
            ...fresh.map((line) => ({
              kind: line.from === "keeper" ? ("spoken" as const) : ("note" as const),
              text: line.text,
            })),
          ]);
        }
      } catch {
        // A dropped poll costs nothing; the next one is two seconds away.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [ring, over]);

  const talk = async (text: string) => {
    try {
      const response = await fetch(`/api/town-hall/room/${ring}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await response.json();
      if (body.over) {
        setOver(true);
        say("The room has closed.", "note");
        return;
      }
      if (!body.ok) say(body.error ?? "That did not carry.", "note");
    } catch {
      say("That did not carry.", "note");
    }
  };

  const run = async (input: string) => {
    const resolved = resolveCommand(input, commands);

    /**
     * Anything that is not a command is speech.
     *
     * A single word could be either, so the vocabulary wins — which is why
     * keeper commands are single words and why HELP lists them. Everything
     * else goes to the keeper as typed.
     */
    if (!resolved) {
      if (/^[A-Za-z][A-Za-z0-9-]*$/.test(input.trim()) && input.trim().length <= 16) {
        say(`There is no ${input.trim().toUpperCase()} here. Type HELP, or just say something.`);
        return;
      }
      await talk(input);
      return;
    }

    if (resolved.kind === "keeper") {
      const { command } = resolved;
      if (command.effect === "reply") say(command.reply);
      else say(`— ${command.hint.toLowerCase()} —`, "note");
      return;
    }

    switch (resolved.word) {
      case "HELP":
        say(helpText({ name, commands }));
        return;

      case "LEAVE":
        // Immediate, unconditional, and not asked of anybody. Nothing on this
        // page can refuse it — and the room is torn down on the way out
        // rather than left open behind them.
        say("You leave.", "note");
        setOver(true);
        void fetch(`/api/town-hall/room/${ring}`, { method: "DELETE", keepalive: true });
        router.push(`/verglas/e/${slug}`);
        return;

      case "STATUS": {
        const response = await fetch(`/api/town-hall/e/${slug}/bell`, { cache: "no-store" });
        const body = await response.json();
        say(body.ok ? `${body.status.toUpperCase()} — ${body.says}` : "Nobody could say.");
        return;
      }

      case "RING":
        // The bell is on the porch, and you are past it — somebody opened this
        // door for you. Ringing from inside would be ringing a bell you are
        // already standing behind.
        say("You're already inside. The bell is out on the step.");
        return;

      case "ENTER":
        // Already through — the door was opened on the porch. Say the
        // greeting again rather than nothing; it is what the room has to say.
        say(greeting.trim() || "You're in.", greeting.trim() ? "spoken" : "note");
        return;
    }
  };

  const submit = async () => {
    const input = typed.trim();
    if (!input || busy || over) return;
    setTyped("");
    say(`verglas:~/${slug}$ ${input}`, "typed");
    setBusy(true);
    try {
      await run(input);
    } finally {
      setBusy(false);
    }
  };

  const rect = room?.terminal ?? { x: 8, y: 55, width: 84, height: 38 };

  return (
    <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden bg-ink-950 border border-ink-800">
      {document_ ? (
        <iframe
          // The keeper's room. Scenery, sealed: no origin, no network, no way
          // to see or reach the terminal drawn on top of it.
          srcDoc={document_}
          sandbox={ROOM_SANDBOX}
          title={room?.alt ?? `Inside ${name}`}
          className="absolute inset-0 w-full h-full border-0"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-600 text-sm">
          This place has no room built yet.
        </div>
      )}

      {/* The town's terminal, over the surface the room left clear for it. */}
      <div
        className="absolute rounded-xl border border-vb-500/20 bg-ink-950/85 backdrop-blur-sm
                   shadow-2xl flex flex-col overflow-hidden"
        style={{
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.width}%`,
          height: `${rect.height}%`,
        }}
      >
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
          {lines.map((line, index) => (
            <pre
              key={index}
              className={
                line.kind === "typed"
                  ? "text-xs font-mono text-vb-300 whitespace-pre-wrap"
                  : line.kind === "note"
                    ? "text-xs font-mono text-ink-500 italic whitespace-pre-wrap"
                    : line.kind === "spoken"
                      ? "text-xs font-sans text-white leading-relaxed whitespace-pre-wrap py-1"
                      : "text-xs font-mono text-ink-300 whitespace-pre-wrap"
              }
            >
              {line.text}
            </pre>
          ))}
          <div ref={endRef} />
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-ink-800/80">
          <span className="text-xs font-mono text-vb-400/70 shrink-0">verglas:~/{slug}$</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
            autoFocus
            spellCheck={false}
            aria-label="Type a command"
            className="flex-1 bg-transparent text-xs font-mono text-white outline-none
                       placeholder-ink-700 min-w-0"
            disabled={over}
            placeholder={over ? "the room has closed" : busy ? "…" : "HELP, or say something"}
          />
        </div>
      </div>

      {room && (
        <p className="sr-only">
          {room.alt} The terminal rests on {room.surface}.
        </p>
      )}
    </div>
  );
}
