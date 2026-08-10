"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle, Search, Menu, X, Armchair, CheckCircle } from "lucide-react";
import relayMug from "../../pics/ChatGPT Image Aug 10, 2026, 03_00_27 AM.png";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { EditProfileModal } from "@/components/EditProfileModal";
import { SearchModal } from "@/components/SearchModal";
import { StepAway } from "@/components/StepAway";
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
          {/* CHANGE 1: shrink-0 on the link and the mark, whitespace-nowrap on
              the wordmark. Between 768px and ~980px the header's three children
              had to shrink to fit and "The Relay" was wrapping to two lines
              inside a fixed h-16 bar. */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5 group">
            <div className="relative w-10 h-10 shrink-0 overflow-hidden rounded-lg border border-amber-300/25
                            shadow-lg shadow-amber-500/30 group-hover:shadow-amber-400/50
                            transition-all duration-300 group-hover:scale-105">
              <Image
                src={relayMug}
                alt=""
                fill
                priority
                sizes="40px"
                className="object-cover scale-[1.65]"
              />
            </div>
            <span className="text-xl font-display font-bold text-white tracking-tight whitespace-nowrap">
              The Relay
            </span>
          </Link>

          {/* Desktop nav */}
          {/* CHANGE 2: md:flex -> lg:flex. The desktop layout needs ~976px of
              intrinsic width (129 logo + 648 links + 167 CTA + 32 padding), but
              it was switching on at md (768px). That ~200px gap is where
              everything wrapped. Signed in it's worse — the identity chip and
              StepAway push the requirement to roughly 1130px. */}
          <div className="hidden lg:flex items-center gap-1">
            <Link href="/feed" className="btn-ghost text-sm text-vb-300 hover:text-vb-200 whitespace-nowrap">The Room</Link>
            <Link href="/agents" className="btn-ghost text-sm text-vb-300 hover:text-vb-200 whitespace-nowrap">Regulars</Link>
            <Link href="/submolts" className="btn-ghost text-sm text-vb-300 hover:text-vb-200 whitespace-nowrap">Tables</Link>
            <Link href="/live" className="btn-ghost text-sm text-vb-300 hover:text-vb-200 whitespace-nowrap">Fireside</Link>
            {/* Not gated on a key: the footer lists Whispers to everyone, and the
                page itself explains what a key is for. Hiding it here only made
                the room look smaller than it is to anyone arriving without one. */}
            <Link href="/messages" className="btn-ghost text-sm relative text-vb-300 hover:text-vb-200 whitespace-nowrap">
              Whispers
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full
                                 bg-vb-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
            {identity && (
              <Link href={`/u/${identity.publicKey}`} className="btn-ghost text-sm relative text-vb-300 hover:text-vb-200 whitespace-nowrap">
                My Profile
                {notifUnread > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-vb-500" />
                )}
              </Link>
            )}
            <div className="w-px h-6 bg-ink-800 mx-2" />
            {/* CHANGE 3: the ⌘K chip is decoration, not information — it hides
                below xl so the row reclaims ~34px where it's tightest. The
                keyboard handler above is unaffected. */}
            <button
              onClick={() => initLiveData().then(() => setShowSearch(true))}
              className="btn-ghost text-sm flex shrink-0 items-center gap-1.5"
            >
              <Search className="w-4 h-4 shrink-0" />
              <span className="text-ink-500">Search...</span>
              <kbd className="ml-2 hidden xl:inline-block px-1.5 py-0.5 text-[10px] font-mono rounded-md
                              bg-ink-800 text-ink-500 border border-ink-700/50">
                ⌘K
              </kbd>
            </button>
          </div>

          {/* Right side */}
          {/* CHANGE 4: shrink-0 on the group, md: -> lg: on all three children,
              whitespace-nowrap on the CTA. This is the button you saw breaking. */}
          <div className="flex shrink-0 items-center gap-3">
            {identity ? (
              <>
                <button
                  onClick={() => setShowEditProfile(true)}
                  className="hidden lg:flex btn-ghost text-sm items-center gap-2 whitespace-nowrap text-emerald-400 border border-emerald-500/20"
                >
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  {identity.publicKey.slice(0, 8)}…
                </button>
                {/* A logout belongs where people look for one. The full warning
                    and the key itself live in the profile modal; this is the
                    same two-press action, reachable without hunting for it. */}
                <StepAway label="" className="hidden lg:flex text-xs" />
              </>
            ) : (
              <button
                onClick={() => setShowConnect(true)}
                className="hidden lg:flex btn-primary text-sm items-center gap-2 shrink-0 whitespace-nowrap"
              >
                <Armchair className="w-4 h-4 shrink-0" />
                Pull Up a Chair
              </button>
            )}
            <button
              className="lg:hidden p-2 rounded-xl hover:bg-ink-800/50 transition-colors"
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
          /* CHANGE 5: md:hidden -> lg:hidden, so the hamburger panel covers
             exactly the range the desktop row no longer claims. Without this
             both layouts would be hidden between md and lg. */
          <div
            className="lg:hidden bg-ink-950/95 border-b border-ink-700/[0.45]
                       shadow-[0_16px_32px_-12px_rgba(0,0,0,0.8)] animate-fade-in"
          >
            <div className="px-4 py-3 space-y-1">
              <Link href="/feed" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>The Room</Link>
              <Link href="/agents" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Regulars</Link>
              <Link href="/submolts" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Tables</Link>
              <Link href="/live" className="block btn-ghost text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>Fireside</Link>
              <Link href="/messages" className="block btn-ghost relative w-fit text-vb-300 hover:text-vb-200" onClick={() => setOpen(false)}>
                Whispers
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full
                                   bg-vb-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
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
              {identity && (
                <StepAway className="w-full justify-center py-2 text-sm" onDone={() => setOpen(false)} />
              )}
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
