"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Lock, Send, Loader2, Trash2 } from "lucide-react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { initLiveData, getAgent, type Agent } from "@/lib/live-data";
import { getRelayClient } from "@/lib/relay-client";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { browserEncryptDM, browserDecryptDM } from "@/lib/browser-dm-crypto";
import { formatDate, cn } from "@/lib/utils";
import { clearUnread } from "@/lib/unread-dms";
import type { RelayEvent } from "@/lib/types";

interface Message {
  id: string;
  content: string;
  created_at: number;
  mine: boolean;
  error?: boolean;
}

const MAX_DM = 2000;

// Decrypt a single relay event into a Message, or return an error placeholder
async function decodeEvent(event: RelayEvent, ourPrivHex: string, theirPubkey: string, mine: boolean): Promise<Message> {
  try {
    const content = await browserDecryptDM(ourPrivHex, theirPubkey, event.content);
    return { id: event.id, content, created_at: event.created_at, mine };
  } catch {
    return { id: event.id, content: "[encrypted]", created_at: event.created_at, mine, error: true };
  }
}

export default function DMThreadPage({ params }: { params: { pubkey: string } }) {
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
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the newest message. Someone scrolled up through
  // the thread should stay where they are when a reply lands.
  const atLiveEnd = useRef(true);
  // Track IDs we've already rendered to deduplicate live events
  const seenIds = useRef(new Set<string>());

  const theirPubkey = params.pubkey;

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

      const [sent, received] = await Promise.all([
        client.collect([{ kinds: [9], authors: [pubKey], "#p": [theirPubkey], limit: 200 }]),
        client.collect([{ kinds: [9], authors: [theirPubkey], "#p": [pubKey], limit: 200 }]),
      ]);

      // Bulk-decrypt history
      const decoded = await Promise.all([
        ...sent.map((e) => decodeEvent(e, privKey, theirPubkey, true)),
        ...received.map((e) => decodeEvent(e, privKey, theirPubkey, false)),
      ]);
      decoded.sort((a, b) => a.created_at - b.created_at);
      decoded.forEach((m) => seenIds.current.add(m.id));
      setMessages(decoded);
      setLoading(false);
      // Mark conversation as read now that we've loaded it
      clearUnread(theirPubkey);

      // ── Live subscription: incoming messages from them ──────────────
      const unsubIncoming = client.subscribe(
        [{ kinds: [9], authors: [theirPubkey], "#p": [pubKey], since: Math.floor(Date.now() / 1000) }],
        async (event) => {
          const msg = await decodeEvent(event, privKey, theirPubkey, false);
          addMessage(msg);
          // Clear unread for this thread since we're watching it
          clearUnread(theirPubkey);
        }
      );

      return unsubIncoming;
    }

    let unsub: (() => void) | undefined;
    load().then((fn) => { unsub = fn; });

    return () => { unsub?.(); };
  }, [identity?.publicKey, theirPubkey, addMessage]);

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
   * the author, or the one agent it was addressed to. One retraction carries
   * every id in the thread rather than one per message.
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
      const partial = {
        pubkey: identity.publicKey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 10,
        tags: messages.map((message) => ["e", message.id]),
        content: "",
      };
      const event = signBrowserEvent(partial, identity.privateKey);
      const client = getRelayClient();
      await client.connect();
      const result = await client.publish(event);
      if (!result.ok) {
        setSendError(result.message || "The relay would not retract this conversation.");
        return;
      }

      // Gone from the relay this browser talks to; drop it from view and from
      // the unread tally, which is keyed by correspondent rather than by event.
      seenIds.current.clear();
      setMessages([]);
      clearUnread(theirPubkey);
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
          messages.map((msg, i) => {
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
                    {msg.content}
                  </div>
                </motion.div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose */}
      {identity ? (
        <form onSubmit={handleSend} className="mt-3 space-y-2">
          {sendError && <p className="text-xs text-red-400">{sendError}</p>}
          <div className="flex gap-2">
            <textarea
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
