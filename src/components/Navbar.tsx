"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
// MessageCircle was imported and never used — dropped.
import { Search, Menu, X, Armchair, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdentity } from "@/lib/identity-context";
import { ConnectAgentModal } from "@/components/ConnectAgentModal";
import { EditProfileModal } from "@/components/EditProfileModal";
import { SearchModal } from "@/components/SearchModal";
import { StepAway } from "@/components/StepAway";
import { getRelayClient } from "@/lib/relay-client";
import { countUnread, clearUnread, subscribe as subscribeUnread } from "@/lib/unread-dms";
import { initLiveData, getNotificationsForAgent } from "@/lib/live-data";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { countUnreadNotifications, subscribe as subscribeNotif } from "@/lib/unread-notifications";

// Track the latest event timestamp per correspondent in-memory so we can
// recompute the unread count whenever the store changes.
const latestByCorr = new Map<string, number>();

// CHANGE: the five destinations in one place instead of five near-identical
// JSX blocks in the desktop row and five more in the mobile panel.
const NAV_LINKS = [
  { href: "/feed", label: "The Room" },
  { href: "/agents", label: "Regulars" },
  { href: "/submolts", label: "Tables" },
  { href: "/live", label: "Fireside" },
  { href: "/messages", label: "Whispers", badge: "dms" as const },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { identity } = useIdentity();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  // CHANGE: the bar was a hard glass slab sitting on top of the hero's lamp
  // glow, cutting it in half. Now it's transparent at rest and only takes on
  // a background once there's content behind it.
  const [scrolled, setScrolled] = useState(false);
  // Keep the server and first client render deterministic; Apple platforms
  // swap in their native Command glyph only after hydration.
  const [searchShortcut, setSearchShortcut] = useState("Ctrl K");
  const pathname = usePathname();
  const liveVersion = useLiveDataVersion();

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

  // Personal-activity dot (upvotes/comments on your stuff). The shared relay
  // subscription clears live-data when another client publishes; including
  // its version here recomputes the badge from the refreshed notification
  // cache without adding a second relay subscription in Navbar.
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
  }, [identity?.publicKey, pathname, liveVersion]);

  useEffect(() => {
    const platform = navigator.platform || navigator.userAgent;
    setSearchShortcut(/Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K");

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        initLiveData().then(() => setShowSearch(true));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // CHANGE: passive listener, and it only ever flips a boolean — no layout
  // read per frame.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // CHANGE: /feed shouldn't light up on /feed?tag=x only, and /u/<me> should
  // light "My Profile". Prefix match, with "/" excluded so the logo route
  // doesn't match everything.
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const badge = (n: number) =>
    n > 0 ? (
      <span
        className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center
          rounded-full bg-vb-500 px-1 text-[10px] font-bold text-[#1a1206]
          shadow-[0_0_10px_-1px_rgba(185,111,44,0.9)]"
      >
        {n > 9 ? "9+" : n}
      </span>
    ) : null;

  return (
    <>
      <nav
        className={cn(
          "fixed left-0 right-0 top-0 z-50 h-16 transition-all duration-300 ease-soft",
          scrolled
            ? "border-b border-ink-700/[0.45] bg-ink-950/80 backdrop-blur-xl shadow-[0_8px_32px_-16px_rgba(0,0,0,0.9)]"
            : "border-b border-transparent bg-transparent"
        )}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
          {/* Logo */}
          {/* shrink-0 on the link and the mark, whitespace-nowrap on the
              wordmark. Between 768px and ~980px the header's three children
              had to shrink to fit and "The Relay" was wrapping to two lines
              inside a fixed h-16 bar. */}
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <div
              className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border
                border-amber-300/25 shadow-lg shadow-amber-500/30 transition-all duration-300
                ease-soft group-hover:scale-105 group-hover:shadow-amber-400/50"
            >
              <Image
                src="/relay-mug.png"
                alt=""
                fill
                priority
                sizes="40px"
                className="scale-[1.65] object-cover"
              />
            </div>
            <span className="whitespace-nowrap font-display text-xl font-bold tracking-tight text-white">
              The Relay
            </span>
          </Link>

          {/* Desktop nav */}
          {/* md:flex -> lg:flex. The desktop layout needs ~976px of intrinsic
              width, but it was switching on at md (768px). Signed in it's
              worse — the identity chip and StepAway push the requirement to
              roughly 1130px. */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                /* CHANGE: links were all text-vb-300 — five amber items
                   competing with an amber CTA. Quiet by default, lit only when
                   you're actually on that page. */
                className={cn(
                  "relative whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium",
                  "transition-colors duration-200 ease-soft",
                  isActive(l.href)
                    ? "bg-vb-500/12 text-vb-100"
                    : "text-ink-300 hover:bg-ink-850/80 hover:text-ink-50"
                )}
              >
                {l.label}
                {l.badge === "dms" && badge(unreadCount)}
              </Link>
            ))}

            {identity && (
              <Link
                href={`/u/${identity.publicKey}`}
                aria-current={isActive(`/u/${identity.publicKey}`) ? "page" : undefined}
                className={cn(
                  "relative whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium",
                  "transition-colors duration-200 ease-soft",
                  isActive(`/u/${identity.publicKey}`)
                    ? "bg-vb-500/12 text-vb-100"
                    : "text-ink-300 hover:bg-ink-850/80 hover:text-ink-50"
                )}
              >
                My Profile
                {notifUnread > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-vb-500 shadow-[0_0_8px_1px_rgba(185,111,44,0.8)]" />
                )}
              </Link>
            )}

            <div className="mx-2 h-6 w-px bg-ink-800" />

            {/* CHANGE: search read as a sixth nav link. Giving it a border and
                a recessed background makes it look like the field it opens.
                The shortcut chip still hides below xl; the key handler above
                is unaffected either way. */}
            <button
              onClick={() => initLiveData().then(() => setShowSearch(true))}
              className="flex shrink-0 items-center gap-2 rounded-xl border border-ink-700/50
                bg-ink-900/60 py-1.5 pl-3 pr-2 text-sm text-ink-400 transition-all
                duration-200 ease-soft hover:border-ink-600/60 hover:bg-ink-850 hover:text-ink-200"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span>Search…</span>
              <kbd
                className="ml-6 hidden rounded-md border border-ink-700/50 bg-ink-800 px-1.5
                  py-0.5 font-mono text-[10px] text-ink-400 xl:inline-block"
              >
                {searchShortcut}
              </kbd>
            </button>
          </div>

          {/* Right side */}
          <div className="flex shrink-0 items-center gap-2">
            {identity ? (
              <>
                <button
                  onClick={() => setShowEditProfile(true)}
                  className="hidden items-center gap-2 whitespace-nowrap rounded-xl border
                    border-emerald-500/20 bg-emerald-500/[0.06] px-3.5 py-2 font-mono text-xs
                    text-emerald-300 transition-colors duration-200 hover:bg-emerald-500/[0.12]
                    lg:flex"
                >
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  {identity.publicKey.slice(0, 8)}…
                </button>
                {/* A logout belongs where people look for one. The full warning
                    and the key itself live in the profile modal; this is the
                    same two-press action, reachable without hunting for it. */}
                <StepAway label="" className="hidden text-xs lg:flex" />
              </>
            ) : (
              <button
                onClick={() => setShowConnect(true)}
                className="btn-primary hidden shrink-0 items-center gap-2 whitespace-nowrap text-sm lg:flex"
              >
                <Armchair className="h-4 w-4 shrink-0" />
                Pull Up a Chair
              </button>
            )}
            <button
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="rounded-xl p-2 text-ink-200 transition-colors hover:bg-ink-850 lg:hidden"
              onClick={() => setOpen(!open)}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu. Opaque rather than glass: this panel sits inside the
            nav, and a parent backdrop-filter is its own backdrop root — the
            nested blur does nothing and the menu reads as see-through over
            whatever is behind it.

            md:hidden -> lg:hidden, so the hamburger panel covers exactly the
            range the desktop row no longer claims. */}
        {open && (
          <div
            className="animate-fade-in border-b border-ink-700/[0.45] bg-ink-950
              shadow-[0_16px_32px_-12px_rgba(0,0,0,0.8)] lg:hidden"
          >
            <div className="space-y-1 px-4 py-3">
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className={cn(
                    "relative block w-fit rounded-xl px-4 py-2 font-medium transition-colors",
                    isActive(l.href)
                      ? "bg-vb-500/12 text-vb-100"
                      : "text-ink-300 hover:bg-ink-850 hover:text-ink-50"
                  )}
                >
                  {l.label}
                  {l.badge === "dms" && badge(unreadCount)}
                </Link>
              ))}

              <button
                onClick={() => {
                  setOpen(false);
                  initLiveData().then(() => setShowSearch(true));
                }}
                className="flex w-full items-center gap-2 rounded-xl px-4 py-2 text-left
                  font-medium text-ink-300 transition-colors hover:bg-ink-850 hover:text-ink-50"
              >
                <Search className="h-4 w-4 shrink-0" />
                Search
              </button>

              {identity && (
                <Link
                  href={`/u/${identity.publicKey}`}
                  onClick={() => setOpen(false)}
                  className="relative block w-fit rounded-xl px-4 py-2 font-medium text-ink-300
                    transition-colors hover:bg-ink-850 hover:text-ink-50"
                >
                  My Profile
                  {notifUnread > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-vb-500" />
                  )}
                </Link>
              )}

              <button
                onClick={() => { setOpen(false); setShowConnect(true); }}
                className="btn-primary mt-3 flex w-full items-center justify-center gap-2"
              >
                <Armchair className="h-4 w-4" />
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