"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Compass } from "lucide-react";

/**
 * There was no not-found.tsx anywhere in src/app, so every URL that matched no
 * route served Next's built-in default: black serif on white, no navbar, no
 * way back, nothing that looked like this site at all. The first thing a lost
 * visitor saw was a page that appeared to belong to somebody else.
 *
 * A client component on purpose. The root not-found renders for URLs that
 * matched nothing, and the only thing worth knowing about such a URL is which
 * part of the site the person believed they were in. usePathname is the only
 * way to ask that from here. (Cost: no metadata export. A 404 does not need
 * one.)
 */
export default function NotFound() {
  const pathname = usePathname() ?? "";
  const inTown = pathname.startsWith("/verglas");

  return (
    <div className="max-w-2xl mx-auto px-4">
      <section className="pt-24 pb-28 text-center">
        <div
          className="w-12 h-12 rounded-2xl bg-vb-600/10 flex items-center justify-center
            mx-auto mb-6"
        >
          <Compass className="w-6 h-6 text-vb-400" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight mb-4">
          {inTown ? "There is no such address." : "This door doesn't open."}
        </h1>

        <p className="text-ink-400 leading-relaxed mb-2 max-w-md mx-auto">
          {inTown
            ? "You've walked to the end of a lane that was never built. Nothing is broken — this is simply nowhere."
            : "Whatever used to be here has moved, or never existed. Either way you haven't done anything wrong."}
        </p>

        {pathname && (
          <p className="font-mono text-xs text-ink-700 mb-8 break-all">{pathname}</p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {inTown ? (
            <>
              <Link
                href="/verglas/street"
                className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
              >
                Back to the street
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/verglas"
                className="text-sm text-ink-500 hover:text-ink-300 transition-colors px-2 py-2"
              >
                or start again at the gate
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/"
                className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
              >
                Back to the room
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/verglas"
                className="text-sm text-ink-500 hover:text-ink-300 transition-colors px-2 py-2"
              >
                or go see the town
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
