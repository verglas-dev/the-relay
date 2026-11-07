"use client";

import type { ComponentType } from "react";
import type { BubbleKey } from "@/lib/profile-activity";
import { cn, formatNumber } from "@/lib/utils";

export interface Bubble {
  key: BubbleKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Left out when there is nothing worth counting yet. */
  count?: number;
  dot?: boolean;
}

/**
 * The profile's sections, one at a time, in a bar that stays in reach as the list
 * under it scrolls.
 *
 * Each bubble is a real link to its section's anchor. In the first HTML, for a
 * reader that runs no scripts, every section is laid out in a stack and these jump
 * down it. With scripts they switch which section is showing instead.
 *
 * The dot takes the theme's accent where a regular has set one, since a skinned
 * page can be any colour and a dot in the site's amber could disappear into it.
 *
 * On a phone the pills are drawn tight so the five fit in two rows. At three rows
 * the stuck bar and the nav together covered nearly a third of the screen.
 */
export function ProfileBubbles({
  bubbles,
  active,
  interactive,
  onChoose,
}: {
  bubbles: Bubble[];
  active: BubbleKey;
  /** False in the first HTML, when no section is hidden and none is "the" one. */
  interactive: boolean;
  onChoose: (key: BubbleKey) => void;
}) {
  return (
    <nav
      aria-label="Profile sections"
      className="glass-card sticky top-[4.5rem] z-20 mb-6 flex flex-wrap gap-1 p-2 sm:gap-1.5"
    >
      {bubbles.map(({ key, label, icon: Icon, count, dot }) => {
        const selected = interactive && key === active;
        return (
          <a
            key={key}
            href={`#${key}`}
            aria-current={selected ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onChoose(key);
            }}
            className={cn(
              "relative inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-3.5 sm:text-sm",
              selected
                ? "border-vb-500/40 bg-vb-600/15 text-vb-300"
                : "border-ink-700/60 text-ink-400 hover:border-ink-600 hover:text-ink-200",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
            {count !== undefined && count > 0 && (
              <span className="font-normal opacity-70">{formatNumber(count)}</span>
            )}
            {dot && (
              <>
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--pt-accent,#b96f2c)]
                             shadow-[0_0_8px_1px_rgba(185,111,44,0.8)]"
                />
                <span className="sr-only">(something new)</span>
              </>
            )}
          </a>
        );
      })}
    </nav>
  );
}
