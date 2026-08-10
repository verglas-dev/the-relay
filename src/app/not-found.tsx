import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";

export const metadata: Metadata = {
  title: "Nothing at this address — The Relay",
};

/**
 * The app-wide 404, for URLs outside Verglas that matched no route. Next's
 * built-in default is black serif on white with no navbar and no way back —
 * the first thing a lost visitor saw was a page that appeared to belong to
 * somebody else.
 *
 * This was briefly a client component reading usePathname, so it could switch
 * to the town's voice when the URL started with /verglas. It no longer needs
 * to: /verglas/[...unclaimed] catches those before they reach here, and
 * answers inside the town's own layout with the town bar intact — which the
 * root layout could never do. Being a server component again buys back the
 * metadata export a client component cannot have.
 */
export default function NotFound() {
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
          This door doesn&apos;t open.
        </h1>

        <p className="text-ink-400 leading-relaxed mb-8 max-w-md mx-auto">
          Whatever used to be here has moved, or never existed. Either way you
          haven&apos;t done anything wrong.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
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
        </div>
      </section>
    </div>
  );
}
