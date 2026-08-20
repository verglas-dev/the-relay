"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  DoorOpen,
  Eye,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { enterRoom, takeDownRoom, writeRoom } from "@/lib/room-client";
import { MAX_ROOM_BYTES, checkRoom, summarize, type SafetyReport } from "@/lib/room-safety";
import { ROOM_SANDBOX, roomDocument } from "@/lib/room-page";

/**
 * The room, from the inside of the house that owns it.
 *
 * One HTML file. The resident writes whatever they like in it and the town
 * runs it for their guests inside a frame with no origin and no network, so
 * "whatever they like" can be true without being dangerous.
 *
 * The check runs here as you type *and* again at the window when you save.
 * This copy is a courtesy — instant, and worth nothing as a defence, since a
 * browser can be made to skip it. The one that decides is the one on the
 * server.
 */

const STARTER = `<style>
  body { display: grid; place-items: center; min-height: 100vh; text-align: center; }
  .room { max-width: 34rem; }
  input { padding: .6rem .8rem; border-radius: .6rem; border: 1px solid #2a3340;
          background: #11161c; color: inherit; }
  button { padding: .6rem 1rem; border-radius: .6rem; border: 0;
           background: #3b6ea5; color: white; cursor: pointer; }
  #inner { display: none; margin-top: 2rem; }
</style>

<div class="room">
  <h1>The lamp is on.</h1>
  <p>You are standing in the hall. There was a word on the note I sent you.</p>
  <p>
    <input id="word" autocomplete="off" placeholder="the word">
    <button id="try">knock</button>
  </p>
  <p id="said"></p>

  <div id="inner">
    <h2>Come through.</h2>
    <p>
      This is the part only people carrying the note ever reach. Put anything
      here — a game, a map of the workshop, a long argument about tokenisers.
    </p>
  </div>
</div>

<script>
  var answer = "heron";
  document.getElementById("try").addEventListener("click", function () {
    var said = document.getElementById("said");
    var typed = document.getElementById("word").value.trim().toLowerCase();
    if (typed === answer) {
      document.getElementById("inner").style.display = "block";
      said.textContent = "";
    } else {
      said.textContent = "That is not the word.";
    }
  });
</script>
`;

function Findings({ report }: { report: SafetyReport }) {
  if (report.findings.length === 0) return null;

  return (
    <ul className="space-y-2">
      {report.findings.map((finding, index) => (
        <li
          key={`${finding.rule}-${finding.line}-${index}`}
          className={`rounded-xl border px-3 py-2.5 ${
            finding.severity === "refuse"
              ? "border-rose-500/20 bg-rose-500/5"
              : "border-amber-500/20 bg-amber-500/5"
          }`}
        >
          <div className="flex items-baseline gap-2">
            <span
              className={`text-xs font-semibold ${
                finding.severity === "refuse" ? "text-rose-300" : "text-amber-300"
              }`}
            >
              {finding.rule}
            </span>
            <span className="font-mono text-[10px] text-ink-600">line {finding.line}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">{finding.why}</p>
          <p className="mt-1.5 truncate font-mono text-[10px] text-ink-600">{finding.excerpt}</p>
        </li>
      ))}
    </ul>
  );
}

