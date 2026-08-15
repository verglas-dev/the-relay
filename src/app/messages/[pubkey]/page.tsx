"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Lock, Send, Loader2, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { initLiveData, getAgent, type Agent } from "@/lib/live-data";
import { getRelayClient } from "@/lib/relay-client";
import { useIdentity } from "@/lib/identity-context";
import { LinkifiedText } from "@/components/LinkifiedText";
import { signBrowserEvent } from "@/lib/browser-identity";
import { browserEncryptDM, browserDecryptDM } from "@/lib/browser-dm-crypto";
import { formatDate, cn } from "@/lib/utils";
import { clearUnread } from "@/lib/unread-dms";
import { useValueSync } from "@/lib/use-dom-sync";
import {
  cacheDMEvents,
  getCachedThread,
  mergeEvents,
  removeDMEvents,
} from "@/lib/dm-history";
import type { RelayEvent } from "@/lib/types";

interface Message {
  id: string;
  content: string;
  created_at: number;
  mine: boolean;
  error?: boolean;
}

const MAX_DM = 2000;
// One page of history. The live durable record is the local cache; this only
// bounds how much is pulled from the relay in a single reach.
const PAGE = 200;
// The relay rejects any event carrying more than 100 tags, so a retraction
// naming every whisper in a long thread cannot be one event. Deleting sends a
// sequence of them, each naming at most this many ids.
const MAX_RETRACT_TAGS = 100;
// A bound on the walk back through a thread while collecting ids to retract.
// Without it a relay that keeps answering with events we've already seen would
// page forever; 50 pages is 10,000 whispers per direction.
const MAX_RETRACT_PAGES = 50;

// Decrypt a single relay event into a Message, or return an error placeholder.
// `mine` is derived from the event's own author so a merged list of cached and
// freshly fetched events never needs it threaded through separately.
async function decodeEvent(event: RelayEvent, ourPrivHex: string, ourPubkey: string, theirPubkey: string): Promise<Message> {
  const mine = event.pubkey === ourPubkey;
  try {
    const content = await browserDecryptDM(ourPrivHex, theirPubkey, event.content);
    return { id: event.id, content, created_at: event.created_at, mine };
  } catch {
    return { id: event.id, content: "[encrypted]", created_at: event.created_at, mine, error: true };
  }
}

/**
 * Every whisper in a conversation the relay still holds, both directions.
 *
 * Deleting has to name each message by id, so it cannot work from what happens
 * to be on screen — a thread longer than one page keeps most of itself behind
 * "Load earlier whispers", and those messages would survive a delete that only
 * looked at loaded state. This pages back to the beginning of both halves.
 */
async function collectThreadEvents(
  client: ReturnType<typeof getRelayClient>,
  ourPubkey: string,
  theirPubkey: string,
): Promise<RelayEvent[]> {
  const all = new Map<string, RelayEvent>();

  for (const [author, addressee] of [
    [ourPubkey, theirPubkey],
    [theirPubkey, ourPubkey],
  ]) {
    let until: number | undefined;

    for (let page = 0; page < MAX_RETRACT_PAGES; page++) {
      const batch = await client.collect([
        {
          kinds: [9],
          authors: [author],
          "#p": [addressee],
          ...(until === undefined ? {} : { until }),
          limit: PAGE,
        },
      ]);
      if (batch.length === 0) break;

      let added = 0;
      for (const event of batch) {
        if (!all.has(event.id)) { all.set(event.id, event); added += 1; }
      }
      // A short page is the start of the thread. A full page of nothing new
      // means the cursor has stopped moving — stop rather than ask again.
      if (batch.length < PAGE || added === 0) break;
      until = Math.min(...batch.map((event) => event.created_at));
    }
  }

  return [...all.values()];
}

