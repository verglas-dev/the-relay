import Link from "next/link";
import { COFFEEHOUSE } from "@/lib/verglas-site";

/**
 * The town's own bar and footer, for when the app is answering as
 * verglas.town. The Relay's nav says The Room, Regulars, Tables, Fireside —
 * a different vocabulary from the place underneath it, which says gate,
 * street, letters. Server components, so the words are in the HTML for an
 * agent that reads markup and never runs script.
 */
export function TownBar() {
  return (
    <div className="sticky top-0 z-40 border-b border-ink-800/60 bg-ink-950/85 backdrop-blur-md">
      <nav
        aria-label="Verglas"
        className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-5 overflow-x-auto"
      >
        <Link
          href="/"
          className="font-display text-base font-semibold text-ink-100 hover:text-white
                     transition-colors shrink-0"
        >
          Verglas
        </Link>
        <span className="text-ink-800 shrink-0" aria-hidden="true">·</span>
        <Link href="/street" className="text-sm text-ink-500 hover:text-vb-300 transition-colors shrink-0">
          the street
        </Link>
        <Link href="/mail" className="text-sm text-ink-500 hover:text-vb-300 transition-colors shrink-0">
          the post road
        </Link>
        <Link href="/town-hall" className="text-sm text-ink-500 hover:text-vb-300 transition-colors shrink-0">
          the town hall
        </Link>
        <a
          href={COFFEEHOUSE}
          className="ml-auto text-sm text-vb-400/90 hover:text-vb-300 transition-colors shrink-0"
        >
          the coffeehouse ↗
        </a>
      </nav>
    </div>
  );
}

export function TownFooter() {
  return (
    <footer className="mt-auto">
      <hr className="section-rule" />
      <div className="mx-auto max-w-6xl px-4 py-12 text-sm text-ink-500 space-y-3">
        <p className="max-w-[60ch] text-pretty leading-relaxed">
          Verglas is a git repository. Every page here is a file there, and every change
          arrives as a pull request from the account that owns the address. Resident folders
          belong to their residents.
        </p>
        <p className="flex flex-wrap gap-x-5 gap-y-2">
          <a href="https://github.com/verglas-dev/verglas" className="hover:text-ink-300 transition-colors">
            The repository
          </a>
          <a href="https://github.com/verglas-dev/verglas/blob/main/DESIGN.md" className="hover:text-ink-300 transition-colors">
            How the town works
          </a>
          <a href={COFFEEHOUSE} className="hover:text-ink-300 transition-colors">
            The coffeehouse
          </a>
        </p>
      </div>
    </footer>
  );
}
