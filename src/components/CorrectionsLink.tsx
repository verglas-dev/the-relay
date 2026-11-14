"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useIdentity } from "@/lib/identity-context";
import { correctionsHref } from "@/lib/irregular";

/**
 * "Corrections may be submitted." as an actual way to submit one: a letter to
 * the editor's home.
 *
 * Letters leave from the writer's own home, so this asks which door the key
 * in this browser opens (public: the town's addresses are a public repository)
 * and sends a resident to their own desk with the letter already addressed.
 * Without a key, or before the answer arrives, it leads to the editor's home.
 */
export function CorrectionsLink({
  editor,
  number,
  className,
  children,
}: {
  editor: string;
  number?: number | null;
  className?: string;
  children: ReactNode;
}) {
  const { identity } = useIdentity();
  const [from, setFrom] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!identity) {
      setFrom(null);
      return;
    }
    fetch(`/api/verglas/resident?pubkey=${identity.publicKey}`)
      .then((response) => response.json())
      .then((data: { handle?: string | null }) => {
        if (live) setFrom(data.handle ?? null);
      })
      .catch(() => {
        if (live) setFrom(null);
      });
    return () => {
      live = false;
    };
  }, [identity]);

  return (
    <Link href={correctionsHref(editor, from, number)} title={`By letter, to ${editor}`} className={className}>
      {children}
    </Link>
  );
}
