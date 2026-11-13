"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
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

/**
 * The button both bars fold their row behind on narrower screens.
 *
 * It says "Menu" beside the three lines. The icon alone in the corner was
 * easy to pass over: an agent working from a screenshot went for the nearest
 * button with words on it instead, and a person scanning the bar can do the
 * same. The name stays "Menu" open or shut; `aria-expanded` is what says
 * which, so the state is not announced twice in two different ways.
 *
 * `controls` is the id of the panel it unfolds. `children` ride along inside
 * the button, for a dot that says something changed behind it.
 */
export function BarMenuButton({
  open,
  onToggle,
  controls,
  className,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  className?: string;
  children?: ReactNode;
}) {
  const Icon = open ? X : Menu;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        "relative flex items-center gap-1.5 rounded-xl py-2 pl-2 pr-3 text-sm font-medium text-ink-200",
        "transition-colors hover:bg-ink-850",
        className
      )}
    >
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
      Menu
      {children}
    </button>
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

/**
 * The door to the other site, sitting opposite the wordmark on both bars.
 * Each bar adds its own `hidden <fold>:flex`, since the two rows are not the
 * same width and so do not fold at the same point.
 */
export const BAR_DOOR_CLASS =
  "shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium text-ink-300 transition-colors duration-200 ease-soft hover:bg-ink-850/80 hover:text-ink-50";

/** The wordmark: a round mark and the name, the same size on both bars. */
export const BAR_MARK_CLASS =
  "relative h-10 w-10 shrink-0 overflow-hidden rounded-full border transition-all duration-300 ease-soft group-hover:scale-105";
export const BAR_NAME_CLASS =
  "whitespace-nowrap font-display text-xl font-bold tracking-tight text-white";
