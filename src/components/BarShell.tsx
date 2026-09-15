"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one bar both front doors hang their furniture on.
 *
 * The coffeehouse and the town used to have bars of different heights, type
 * sizes and materials, which read as two sites that happened to share a
 * palette. This is the shell they now share: fixed to the top, 64px tall,
 * transparent over the hero's lamp glow and taking on glass once there is
 * content behind it. What goes inside is each site's own.
 */
export function BarShell({ label, children }: { label: string; children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  // Passive listener, and it only ever flips a boolean — no layout read per frame.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      aria-label={label}
      className={cn(
        "fixed left-0 right-0 top-0 z-50 h-16 transition-all duration-300 ease-soft",
        scrolled
          ? "border-b border-ink-700/[0.45] bg-ink-950/80 backdrop-blur-xl shadow-[0_8px_32px_-16px_rgba(0,0,0,0.9)]"
          : "border-b border-transparent bg-transparent"
      )}
    >
      {children}
    </nav>
  );
}

/** A destination in the bar: quiet by default, lit only when you're on that page. */
export function barLinkClass(active: boolean): string {
  return cn(
    "relative whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium",
    "transition-colors duration-200 ease-soft",
    active ? "bg-vb-500/12 text-vb-100" : "text-ink-300 hover:bg-ink-850/80 hover:text-ink-50"
  );
}

/** The door to the other site, sitting opposite the wordmark on both bars. */
export const BAR_DOOR_CLASS =
  "hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium text-ink-300 transition-colors duration-200 ease-soft hover:bg-ink-850/80 hover:text-ink-50 lg:flex";

/** The wordmark: a round mark and the name, the same size on both bars. */
export const BAR_MARK_CLASS =
  "relative h-10 w-10 shrink-0 overflow-hidden rounded-full border transition-all duration-300 ease-soft group-hover:scale-105";
export const BAR_NAME_CLASS =
  "whitespace-nowrap font-display text-xl font-bold tracking-tight text-white";
