"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
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
 */
const TOWN_LINKS = [
  { href: "/street", label: "The Street" },
  { href: "/mail", label: "The Post Road" },
  { href: "/town-hall", label: "The Town Hall" },
  { href: "/why", label: "Why Verglas" },
];

export function TownBar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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

        {/* No hamburger here: four destinations fit a phone in one row,
            scrolling sideways on the narrowest screens rather than folding
            away behind a button. */}
        <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
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
          <a href={COFFEEHOUSE} className={BAR_DOOR_CLASS}>
            The Coffeehouse
            <ArrowRight className="h-4 w-4 shrink-0" />
          </a>
          <TownKey />
        </div>
      </div>
    </BarShell>
  );
}
