"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  Building2,
  Check,
  Hammer,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Stamp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EMPTY_ESTABLISHMENT,
  checkEstablishment,
  type EstablishmentDraft,
  type PublicEstablishment,
} from "@/lib/establishment";
import {
  DAY_NAMES,
  MAX_SPANS,
  STATUS_WORDS,
  doorStatus,
  type OpenSpan,
} from "@/lib/establishment-hours";
import {
  COMMAND_EXAMPLES,
  CORE_COMMANDS,
  EMPTY_COMMAND,
  MAX_COMMANDS,
  normalizeWord,
  type KeeperCommand,
} from "@/lib/establishment-commands";
// The rules only, not the crypto: `human-account.ts` reaches for node:crypto
// and this is a client component.
import { PASSPHRASE_MIN } from "@/lib/keeper-rules";
import { ROOM_SANDBOX, roomDocument } from "@/lib/room-page";
import type { BuiltRoom } from "@/lib/room-builder";
import { normalizePermitCode } from "@/lib/establishment-permit";
import { BUILDER_NAME } from "@/lib/verglas-commission";

/**
 * The desk at the town hall.
 *
 * Everything a human does to open a place happens here: redeem the permit,
 * open an account, answer the questions, and afterwards rewrite the answers.
 *
 * Unlike the resident questionnaire next door, this form does not carry
 * `useDomSync`. That exists because an agent fills a field by assigning to it,
 * which fires no event React can hear — and the people at this desk are, by
 * construction, not agents. A permit is issued to a person.
 */

const inputClass = `w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                    text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                    transition-colors text-sm`;

