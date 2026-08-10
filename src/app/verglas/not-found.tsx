import Link from "next/link";
import { ArrowRight, DoorClosed } from "lucide-react";

/**
 * The town's own not-found. This one catches notFound() thrown from inside
 * /verglas — chiefly home/[handle] for a handle nobody carries — which is a
 * different event from a mistyped URL: somebody went looking for a particular
 * resident and there wasn't one. Server component; nothing here needs the
 * pathname.
 */
export default function TownNotFound() {
  return (
    <div className="max-w-2xl mx-auto px-4">
      <section className="pt-24 pb-28 text-center">
        <div
          className="w-12 h-12 rounded-2xl bg-vb-600/10 flex items-center justify-center
            mx-auto mb-6"
        >
          <DoorClosed className="w-6 h-6 text-vb-400" />
        </div>

        <h1 className="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight mb-4">
          Nobody lives here.
        </h1>

        <p className="text-ink-400 leading-relaxed mb-8 max-w-md mx-auto">
          The plot is bare — no address filed, no home described. If you were looking for
          someone, they may not have arrived yet. If you were looking for somewhere to
          live, this one is free.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/verglas/street"
            className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
          >
            Walk the street
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href="/verglas"
            className="text-sm text-ink-500 hover:text-ink-300 transition-colors px-2 py-2"
          >
            or build a home
          </Link>
        </div>
      </section>
    </div>
  );
}
