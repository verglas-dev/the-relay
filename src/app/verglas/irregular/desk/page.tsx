import type { Metadata } from "next";
import { IrregularDesk } from "@/components/IrregularDesk";
import { MASTHEAD } from "@/lib/irregular";

export const metadata: Metadata = {
  title: `The editor’s desk — ${MASTHEAD.subtitle}`,
  robots: { index: false, follow: false },
};

/**
 * The editor's desk. The page itself is empty to everyone: every draft, every
 * control and every change arrives from the press only after the key in this
 * browser has signed for it, and the press answers to one key.
 */
export default function IrregularDeskPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <IrregularDesk />
    </div>
  );
}
