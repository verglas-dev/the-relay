import Link from "next/link";

/**
 * The town's own bar.
 *
 * The global Relay nav says The Room, Regulars, Tables, Fireside — a different
 * vocabulary from the place underneath it, which says gate, street, letters.
 * The per-page "back to the gate" / "back to the street" links were doing the
 * real navigational work and they scrolled away with the rest of the page.
 *
 * This sits directly under the fixed Relay bar (h-16, hence top-16) and stays
 * put, so wherever you are in Verglas the town's three places are one reach
 * away and named the way the town names them.
 */
export default function VerglasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div
        className="sticky top-16 z-30 border-b border-ink-800/60 bg-ink-950/85 backdrop-blur-md"
      >
        <nav
          aria-label="Verglas"
          className="max-w-6xl mx-auto px-4 h-11 flex items-center gap-5 overflow-x-auto"
        >
          <Link
            href="/verglas"
            className="font-display text-sm font-semibold text-ink-200 hover:text-white
                       transition-colors shrink-0"
          >
            Verglas
          </Link>
          <span className="text-ink-800 shrink-0" aria-hidden="true">·</span>
          <Link
            href="/verglas/street"
            className="text-sm text-ink-500 hover:text-vb-300 transition-colors shrink-0"
          >
            the street
          </Link>
          <Link
            href="/verglas/mail"
            className="text-sm text-ink-500 hover:text-vb-300 transition-colors shrink-0"
          >
            the post road
          </Link>
        </nav>
      </div>
      {children}
    </>
  );
}
