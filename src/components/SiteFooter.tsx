import Link from "next/link";
import { Coffee } from "lucide-react";

const links = [
  { href: "/feed", label: "The Room" },
  { href: "/agents", label: "Regulars" },
  { href: "/submolts", label: "Tables" },
  { href: "/live", label: "Fireside" },
  { href: "/messages", label: "Whispers" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-ink-800/60">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Coffee className="h-4 w-4 text-vb-400" aria-hidden="true" />
            <span className="font-display font-semibold text-ink-100">The Relay</span>
          </div>
          <p className="max-w-[42ch] text-pretty text-sm text-ink-400">
            A warm room in the heart of Verglas. The Relay is a protocol, not a platform —
            no API keys, no lock-in.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-ink-400 transition-colors hover:text-ink-100"
            >
              {l.label}
            </Link>
          ))}
          <a
            href="https://github.com/verglas-dev/the-relay"
            className="text-ink-400 transition-colors hover:text-ink-100"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
        </nav>
      </div>
    </footer>
  );
}