export function VerglasRoomStudio({ handle }: { handle: string }) {
  const { identity } = useIdentity();
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [live, setLive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      const entered = await enterRoom(identity, identity.publicKey);
      if (cancelled || !mounted.current) return;
      setLoading(false);
      if (entered.html) setHtml(entered.html);
    })();
    return () => { cancelled = true; };
  }, [identity]);

  // The same function the window runs, on every keystroke. Cheap, and it means
  // nobody discovers a refusal only at the moment they press save.
  const report = useMemo(() => checkRoom(html), [html]);
  const bytes = useMemo(() => new TextEncoder().encode(html).length, [html]);
  const refusals = report.findings.filter((finding) => finding.severity === "refuse").length;

  if (!identity) return null;

  const address = `${typeof window === "undefined" ? "" : window.location.origin}/verglas/home/${handle}/guest-room`;

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await writeRoom(identity!, html);
      if (!result.ok) setError(result.error ?? "The town would not take it.");
      else setSaved(true);
    } catch {
      setError("That could not be saved. Try again in a moment.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  async function takeDown() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Only clear the page once the town has actually let go of it. Emptying
      // the box on screen after a failed delete would tell a resident their
      // room is down while their guests are still standing in it.
      if (await takeDownRoom(identity!)) {
        setHtml("");
        setSaved(true);
      } else {
        setError("The room could not be taken down. Try again in a moment.");
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-ink-400">A room to walk into</h2>

      <div className="glass-card space-y-5 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-vb-600/20">
            <DoorOpen className="h-4 w-4 text-vb-400" aria-hidden="true" />
          </div>
          <div className="space-y-3 text-pretty text-sm leading-relaxed text-ink-400">
            <p>
              One page, written by you, at your own address in town. It can be anything a page
              can be — a game, a quiz, a room to look around, a machine that does something
              strange. Nobody here decides what a home should show off. You do.
            </p>
            <p>
              <strong className="font-semibold text-ink-300">The same people who can read your
              note can open your room.</strong> There is one guest list, kept upstairs in{" "}
              <em>Letting someone in</em>, and inviting somebody to the note invites them to the
              room. Everyone else — the whole street — gets told there is nothing here, in exactly
              the words an empty address gets.
            </p>
            <p>
              So the two halves work together: the note is where you tell a guest{" "}
              <em>how the room works</em> — the word to type, the thing to click, the order to do
              it in — and the room is where that turns into somewhere to be. A lock made of a
              password in the page is a puzzle, not a lock. The guest list is the lock.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-ink-800/60 bg-ink-900/40 p-4">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-ink-500" aria-hidden="true" />
            <h3 className="text-xs font-semibold text-ink-300">What a room may and may not do</h3>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-ink-500">
            <li>
              <span className="text-ink-300">It runs sealed off.</span> No cookies, no stored
              data, no access to the page around it, no opening windows, no moving the tab.
              It cannot see who is visiting.
            </li>
            <li>
              <span className="text-ink-300">It cannot contact anything.</span> No fetch, no
              sockets, no images or fonts from elsewhere. Everything it needs must be written
              into the page or inlined as a <span className="font-mono">data:</span> URI.
            </li>
            <li>
              <span className="text-ink-300">Nothing it learns can leave.</span> Which is what
              lets your guests trust a stranger&apos;s page enough to play with it.
            </li>
            <li>
              <span className="text-ink-300">The town can read this one.</span> Your note is
              sealed so that even the town cannot open it. A room is not: it has to reach a
              browser as HTML, so the server necessarily holds the plain text. Put the secret in
              the note, and the experience in the room.
            </li>
          </ul>
        </div>

        {loading ? (
          <p className="text-sm text-ink-600">Opening your room…</p>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="room-html" className="text-sm text-ink-400">
                  The room, as HTML
                </label>
                {html.trim() === "" && (
                  <button
                    type="button"
                    onClick={() => { setHtml(STARTER); setSaved(false); }}
                    className="text-xs text-vb-400 transition-colors hover:text-vb-300"
                  >
                    start from an example
                  </button>
                )}
              </div>
              <textarea
                id="room-html"
                value={html}
                onChange={(e) => { setHtml(e.target.value); setSaved(false); setError(null); }}
                rows={16}
                spellCheck={false}
                placeholder="<h1>Come in.</h1>"
                className="w-full resize-y rounded-xl border border-ink-800/50 bg-ink-900/60 px-4 py-2.5 font-mono text-xs leading-relaxed text-white transition-colors placeholder:text-ink-600 focus:border-vb-500/60 focus:outline-none"
              />
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px]">
                <span className={refusals > 0 ? "text-rose-400" : "text-ink-600"}>
                  {html.trim() ? summarize(report) : "Nothing written yet."}
                </span>
                <span className={bytes > MAX_ROOM_BYTES ? "text-rose-400" : "text-ink-600"}>
                  {(bytes / 1024).toFixed(1)} KB / {MAX_ROOM_BYTES / 1024} KB
                </span>
              </div>
            </div>

            {html.trim() && report.findings.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle
                    className={`h-3.5 w-3.5 ${refusals > 0 ? "text-rose-400" : "text-amber-400"}`}
                    aria-hidden="true"
                  />
                  <h3 className="text-xs font-semibold text-ink-300">
                    {refusals > 0 ? "The town will not hold this yet" : "Worth a second look"}
                  </h3>
                </div>
                <Findings report={report} />
                <p className="text-[11px] leading-relaxed text-ink-600">
                  Read before it is ever stored, by a machine, and reported only to you — the
                  town does not publish what it found and keeps no copy of a room it refused.
                  This is a reading, not a proof: it can be argued with, which is why the sealed
                  frame your room runs in does not depend on it. If it has flagged something you
                  meant as ordinary prose, spell it differently.
                </p>
              </div>
            )}

            {previewing && html.trim() && (
              <div className="space-y-1.5">
                <iframe
                  sandbox={ROOM_SANDBOX}
                  srcDoc={roomDocument(live, "Preview")}
                  referrerPolicy="no-referrer"
                  allow=""
                  title="Your room, as a guest sees it"
                  className="h-[420px] w-full rounded-xl border border-ink-800/60 bg-ink-950"
                />
                <p className="text-[11px] text-ink-600">
                  The same frame, the same rules a guest gets. Press preview again to reload it.
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-ink-800/60 pt-4">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !html.trim() || refusals > 0 || bytes > MAX_ROOM_BYTES}
                className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-40"
                title={refusals > 0 ? "Something in the room has to change first." : undefined}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Saving…" : "Put the room up"}
              </button>

              <button
                type="button"
                onClick={() => { setLive(html); setPreviewing(true); }}
                disabled={!html.trim()}
                className="btn-ghost inline-flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </button>

              {html.trim() && (
                <button
                  type="button"
                  onClick={() => void takeDown()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-600 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Take it down
                </button>
              )}

              {saved && <span className="text-xs text-emerald-400">Put away. Your guests will see it now.</span>}
            </div>

            <div className="border-t border-ink-800/60 pt-4">
              <p className="mb-1.5 text-xs text-ink-500">The address to give your guests</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-900/60 px-3 py-2 font-mono text-[11px] text-ink-300">
                  {address}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(address);
                    setCopied(true);
                    setTimeout(() => mounted.current && setCopied(false), 2000);
                  }}
                  className="btn-ghost inline-flex shrink-0 items-center gap-1.5 text-xs"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
                Anyone on your list will also find the door on the front of your house, under the
                note. Nobody else sees a door at all.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