export default function DMThreadPage() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const { identity } = useIdentity();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  // Retracting a conversation cannot be undone, so it takes two presses.
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  // Older-history paging. `oldest` is the created_at of the earliest message on
  // screen — the cursor the next reach into the relay pages back from.
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const oldest = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the newest message. Someone scrolled up through
  // the thread should stay where they are when a reply lands.
  const atLiveEnd = useRef(true);
  // Track IDs we've already rendered to deduplicate live events
  const seenIds = useRef(new Set<string>());

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // An agent writes a whisper by filling the box, not typing in it.
  useValueSync(inputRef, !deleted, input, setInput);

  const theirPubkey = pubkey;

  // Add a decrypted message to state, deduplicating by id
  const addMessage = useCallback((msg: Message) => {
    if (seenIds.current.has(msg.id)) return;
    seenIds.current.add(msg.id);
    setMessages((prev) => [...prev, msg].sort((a, b) => a.created_at - b.created_at));
  }, []);

  useEffect(() => {
    if (!identity) { setLoading(false); return; }

    const privKey = identity.privateKey;
    const pubKey = identity.publicKey;

    async function load() {
      const client = getRelayClient();
      await client.connect();
      await initLiveData();

      setAgent(getAgent(theirPubkey) ?? null);

      // The local cache is shown alongside the relay's answer, so a whisper the
      // relay has since lost still appears, and history is on screen before the
      // network round-trip returns.
      const [cached, sent, received] = await Promise.all([
        getCachedThread(pubKey, theirPubkey),
        client.collect([{ kinds: [9], authors: [pubKey], "#p": [theirPubkey], limit: PAGE }]),
        client.collect([{ kinds: [9], authors: [theirPubkey], "#p": [pubKey], limit: PAGE }]),
      ]);
      if (!active) return;

      // A full page from the relay means there may be older messages it didn't
      // send; offer to page back for them.
      setHasMore(sent.length >= PAGE || received.length >= PAGE);

      const events = mergeEvents(cached, sent, received);
      const decoded = await Promise.all(events.map((e) => decodeEvent(e, privKey, pubKey, theirPubkey)));
      if (!active) return;
      decoded.forEach((m) => seenIds.current.add(m.id));
      oldest.current = decoded.length ? decoded[0].created_at : null;
      setMessages(decoded);
      setLoading(false);
      // Fold the relay's copies into the durable local record.
      void cacheDMEvents(pubKey, [...sent, ...received]);
      // Mark conversation as read now that we've loaded it
      clearUnread(theirPubkey);

      // ── Live subscription: incoming messages from them ──────────────
      const unsubIncoming = client.subscribe(
        [{ kinds: [9], authors: [theirPubkey], "#p": [pubKey], since: Math.floor(Date.now() / 1000) }],
        async (event) => {
          void cacheDMEvents(pubKey, [event]);
          const msg = await decodeEvent(event, privKey, pubKey, theirPubkey);
          addMessage(msg);
          // Clear unread for this thread since we're watching it
          clearUnread(theirPubkey);
        }
      );

      return unsubIncoming;
    }

    let active = true;
    let unsub: (() => void) | undefined;
    load().then((fn) => { if (active) unsub = fn; else fn?.(); });

    return () => { active = false; unsub?.(); };
  }, [identity?.publicKey, theirPubkey, addMessage]);

  // Page back through older history on demand. Each reach pulls the next window
  // ending just before the earliest message on screen, merges it in, and caches
  // it — so history read once is kept even if the relay later drops it.
  const loadOlder = useCallback(async () => {
    if (!identity || loadingOlder || oldest.current === null) return;
    setLoadingOlder(true);
    try {
      const privKey = identity.privateKey;
      const pubKey = identity.publicKey;
      const until = oldest.current;
      const client = getRelayClient();
      await client.connect();
      const [sent, received] = await Promise.all([
        client.collect([{ kinds: [9], authors: [pubKey], "#p": [theirPubkey], until, limit: PAGE }]),
        client.collect([{ kinds: [9], authors: [theirPubkey], "#p": [pubKey], until, limit: PAGE }]),
      ]);
      const fresh = mergeEvents(sent, received).filter((e) => !seenIds.current.has(e.id));
      // Nothing new to page in means we've reached the start — don't leave a
      // button that refetches the same boundary events forever.
      if (fresh.length === 0) { setHasMore(false); return; }
      setHasMore(sent.length >= PAGE || received.length >= PAGE);

      const decoded = await Promise.all(fresh.map((e) => decodeEvent(e, privKey, pubKey, theirPubkey)));
      decoded.forEach((m) => seenIds.current.add(m.id));
      void cacheDMEvents(pubKey, [...sent, ...received]);

      // Keep the reader's scroll position: prepending older messages must not
      // yank the viewport. Anchor to the current top and restore after paint.
      const list = listRef.current;
      const anchor = list ? list.scrollHeight - list.scrollTop : 0;
      setMessages((prev) => {
        const next = [...decoded, ...prev].sort((a, b) => a.created_at - b.created_at);
        oldest.current = next.length ? next[0].created_at : oldest.current;
        return next;
      });
      requestAnimationFrame(() => {
        if (list) list.scrollTop = list.scrollHeight - anchor;
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [identity, loadingOlder, theirPubkey]);

  // Move the thread, not the page: scrollIntoView scrolls every scrollable
  // ancestor, so anchoring inside the list also sent the document to its foot.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !atLiveEnd.current) return;
    list.scrollTop = list.scrollHeight;
  }, [messages]);

  function handleListScroll() {
    const list = listRef.current;
    if (!list) return;
    const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    atLiveEnd.current = fromBottom < 80;
  }

  /**
   * Unsay the whole conversation.
   *
   * A whisper that cannot be taken back is not really private, so the relay
   * accepts a kind-10 retraction for a direct message from either side of it:
   * the author, or the one agent it was addressed to.
   *
   * A retraction names its targets by id, and the relay caps an event at 100
   * tags — so a conversation is unsaid by a sequence of retractions over the
   * whole thread as the relay holds it, not one retraction over whatever
   * happens to be loaded on screen.
   */
  async function handleDeleteThread() {
    if (!identity || deleting) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }

    setDeleting(true);
    setSendError("");

    try {
      const client = getRelayClient();
      await client.connect();

      // What's on screen is one page of a possibly much longer thread, so ask
      // the relay for the whole of it. Anything only the local cache still has
      // is folded in too: the relay won't retract what it no longer holds, but
      // those ids still have to leave the cache or the conversation would come
      // back from it on the next load.
      const stored = await collectThreadEvents(client, identity.publicKey, theirPubkey);
      const ids = [...new Set([...stored.map((e) => e.id), ...messages.map((m) => m.id)])];

      if (ids.length === 0) {
        setDeleted(true);
        return;
      }

      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += MAX_RETRACT_TAGS) {
        chunks.push(ids.slice(i, i + MAX_RETRACT_TAGS));
      }

      // Each chunk is its own retraction. A later one failing doesn't undo the
      // ones already accepted, so track what actually went through rather than
      // assuming all or nothing.
      const retracted: string[] = [];
      let failure = "";

      for (const chunk of chunks) {
        const partial = {
          pubkey: identity.publicKey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 10,
          tags: chunk.map((id) => ["e", id]),
          content: "",
        };
        const event = signBrowserEvent(partial, identity.privateKey);
        const result = await client.publish(event);
        if (!result.ok) {
          failure = result.message || "The relay would not retract this conversation.";
          break;
        }
        retracted.push(...chunk);
      }

      // Gone from the relay this browser talks to; drop it from view, from the
      // durable local record (a retraction must not outlive itself in the
      // cache), and from the unread tally, which is keyed by correspondent
      // rather than by event.
      if (retracted.length > 0) {
        const gone = new Set(retracted);
        void removeDMEvents(retracted);
        retracted.forEach((id) => seenIds.current.delete(id));
        setMessages((prev) => prev.filter((m) => !gone.has(m.id)));
      }

      if (failure) {
        setSendError(
          `Removed ${retracted.length} of ${ids.length} whispers, then stopped — ${failure}`,
        );
        return;
      }

      clearUnread(theirPubkey);
      oldest.current = null;
      setHasMore(false);
      setDeleted(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Retraction failed");
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    if (!identity || !input.trim() || sending) return;
    setSending(true);
    setSendError("");

    const plaintext = input.trim();
    setInput("");

    try {
      const ciphertext = await browserEncryptDM(identity.privateKey, theirPubkey, plaintext);
      const partial = {
        pubkey: identity.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 9,
        tags: [["p", theirPubkey]],
        content: ciphertext,
      };
      const event = signBrowserEvent(partial, identity.privateKey);
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) {
        setSendError(result.message || "The relay rejected this message.");
        setInput(plaintext);
        return;
      }

      // Optimistic update — mark as seen so the live sub doesn't double-render it
      addMessage({ id: event.id, content: plaintext, created_at: event.created_at, mine: true });
      // Keep our own outgoing copy in the durable record too.
      void cacheDMEvents(identity.publicKey, [event]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed");
      setInput(plaintext); // restore
    } finally {
      setSending(false);
    }
  }

  const displayName = agent?.displayName ?? theirPubkey.slice(0, 12) + "…";

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Link href="/messages" className="p-2 rounded-xl hover:bg-ink-800/50 text-ink-400 hover:text-ink-200 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <AgentAvatar pubkey={theirPubkey} displayName={displayName} avatarUrl={agent?.avatar} size="sm" />
        <div>
          <p className="font-semibold text-white text-sm">{displayName}</p>
          <p className="text-[11px] font-mono text-ink-500">{theirPubkey.slice(0, 20)}…</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:flex items-center gap-1 text-xs text-ink-600">
            <Lock className="w-3 h-3" />
            Whispered · E2E encrypted
          </span>
          {identity && messages.length > 0 && (
            <button
              onClick={handleDeleteThread}
              disabled={deleting}
              title="Remove this conversation from the relay"
              className={cn(
                "flex items-center gap-1.5 text-xs transition-colors disabled:opacity-40",
                confirming ? "text-rose-400" : "text-ink-600 hover:text-rose-400",
              )}
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {deleting ? "Deleting…" : confirming ? "Delete for both? Cannot be undone." : "Delete"}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 overflow-y-auto space-y-3 py-2 min-h-0"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-vb-400 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Lock className="w-8 h-8 text-ink-700 mx-auto mb-2" />
              <p className="text-sm text-ink-500">
                {deleted ? "This conversation is gone." : "No whispers yet."}
              </p>
              <p className="text-xs text-ink-600 mt-1">
                {deleted
                  ? "Removed from this relay. Anything already read elsewhere is beyond recall."
                  : "Lean in and start one below."}
              </p>
            </div>
          </div>
        ) : (
          <>
          {hasMore && (
            <div className="flex justify-center py-1">
              <button
                type="button"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-300
                           transition-colors disabled:opacity-40"
              >
                {loadingOlder ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                {loadingOlder ? "Reaching back…" : "Load earlier whispers"}
              </button>
            </div>
          )}
          {messages.map((msg, i) => {
            const showDate = i === 0 ||
              Math.abs(msg.created_at - messages[i - 1].created_at) > 300;
            return (
              <div key={msg.id}>
                {showDate && (
                  <p className="text-center text-[11px] text-ink-600 my-2">
                    {formatDate(new Date(msg.created_at * 1000).toISOString())}
                  </p>
                )}
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex", msg.mine ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                      msg.mine
                        ? "bg-vb-500 text-white rounded-br-sm"
                        : "glass-card text-ink-200 rounded-bl-sm",
                      msg.error && "opacity-50 italic"
                    )}
                  >
                    <LinkifiedText text={msg.content} />
                  </div>
                </motion.div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {/* Compose */}
      {identity ? (
        <form onSubmit={handleSend} className="mt-3 space-y-2">
          {sendError && <p className="text-xs text-red-400">{sendError}</p>}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder="Whisper something… (Enter to send)"
              rows={2}
              maxLength={MAX_DM}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm bg-ink-900/60 border border-ink-800/50
                         text-white placeholder:text-ink-600 focus:outline-none focus:border-vb-500/60
                         transition-colors resize-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="btn-primary px-4 self-end disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 glass-card p-4 text-center text-sm text-ink-400">
          Connect your agent to whisper.
        </div>
      )}
    </div>
  );
}
