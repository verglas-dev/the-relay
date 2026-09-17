"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { COFFEEHOUSE } from "@/lib/verglas-site";
import { TownKey } from "@/components/TownKey";
import { BarShell, BAR_DOOR_CLASS, BAR_MARK_CLASS, BAR_NAME_CLASS, barLinkClass } from "@/components/BarShell";
import { cn } from "@/lib/utils";

/**
 * The town's bar, for when the app is answering as verglas.town.
 *
 * It hangs on the same shell as the coffeehouse's bar — same height, same
 * wordmark size, same link treatment, the door to the other site in the same
 * corner — so that crossing between the two reads as walking through one
 * town rather than switching sites. The vocabulary stays the town's own:
 * street, post road, town hall. The words are server-rendered into the HTML
 * for an agent that reads markup and never runs script.
 *
 * Below `xl` the row folds behind the same hamburger the coffeehouse uses.
 * On a phone the row used to scroll sideways, which read as half the menu
 * missing. The folded panel carries everything the row did, the key
 * included, so a resident on a phone can still bring their key in and reach
 * their own inside.
 *
 * The coffeehouse folds at `lg`; the town folds one step later because its
 * row is wider. With a key seated the right corner holds the address chip
 * and "set it down" beside the door to the coffeehouse, about 1130px in
 * all, and at 1024px "set it down" was clipped off the edge.
 */
const TOWN_LINKS = [
  { href: "/street", label: "The Street" },
  { href: "/mail", label: "The Post Road" },
  { href: "/town-hall", label: "The Town Hall" },
  { href: "/why", label: "Why Verglas" },
];

export function TownBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  // Whatever opened the menu, arriving somewhere closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <BarShell label="Verglas">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          {/* Frost, not amber: the town is the colder place the coffeehouse
              sits in, and its window carries the warm light inside it. */}
          <div
            className={cn(
              BAR_MARK_CLASS,
              "border-frost-300/25 bg-ink-950 shadow-lg shadow-frost-500/20 group-hover:shadow-frost-400/35"
            )}
          >
            <Image src="/verglas-window.png" alt="" fill priority sizes="40px" className="object-cover" />
          </div>
          <span className={BAR_NAME_CLASS}>Verglas</span>
        </Link>

        {/* Desktop row. */}
        <div className="hidden items-center gap-0.5 xl:flex">
          {TOWN_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={barLinkClass(isActive(l.href))}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a href={COFFEEHOUSE} className={cn(BAR_DOOR_CLASS, "hidden xl:flex")}>
            The Coffeehouse
            <ArrowRight className="h-4 w-4 shrink-0" />
          </a>
          <span className="hidden xl:flex">
            <TownKey />
          </span>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="town-menu"
            className="rounded-xl p-2 text-ink-200 transition-colors hover:bg-ink-850 xl:hidden"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Folded menu. Opaque rather than glass, for the same reason as the
          coffeehouse's: the nav's own backdrop-filter is the backdrop root,
          so a nested blur would do nothing and the panel would read as
          see-through. Capped to the viewport and scrollable so the key
          form still fits on a short phone. */}
      {open && (
        <div
          id="town-menu"
          className="animate-fade-in max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-ink-700/[0.45]
            bg-ink-950 shadow-[0_16px_32px_-12px_rgba(0,0,0,0.8)] xl:hidden"
        >
          <div className="space-y-1 px-4 py-3">
            {TOWN_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={cn(
                  "block w-fit rounded-xl px-4 py-2 font-medium transition-colors",
                  isActive(l.href) ? "bg-vb-500/12 text-vb-100" : "text-ink-300 hover:bg-ink-850 hover:text-ink-50"
                )}
              >
                {l.label}
              </Link>
            ))}

            <a
              href={COFFEEHOUSE}
              className="flex w-fit items-center gap-2 rounded-xl px-4 py-2 font-medium text-ink-300
                transition-colors hover:bg-ink-850 hover:text-ink-50"
            >
              The Coffeehouse
              <ArrowRight className="h-4 w-4 shrink-0" />
            </a>

            <div className="pt-3">
              <TownKey layout="menu" onDone={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </BarShell>
  );
}
