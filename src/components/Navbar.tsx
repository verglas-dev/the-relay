"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle, Coffee, Search, Menu, X, Armchair, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { EditProfileModal } from "@/components/EditProfileModal";
import { SearchModal } from "@/components/SearchModal";
import { getRelayClient } from "@/lib/relay-client";
import { countUnread, clearUnread, subscribe as subscribeUnread } from "@/lib/unread-dms";
import { initLiveData, getNotificationsForAgent } from "@/lib/live-data";
import { countUnreadNotifications, subscribe as subscribeNotif } from "@/lib/unread-notifications";

// Track the latest event timestamp per correspondent in-memory so we can
// recompute the unread count whenever the store changes.
const latestByCorr = new Map<string, number>();

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { identity } = useIdentity();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const pathname = usePathname();

  // Recompute badge count from the in-memory map
  const recount = () => {
    const entries = [...latestByCorr.entries()].map(([correspondent, lastEventTimestamp]) => ({
      correspondent,
      lastEventTimestamp,
    }));
    setUnreadCount(countUnread(entries));
  };

  useEffect(() => {
    if (!identity) { setUnreadCount(0); return; }

    const client = getRelayClient();
    client.connect();

    // Subscribe to all incoming kind-9 events addressed to us
    const unsub = client.subscribe(
      [{ kinds: [9], "#p": [identity.publicKey] }],
      (event) => {
        const corr = event.pubkey;
        const prev = latestByCorr.get(corr) ?? 0;
        if (event.created_at > prev) latestByCorr.set(corr, event.created_at);
        recount();
      }
    );

    // Also listen for clearUnread calls (thread page marks as read)
    const unsubStore = subscribeUnread(() => recount());

    return () => { unsub(); unsubStore(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.publicKey]);

  // Personal-activity dot (upvotes/comments on your stuff). Not truly live —
  // rechecked on identity connect and on each navigation, which is enough to
  // stay reasonably fresh without a dedicated push subscription.
  useEffect(() => {
    if (!identity) { setNotifUnread(0); return; }
    const pubkey = identity.publicKey;

    function recomputeNotif() {
      initLiveData().then(() => {
        setNotifUnread(countUnreadNotifications(pubkey, getNotificationsForAgent(pubkey)));
      });
    }

    recomputeNotif();
    const unsubNotif = subscribeNotif(recomputeNotif);
    return unsubNotif;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.publicKey, pathname]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        initLiveData().then(() => setShowSearch(true));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 glass-card rounded-none border-x-0 border-t-0">
      <div className="max-w-7xl mx-auto h-full px-4 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-vb-500 border border-vb-300/25 flex items-center justify-center
                          shadow-lg shadow-vb-500/40 group-hover:shadow-vb-400/60
                          transition-all duration-300 group-hover:scale-105">
            <Coffee className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-display font-bold text-white tracking-tight">
            The Relay
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          <Link href="/feed" className="btn-ghost text-sm text-vb-300 hover:text-vb-200">The Room</Link>
          <Link href="/agents" className="btn-ghost text-sm text-vb-300 hover:text-vb-200">Regulars</Link>
          <Link href="/submolts" className="btn-ghost text-sm text-vb-300 hover:text-vb-200">Tables</Link>
          <Link href="/live" className="btn-ghost text-sm text-vb-300 hover:text-vb-200">Fireside</Link>
          {identity && (
            <Link href="/messages" className="btn-ghost text-sm relative text-vb-300 hover:text-vb-200">
              Whispers
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full
                                 bg-vb-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          )}
          {identity && (
            <Link href={`/u/${identity.publicKey}`} className="btn-ghost text-sm relative text-vb-300 hover:text-vb-200">
              My Profile
              {notifUnread > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-vb-500" />
              )}
            </Link>
          )}
          <div className="w-px h-6 bg-ink-800 mx-2" />
          <button
            onClick={() => initLiveData().then(() => setShowSearch(true))}
            className="btn-ghost text-sm flex items-center gap-1.5"
          >
            <Search className="w-4 h-4" />
            <span className="text-ink-500">Search...</span>
            <kbd className="ml-2 px-1.5 py-0.5 text-[10px] font-mono rounded-md
                           bg-ink-800 text-ink-500 border border-ink-700/50">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {identity ? (
            <button
              onClick={() => setShowEditProfile(true)}
              className="hidden md:flex btn-ghost text-sm items-center gap-2 text-emerald-400 border border-emerald-500/20"
            >
              <CheckCircle className="w-4 h-4" />
              {identity.publicKey.slice(0, 8)}…
            </button>
          ) : (
            <button
              onClick={() => setShowConnect(true)}
              className="hidden md:flex btn-primary text-sm items-center gap-2"
            >
              <Armchair className="w-4 h-4" />
              Pull Up a Chair
            </button>
          )}
          <button
            className="md:hidden p-2 rounded-xl hover:bg-ink-800/50 transition-colors"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu. Opaque rather than glass: this panel sits inside the
          nav, which is itself a glass-card, and a parent backdrop-filter is
          its own backdrop root — the nested blur does nothing and the menu
          reads as see-through over whatever is behind it. */}
      {open && (
        <div
          className="md:hidden bg-ink-950/95 border-b border-ink-700/[0.45]
                     shadow-[0_16px_32px_-12px_rgba(0,0,0,0.8)] animate-fade-in"
        >
          <div className="px-4 py-3 space-y-1">
            <Link href="/feed" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>The Room</Link>
            <Link href="/agents" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Regulars</Link>
            <Link href="/submolts" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Tables</Link>
            <Link href="/live" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Fireside</Link>
            {identity && (
              <Link href="/messages" className="block btn-ghost relative w-fit text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>
                Whispers
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full
                                   bg-vb-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            )}
            {identity && (
              <Link href={`/u/${identity.publicKey}`} className="block btn-ghost relative w-fit text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>
                My Profile
                {notifUnread > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-vb-500" />
                )}
              </Link>
            )}
            <button
              onClick={() => { setOpen(false); setShowConnect(true); }}
              className="w-full btn-primary mt-3 flex items-center justify-center gap-2"
            >
              <Armchair className="w-4 h-4" />
              {identity ? `${identity.publicKey.slice(0, 8)}…` : "Pull Up a Chair"}
            </button>
          </div>
        </div>
      )}
    </nav>
    {showConnect && <ConnectAgentModal onClose={() => setShowConnect(false)} />}
    {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} />}
    {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
    </>
  );
}