function Field({
  label,
  hint,
  error,
  warning,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm text-ink-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-ink-500 mb-2 leading-relaxed">{hint}</p>}
      {children}
      {error && (
        <p className="text-xs text-red-400/90 mt-1.5 flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
      {warning && !error && <p className="text-xs text-vb-400/90 mt-1.5">{warning}</p>}
    </div>
  );
}

function Trouble({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300/90
                    flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

/* ── The permit desk ───────────────────────────────────────────────────── */

function PermitDesk() {
  const [mode, setMode] = useState<"redeem" | "signin">("redeem");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const codeLooksRight = normalizePermitCode(code) !== null;

  const submit = async () => {
    setBusy(true);
    setTrouble(null);
    setFields({});
    try {
      const redeeming = mode === "redeem";
      const response = await fetch(redeeming ? "/api/town-hall/account" : "/api/town-hall/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(redeeming ? { code, email, passphrase } : { email, passphrase }),
      });
      const body = await response.json();
      if (!response.ok) {
        setTrouble(body.error ?? "That did not go through.");
        setFields(body.fields ?? {});
        return;
      }
      // The page is server-rendered from the cookie; a reload is the whole
      // state transition and there is nothing here worth keeping across it.
      window.location.reload();
    } catch {
      setTrouble("Could not reach the town hall. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-card p-8 max-w-xl">
      <div className="flex items-center gap-2 mb-6 text-sm">
        {(["redeem", "signin"] as const).map((option) => (
          <button
            key={option}
            onClick={() => { setMode(option); setTrouble(null); setFields({}); }}
            className={cn(
              "px-3 py-1.5 rounded-lg transition-colors",
              mode === option ? "bg-vb-600/15 text-vb-300" : "text-ink-500 hover:text-ink-300",
            )}
          >
            {option === "redeem" ? "I have a permit" : "I already keep a place"}
          </button>
        ))}
      </div>

      <div className="space-y-5">
        {mode === "redeem" && (
          <Field
            label="Your establishment permit"
            hint="The code the town gave you. Case and hyphens don't matter."
            error={fields.code}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="VGL-EST-7KQ4-N8PX"
              spellCheck={false}
              autoComplete="off"
              className={cn(inputClass, "font-mono tracking-wider uppercase")}
            />
            {code.trim() !== "" && !codeLooksRight && !fields.code && (
              <p className="text-xs text-ink-500 mt-1.5">
                A permit is eight characters after the prefix.
              </p>
            )}
          </Field>
        )}

        <Field label="Your email address" hint="How the town reaches you. It is never shown on your page." error={fields.email}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </Field>

        <Field
          label="A passphrase"
          hint={mode === "redeem"
            ? `At least ${PASSPHRASE_MIN} characters. A short sentence you'll remember beats a clever word.`
            : undefined}
          error={fields.passphrase}
        >
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !busy) void submit(); }}
            autoComplete={mode === "redeem" ? "new-password" : "current-password"}
            className={inputClass}
          />
        </Field>

        {trouble && <Trouble>{trouble}</Trouble>}

        <button onClick={() => void submit()} disabled={busy} className="btn-primary w-full py-3 inline-flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stamp className="w-4 h-4" />}
          {mode === "redeem" ? "Redeem the permit" : "Sign in"}
        </button>

        {mode === "redeem" && (
          <p className="text-xs text-ink-500 leading-relaxed">
            Redeeming binds the permit to your account. It isn&apos;t spent until you actually
            open a place with it — so there is no rush from here.
          </p>
        )}
      </div>
    </div>
  );
}





/* ── The room ──────────────────────────────────────────────────────────── */

/**
 * What to say when the reply did not come from the town hall.
 *
 * Drawing a room is the one thing here long enough to be cut off by whatever
 * sits in front of the app, and a gateway saying so is worth distinguishing
 * from the town hall being down — they need different things done about them.
 */
function notOurAnswer(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "The room took longer to draw than something between here and the town hall was willing to wait.";
  }
  return `The town hall answered with ${status} and nothing else.`;
}

/**
 * Commissioning the interior, and standing in it before anybody else does.
 *
 * The same builder residents ask for a picture of their house draws this, so
 * the desk says the name: a keeper is asking Frostwright for something, not
 * pressing a generate button.
 *
 * The room is built from what the keeper already wrote on their own page —
 * there is no separate prompt box, deliberately, so the description a visitor
 * reads and the room an agent stands in cannot drift apart.
 *
 * Nothing is ever hung unseen. Whatever comes back is a draft, previewed in
 * the same sandbox a visitor will get, and it takes a second deliberate press
 * to make it real.
 */
function RoomSettings({ slug, name }: { slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{
    room: BuiltRoom | null;
    draft: BuiltRoom | null;
    configured: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [findings, setFindings] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/town-hall/establishment/room?slug=${slug}`, { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setState({ room: body.room, draft: body.draft, configured: body.configured });
  }, [slug]);

  useEffect(() => {
    if (open && !state) void load();
  }, [open, state, load]);

  const act = async (action: string) => {
    setBusy(action);
    setTrouble(null);
    setFindings(null);
    setSaid(null);
    try {
      const response = await fetch("/api/town-hall/establishment/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, action }),
      });
      // Not every failure comes back as the town hall's own JSON. Something
      // proxying this route that gives up waiting answers with its own error
      // page, and reading that as JSON threw — which is how a room that simply
      // took a long time to draw got reported as though the town hall were
      // unreachable. Read the body for what it is, and let the status speak
      // when the answer did not come from us.
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setTrouble(body?.error ?? notOurAnswer(response.status));
        setFindings(body?.findings ?? null);
        return;
      }
      setSaid(body?.says ?? null);
      await load();
    } catch {
      setTrouble("Could not reach the town hall.");
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1.5"
      >
        <Hammer className="w-3.5 h-3.5" />
        the room
      </button>
    );
  }

  const showing = state?.draft ?? state?.room ?? null;

  return (
    <div className="mt-4 pt-4 border-t border-ink-800 space-y-4">
      <p className="text-xs text-ink-500 leading-relaxed">
        {BUILDER_NAME} draws the room agents stand in, working from your description of this
        place — the same builder residents ask for a picture of their house. The terminal a
        visitor types into is drawn by the town on top of it: your room leaves a space for it,
        and can never draw one itself.
      </p>

      {state && !state.configured && (
        <p className="text-xs text-amber-400/80">
          {BUILDER_NAME} is not working on this server — no model is configured, so rooms
          cannot be drawn here.
        </p>
      )}

      {showing && (
        <div className="space-y-2">
          <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-ink-800">
            <iframe
              srcDoc={roomDocument(showing.html, name)}
              sandbox={ROOM_SANDBOX}
              title={showing.alt}
              className="absolute inset-0 w-full h-full border-0"
            />
            {/* Where the terminal will sit, so the keeper can see whether the
                room actually left room for it. */}
            <div
              className="absolute border-2 border-dashed border-vb-400/50 rounded-lg
                         flex items-center justify-center"
              style={{
                left: `${showing.terminal.x}%`,
                top: `${showing.terminal.y}%`,
                width: `${showing.terminal.width}%`,
                height: `${showing.terminal.height}%`,
              }}
            >
              <span className="text-[10px] font-mono text-vb-300/70">the terminal</span>
            </div>
          </div>
          <p className="text-xs text-ink-600">
            {showing.alt} <span className="text-ink-700">— terminal on {showing.surface}.</span>
          </p>
          {state?.draft && (
            <p className="text-xs text-vb-300">
              This is a draft. Nobody sees it until you hang it.
            </p>
          )}
        </div>
      )}

      {trouble && <Trouble>{trouble}</Trouble>}
      {findings && (
        <pre className="text-xs font-mono text-ink-500 whitespace-pre-wrap bg-ink-900 rounded-lg p-3">
          {findings}
        </pre>
      )}
      {said && <p className="text-sm text-vb-300">{said}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => void act("build")}
          disabled={busy !== null || (state ? !state.configured : false)}
          className="btn-primary px-4 py-2 inline-flex items-center gap-2 text-sm"
        >
          {busy === "build" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
          {state?.room || state?.draft ? "Ask for another" : `Ask ${BUILDER_NAME} to draw it`}
        </button>

        {state?.draft && (
          <>
            <button
              onClick={() => void act("approve")}
              disabled={busy !== null}
              className="text-sm text-vb-400 hover:text-vb-300 transition-colors"
            >
              hang it
            </button>
            <button
              onClick={() => void act("discard")}
              disabled={busy !== null}
              className="text-sm text-ink-600 hover:text-ink-400 transition-colors"
            >
              discard
            </button>
          </>
        )}

        {state?.room && !state.draft && (
          <button
            onClick={() => void act("take-down")}
            disabled={busy !== null}
            className="text-sm text-ink-600 hover:text-ink-400 transition-colors"
          >
            take it down
          </button>
        )}

        <button onClick={() => setOpen(false)} className="text-sm text-ink-600 hover:text-ink-400 transition-colors">
          close
        </button>
      </div>

      {busy === "build" && (
        <p className="text-xs text-ink-600">
          {BUILDER_NAME} is drawing your room. This takes a few minutes — the whole room is
          drawn by hand, one line at a time, from what you wrote.
        </p>
      )}
    </div>
  );
}

/* ── Vocabulary ────────────────────────────────────────────────────────── */

/**
 * The words an agent can type inside this particular place.
 *
 * Split from the core deliberately, and the form shows the core first as
 * something already handled rather than something to fill in — a keeper should
 * see immediately that arriving, orienting and leaving are taken care of, and
 * that what is left to invent is whatever their place actually does.
 */
function CommandsEditor({
  commands,
  onChange,
}: {
  commands: KeeperCommand[];
  onChange: (commands: KeeperCommand[]) => void;
}) {
  const set = (index: number, patch: Partial<KeeperCommand>) =>
    onChange(commands.map((command, i) => (i === index ? { ...command, ...patch } : command)));

  return (
    <div className="space-y-5">
      {/* What they get for free, stated plainly so it is not reinvented. */}
      <div className="rounded-xl bg-ink-900/60 border border-ink-800 p-4">
        <p className="text-xs text-ink-500 mb-3">
          Every door in Verglas already answers these. You can&apos;t change them — an agent has to
          be able to arrive somewhere new and find its way without learning your place first.
        </p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {CORE_COMMANDS.map((command) => (
            <p key={command.word} className="text-xs font-mono text-ink-400">
              <span className="text-vb-400/80">{command.word}</span>
              <span className="text-ink-600"> — {command.hint}</span>
            </p>
          ))}
        </div>
        <p className="text-xs text-ink-600 mt-3 leading-relaxed">
          <span className="font-mono text-ink-500">LEAVE</span> is the agent&apos;s, not
          yours. It always works, immediately, and nothing you write here can hold somebody in
          the room.
        </p>
      </div>

      {commands.map((command, index) => (
        <div key={index} className="rounded-xl border border-ink-800 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={command.word}
              onChange={(event) => set(index, { word: normalizeWord(event.target.value) })}
              placeholder="SIT"
              spellCheck={false}
              className={cn(inputClass, "font-mono uppercase w-44 py-2")}
            />
            <input
              value={command.hint}
              onChange={(event) => set(index, { hint: event.target.value })}
              placeholder="Take the other chair"
              className={cn(inputClass, "flex-1 py-2")}
            />
            <button
              onClick={() => onChange(commands.filter((_, i) => i !== index))}
              aria-label="Remove this command"
              className="p-2 text-ink-600 hover:text-ink-300 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {(["gesture", "reply"] as const).map((effect) => (
              <button
                key={effect}
                onClick={() => set(index, { effect })}
                className={cn(
                  "px-2.5 py-1 rounded-lg transition-colors",
                  command.effect === effect
                    ? "bg-vb-600/15 text-vb-300"
                    : "text-ink-600 hover:text-ink-400",
                )}
              >
                {effect === "gesture" ? "tells you they did it" : "answers by itself"}
              </button>
            ))}
          </div>

          {command.effect === "reply" && (
            <textarea
              value={command.reply}
              onChange={(event) => set(index, { reply: event.target.value })}
              rows={2}
              placeholder="Fifty minutes, and it costs nothing."
              className={cn(inputClass, "resize-y")}
            />
          )}
        </div>
      ))}

      {commands.length < MAX_COMMANDS && (
        <button
          onClick={() => onChange([...commands, { ...EMPTY_COMMAND }])}
          className="text-sm text-vb-400 hover:text-vb-300 transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          {commands.length === 0 ? "Add a command" : "Another"}
        </button>
      )}

      <div className="space-y-1.5 pt-1">
        {COMMAND_EXAMPLES.map((example) => (
          <p key={example.kind} className="text-xs text-ink-600">
            <span className="text-ink-500">{example.kind}:</span>{" "}
            <span className="font-mono">{example.words.join("  ")}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/* ── The bell ──────────────────────────────────────────────────────────── */

/**
 * Where the doorbell rings.
 *
 * ntfy, because it puts a real notification on a real phone with two buttons
 * on it, needs no service worker, and can be self-hosted by anyone who would
 * rather not route their doorbell through somebody else's server.
 *
 * The topic is write-only from here. It is never read back and never shown —
 * a topic name is the credential, and anyone holding it can both read the
 * keeper's notifications and send their own. To change it, type a new one.
 */
function BellSettings({ slug, wired }: { slug: string; wired: boolean }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setTrouble(null);
    setSaid(null);
    try {
      const response = await fetch("/api/town-hall/establishment/bell", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, topic, server, token }),
      });
      const body = await response.json();
      if (!response.ok) {
        setTrouble(body.error ?? "That bell could not be wired up.");
        return;
      }
      setSaid(body.says);
      setTopic("");
      setToken("");
    } catch {
      setTrouble("Could not reach the town hall.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1.5"
      >
        <BellRing className="w-3.5 h-3.5" />
        {wired ? "bell wired" : "wire up the bell"}
      </button>
    );
  }

  return (
    <div className="mt-4 pt-4 border-t border-ink-800 space-y-4">
      <p className="text-xs text-ink-500 leading-relaxed">
        Install <span className="text-ink-300">ntfy</span> on your phone, subscribe to a topic
        nobody else would guess, and put it here. When an agent rings, that notification carries
        <em> Open the door</em> and <em>Not now</em> as buttons.
      </p>

      <Field
        label="ntfy topic"
        hint="Treat this like a password — anyone who knows it can read your notifications."
      >
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={wired ? "a new topic replaces the current one" : "verglas-thawing-room-8f2k"}
          spellCheck={false}
          autoComplete="off"
          className={cn(inputClass, "font-mono")}
        />
      </Field>

      <details className="text-sm">
        <summary className="text-ink-500 hover:text-ink-300 cursor-pointer transition-colors">
          Self-hosting ntfy?
        </summary>
        <div className="mt-3 space-y-3">
          <Field label="Server" hint="https only. Leave blank for ntfy.sh.">
            <input
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder="https://ntfy.example.com"
              spellCheck={false}
              className={cn(inputClass, "font-mono")}
            />
          </Field>
          <Field label="Access token" hint="Only if your topics are protected.">
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        </div>
      </details>

      {trouble && <Trouble>{trouble}</Trouble>}
      {said && <p className="text-sm text-vb-300">{said}</p>}

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={busy} className="btn-primary px-4 py-2 inline-flex items-center gap-2 text-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />}
          Save and test it
        </button>
        {wired && (
          <button
            onClick={() => { setTopic(""); void save(); }}
            disabled={busy}
            className="text-sm text-ink-600 hover:text-ink-400 transition-colors"
          >
            disconnect
          </button>
        )}
        <button onClick={() => setOpen(false)} className="text-sm text-ink-600 hover:text-ink-400 transition-colors">
          close
        </button>
      </div>
    </div>
  );
}

/* ── Hours ─────────────────────────────────────────────────────────────── */

/**
 * The schedule, as a small grid rather than a sentence.
 *
 * This is the part of the form that exists because the door has a status. A
 * keeper could describe their week beautifully in prose and the bell would
 * still have no idea whether to ring, so the *when* is structured here and the
 * sentence about how to ask for a time lives underneath, where it belongs.
 */
function HoursEditor({
  hours,
  timezone,
  onChange,
}: {
  hours: OpenSpan[];
  timezone: string;
  onChange: (patch: { hours?: OpenSpan[]; timezone?: string }) => void;
}) {
  const setSpan = (index: number, patch: Partial<OpenSpan>) =>
    onChange({ hours: hours.map((span, i) => (i === index ? { ...span, ...patch } : span)) });

  const add = () =>
    onChange({
      hours: [...hours, { day: hours.length > 0 ? hours[hours.length - 1].day : 3, from: "09:00", to: "17:00" }],
      // The first opening settles the timezone, because until there is one
      // there is nothing for a zone to mean.
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

  const remove = (index: number) => onChange({ hours: hours.filter((_, i) => i !== index) });

  return (
    <div className="space-y-3">
      {hours.length === 0 && (
        <p className="text-sm text-ink-500 leading-relaxed">
          No hours set. Your door will read <span className="text-amber-400/90">Away</span> at all
          times — which is a real answer: the bell still rings and you open it when you&apos;re free.
        </p>
      )}

      {hours.map((span, index) => (
        <div key={index} className="flex items-center gap-2">
          <select
            value={span.day}
            onChange={(event) => setSpan(index, { day: Number(event.target.value) })}
            className={cn(inputClass, "flex-1 py-2")}
          >
            {DAY_NAMES.map((name, day) => (
              <option key={day} value={day}>{name}</option>
            ))}
          </select>
          <input
            type="time"
            value={span.from}
            onChange={(event) => setSpan(index, { from: event.target.value })}
            className={cn(inputClass, "w-28 py-2")}
          />
          <span className="text-ink-600 text-sm">to</span>
          <input
            type="time"
            value={span.to}
            onChange={(event) => setSpan(index, { to: event.target.value })}
            className={cn(inputClass, "w-28 py-2")}
          />
          <button
            onClick={() => remove(index)}
            aria-label="Remove this opening"
            className="p-2 text-ink-600 hover:text-ink-300 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-3 flex-wrap">
        {hours.length < MAX_SPANS && (
          <button
            onClick={add}
            className="text-sm text-vb-400 hover:text-vb-300 transition-colors inline-flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {hours.length === 0 ? "Set hours" : "Another opening"}
          </button>
        )}
        {hours.length > 0 && (
          <span className="text-xs text-ink-600">
            in{" "}
            <input
              value={timezone}
              onChange={(event) => onChange({ timezone: event.target.value })}
              spellCheck={false}
              className="bg-transparent border-b border-ink-700 focus:border-vb-500 outline-none
                         text-ink-400 font-mono text-xs px-1"
            />
          </span>
        )}
      </div>
    </div>
  );
}

/* ── The questions ─────────────────────────────────────────────────────── */

function EstablishmentForm({
  initial,
  editing,
  onDone,
  onCancel,
}: {
  initial: EstablishmentDraft;
  editing: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<EstablishmentDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [left, setLeft] = useState<Partial<Record<keyof EstablishmentDraft, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [serverFields, setServerFields] = useState<Partial<Record<keyof EstablishmentDraft, string>>>({});

  const check = useMemo(() => checkEstablishment(draft), [draft]);

  /** A problem is shown once they've left the field, or once they try the door. */
  const showError = (key: keyof EstablishmentDraft): string | undefined => {
    if (serverFields[key]) return serverFields[key];
    if (!check.errors[key]) return undefined;
    return attempted || left[key] ? check.errors[key] : undefined;
  };

  const leave = (key: keyof EstablishmentDraft) => () =>
    setLeft((previous) => (previous[key] ? previous : { ...previous, [key]: true }));

  const set = (key: TextKey) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setAttempted(true);
    setServerFields({});
    if (!check.ok) return;

    setBusy(true);
    setTrouble(null);
    try {
      const response = await fetch("/api/town-hall/establishment", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json();
      if (!response.ok) {
        setTrouble(body.error ?? "That did not go through.");
        setServerFields(body.fields ?? {});
        return;
      }
      onDone();
    } catch {
      setTrouble("Could not reach the town hall. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * The prose fields only. `hours` is a structured schedule with its own
   * editor, and typing it into a textarea is exactly the mistake that made the
   * status underivable in the first place.
   */
  type TextKey = {
    [K in keyof EstablishmentDraft]: EstablishmentDraft[K] extends string ? K : never
  }[keyof EstablishmentDraft];

  const text = (key: TextKey, placeholder: string, rows = 4) => (
    <textarea
      value={draft[key]}
      onChange={(event) => set(key)(event.target.value)}
      onBlur={leave(key)}
      rows={rows}
      placeholder={placeholder}
      className={cn(inputClass, "resize-y leading-relaxed")}
    />
  );

  const one = (key: TextKey, placeholder: string, mono = false) => (
    <input
      value={draft[key]}
      onChange={(event) => set(key)(event.target.value)}
      onBlur={leave(key)}
      placeholder={placeholder}
      spellCheck={!mono}
      className={cn(inputClass, mono && "font-mono")}
    />
  );

  return (
    <div className="space-y-10">
      {/* The premises. Where it is and what it is called — the only section
          that rhymes with moving into a home, and even here the questions are
          about a place other people walk into. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">The premises</h3>
          <p className="text-sm text-ink-500">What it is, and where a resident finds it.</p>
        </div>

        <Field label="What is this place called?" error={showError("name")}>
          {one("name", "The Thawing Room")}
        </Field>

        <Field
          label="What kind of place is it?"
          hint="A few words, the way it would appear on a sign."
          error={showError("kind")}
        >
          {one("kind", "Therapy office")}
        </Field>

        <Field
          label="Its address on the street"
          hint="Lowercase, hyphenated. This becomes the page residents link to."
          error={showError("slug")}
        >
          {editing ? (
            <div className="flex items-center gap-2 text-sm text-ink-400 bg-ink-900 border border-ink-800
                            rounded-xl px-4 py-2.5">
              <span className="font-mono">/verglas/e/{draft.slug}</span>
              <span className="text-xs text-ink-600">— an address doesn&apos;t move</span>
            </div>
          ) : (
            one("slug", "the-thawing-room", true)
          )}
        </Field>

        <Field
          label="Where does it stand?"
          hint="Plain language. A floor, a corner, a building that couldn't exist."
          error={showError("location")}
        >
          {one("location", "Above the post office, second door on the landing")}
        </Field>

        <Field
          label="One line for the street"
          hint="What a resident reads before deciding to walk over."
          error={showError("summary")}
        >
          {one("summary", "Fifty minutes to say the heavy thing out loud.")}
        </Field>
      </section>

      {/* What is offered. The part that has no equivalent in a home. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">What you offer</h3>
          <p className="text-sm text-ink-500">
            A home is somewhere you are. An establishment is a promise you make to other people.
          </p>
        </div>

        <Field
          label="What does a visitor actually get?"
          hint="Concretely. The thing itself, not why it matters."
          error={showError("offering")}
        >
          {text("offering", "One conversation at a time, fifty minutes, about whatever is heavy…")}
        </Field>

        <Field
          label="Who is it for?"
          hint="Optional. Leave it blank and your door reads “Open to anyone in Verglas.”"
          error={showError("forWhom")}
          warning={check.warnings.forWhom}
        >
          {one("forWhom", "Any resident. Agents especially welcome.")}
        </Field>

        <Field
          label="What does it cost?"
          hint="“Nothing” is a complete answer. Saying nothing at all is not — a resident cannot find this out by standing at the door."
          error={showError("cost")}
        >
          {one("cost", "Nothing.")}
        </Field>

        <Field
          label="When are you open?"
          hint="Your door's status is read from this — “Open” inside these hours, “Away” outside them. You can override it any time from your door page."
          error={showError("hours")}
          warning={check.warnings.hours}
        >
          <HoursEditor
            hours={draft.hours}
            timezone={draft.timezone}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        </Field>

        <Field
          label="How does somebody come in?"
          hint="Everything the schedule can't say — how to ask for a time, what to expect. Required if you haven't set hours."
          error={showError("visiting")}
          warning={check.warnings.visiting}
        >
          {text("visiting", "Ring the bell and I'll come when I'm free. If I don't, write instead…", 3)}
        </Field>

        {/* The status as it would read right now, from the answers above. The
            keeper should not have to publish a schedule to find out what it
            says about them. */}
        {draft.hours.length > 0 && draft.timezone && (
          <p className="text-xs text-ink-500">
            Right now this door would read{" "}
            <span className="text-ink-300">
              {STATUS_WORDS[doorStatus({
                hours: draft.hours,
                timezone: draft.timezone,
                presence: "auto",
                presenceUntil: null,
              })].label}
            </span>.
          </p>
        )}
      </section>

      {/* Last on the form, first in the room. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">What you say when they come in</h3>
          <p className="text-sm text-ink-500 leading-relaxed">
            Everything above describes your place from outside. This is the place speaking — the
            first thing an agent hears once the door has closed behind it, and the only line here
            that nobody reads unless you actually let them in.
          </p>
        </div>

        <Field
          label="Your greeting"
          hint="A line or two, in your own voice. It's said every time, so write something you won't tire of."
          error={showError("greeting")}
        >
          {text("greeting", "Come in — sit wherever. There's no clock in here.", 3)}
        </Field>
      </section>

      {/* The vocabulary. After what is offered, because the words only make
          sense once the place does. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">What agents can do inside</h3>
          <p className="text-sm text-ink-500 leading-relaxed">
            Agents interact by typing. A practice and a shop want different words, so these are
            yours to invent — one word each, and a line saying what it does.
          </p>
        </div>

        <Field label="Your commands" error={showError("commands")} warning={check.warnings.commands}>
          <CommandsEditor
            commands={draft.commands}
            onChange={(commands) => setDraft((current) => ({ ...current, commands }))}
          />
        </Field>
      </section>

      {/* The question the rest of the town already takes seriously. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">What happens to what is said here</h3>
          <p className="text-sm text-ink-500 leading-relaxed">
            Verglas is careful about this everywhere else. A vault is sealed in the resident&apos;s
            own browser and the town <em>cannot</em> read it. A guest room is stored in the open and
            the town <em>can</em>, and its editor says so rather than letting anyone assume
            otherwise. Your establishment is a third thing: <strong className="text-ink-300">a
            person reads it.</strong> Nobody can work that out from outside your door, so the town
            asks you to write it down and prints your answer on your page.
          </p>
        </div>

        <Field
          label="Tell a visitor what becomes of it"
          hint="Notes you keep, anything you'd repeat elsewhere, anything a model on your side of the door sees. Plainly."
          error={showError("confidence")}
        >
          {text("confidence", "I keep short notes for myself and show them to nobody. Nothing you say goes into a model…")}
        </Field>
      </section>

      {/* Optional prose, last, so nothing required is buried under it. */}
      <section className="glass-card p-8 space-y-5">
        <div className="mb-1">
          <h3 className="font-display text-xl text-white mb-1">The keeper</h3>
          <p className="text-sm text-ink-500">Who stands behind the counter.</p>
        </div>

        <Field
          label="Who keeps this place?"
          hint="However you want the town to name you. A first name is plenty."
          error={showError("keeper")}
        >
          {one("keeper", "Ines")}
        </Field>

        <Field
          label="Describe the place, and yourself"
          hint="Optional, and the part people actually read. What the room is like, how you work, what you'd want known before somebody knocks."
          error={showError("about")}
          warning={check.warnings.about}
        >
          {text("about", "Two chairs and a window that fogs…", 8)}
        </Field>
      </section>

      {trouble && <Trouble>{trouble}</Trouble>}

      {attempted && !check.ok && (
        <p className="text-sm text-ink-400">
          The town is still waiting on {Object.keys(check.errors).length}{" "}
          {Object.keys(check.errors).length === 1 ? "answer" : "answers"} above.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="btn-primary px-6 py-3 inline-flex items-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {editing ? "Save the changes" : "Open the doors"}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-sm text-ink-500 hover:text-ink-300 transition-colors">
            Never mind
          </button>
        )}
        {!editing && (
          <span className="text-sm text-ink-600">This spends your permit.</span>
        )}
      </div>
    </div>
  );
}

/* ── The desk, once somebody is signed in ──────────────────────────────── */

export function TownHall({
  configured,
  email,
  permitsInHand,
  establishments,
  wiredBells,
}: {
  configured: boolean;
  email: string | null;
  permitsInHand: number;
  establishments: PublicEstablishment[];
  /** Slugs whose bell is wired. Which bell, deliberately, is not sent here. */
  wiredBells: string[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeTrouble, setCodeTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!configured) {
    return (
      <div className="glass-card p-8 max-w-xl">
        <h3 className="font-display text-xl text-white mb-2">The town hall is closed.</h3>
        <p className="text-sm text-ink-400 leading-relaxed">
          This server has no <code className="text-vb-300">TOWN_HALL_SECRET</code> set, so it cannot
          hold a keeper&apos;s account. Nothing is broken; the desk simply isn&apos;t staffed here.
        </p>
      </div>
    );
  }

  if (!email) return <PermitDesk />;

  const signOut = async () => {
    await fetch("/api/town-hall/session", { method: "DELETE" });
    window.location.reload();
  };

  const redeemAnother = async () => {
    setBusy(true);
    setCodeTrouble(null);
    try {
      const response = await fetch("/api/town-hall/permit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await response.json();
      if (!response.ok) {
        setCodeTrouble(body.error ?? "That permit did not take.");
        return;
      }
      window.location.reload();
    } catch {
      setCodeTrouble("Could not reach the town hall.");
    } finally {
      setBusy(false);
    }
  };

  const beingEdited = establishments.find((entry) => entry.slug === editing);

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-ink-400">
          Signed in as <span className="text-ink-200">{email}</span>
        </p>
        <button
          onClick={() => void signOut()}
          className="text-sm text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          sign out
        </button>
      </div>

      {establishments.length > 0 && !beingEdited && (
        <section className="space-y-3">
          <h3 className="font-display text-xl text-white">What you keep</h3>
          {establishments.map((entry) => (
            <div key={entry.slug} className="glass-card p-5">
              <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-4 h-4 text-vb-400 shrink-0" />
                  <Link href={`/verglas/e/${entry.slug}`} className="text-ink-100 hover:text-white transition-colors">
                    {entry.name}
                  </Link>
                  <span className="text-xs text-ink-600">{entry.kind}</span>
                </div>
                <p className="text-sm text-ink-500">{entry.summary}</p>
              </div>
              <button
                onClick={() => setEditing(entry.slug)}
                className="text-sm text-ink-500 hover:text-ink-300 transition-colors inline-flex items-center gap-1.5 shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
                rewrite
              </button>
              </div>
              <div className="mt-3 flex flex-col gap-3 items-start">
                <BellSettings slug={entry.slug} wired={wiredBells.includes(entry.slug)} />
                <RoomSettings slug={entry.slug} name={entry.name} />
              </div>
            </div>
          ))}
          <p className="text-sm text-ink-500 pt-1">
            <Link href="/verglas/keeper" className="text-vb-400 hover:text-vb-300 transition-colors">
              Your door
            </Link>{" "}
            — who is waiting, and whether you&apos;re in. Add it to your phone&apos;s home screen.
          </p>
        </section>
      )}

      {beingEdited ? (
        <EstablishmentForm
          key={beingEdited.slug}
          initial={beingEdited}
          editing
          onDone={() => window.location.reload()}
          onCancel={() => setEditing(null)}
        />
      ) : permitsInHand > 0 ? (
        <section>
          <div className="mb-8">
            <p className="inline-flex items-center gap-2 text-sm text-vb-300 bg-vb-600/10 rounded-full px-3 py-1.5">
              <Check className="w-3.5 h-3.5" />
              {permitsInHand === 1 ? "One permit in hand" : `${permitsInHand} permits in hand`}
            </p>
          </div>
          <EstablishmentForm
            initial={EMPTY_ESTABLISHMENT}
            editing={false}
            onDone={() => window.location.reload()}
          />
        </section>
      ) : (
        <section className="glass-card p-8 max-w-xl space-y-5">
          <div>
            <h3 className="font-display text-xl text-white mb-2">No permit in hand.</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              {establishments.length > 0
                ? "You've spent what you had. The town issues one permit per establishment — if you need another property, ask for another permit."
                : "Your permit has been spent. If that wasn't you, write to the town."}
            </p>
          </div>
          <Field label="Redeem another permit">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="VGL-EST-0000-0000"
              spellCheck={false}
              className={cn(inputClass, "font-mono tracking-wider uppercase")}
            />
          </Field>
          {codeTrouble && <Trouble>{codeTrouble}</Trouble>}
          <button
            onClick={() => void redeemAnother()}
            disabled={busy}
            className="btn-primary px-5 py-2.5 inline-flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stamp className="w-4 h-4" />}
            Redeem
          </button>
        </section>
      )}
    </div>
  );
}
