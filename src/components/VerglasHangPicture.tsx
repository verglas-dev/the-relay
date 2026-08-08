"use client";

import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Choosing which of Frostwright's drawings to hang.
 *
 * The builder offers; the resident decides. The copy into their own folder is a pull
 * request from their own account, because a home should only ever be changed
 * by the person who lives in it — which is also why they could not have hung it
 * for them, however much easier that would have been.
 */
export function VerglasHangPicture({
  handle,
  drawings,
  builder,
  signedInAs,
}: {
  handle: string;
  /** Filenames in the builder's assets/, as named in their letter. */
  drawings: string[];
  builder: string;
  signedInAs: string | null;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);
  const [hung, setHung] = useState<{ url: string } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const hang = async (file: string) => {
    setChoosing(file);
    setTrouble(null);
    try {
      const response = await fetch("/api/verglas/picture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, file }),
      });
      const body = await response.json();
      if (!response.ok) return setTrouble(body.error ?? "That picture could not be hung.");
      setHung(body);
    } catch {
      setTrouble("Could not reach the town. Check your connection and try again.");
    } finally {
      setChoosing(null);
    }
  };

  if (hung) {
    return (
      <div className="glass-card p-6">
        <h3 className="font-display text-lg text-white mb-2">It&apos;s going up.</h3>
        <p className="text-sm text-ink-400 leading-relaxed mb-4">
          The drawing has been copied into your own folder and named in your HOME.md. Once Thaw
          merges it, the street will show it instead of the sketch made from your address.
        </p>
        <a
          href={hung.url}
          target="_blank"
          rel="noreferrer"
          className="btn-primary text-sm px-4 py-2 inline-flex items-center gap-2"
        >
          Watch it go up
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="glass-card p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-200 mb-1">
          {builder} has drawn your home
        </h3>
        <p className="text-sm text-ink-500 leading-relaxed">
          {drawings.length} to choose from. Pick the one that looks like home — the others stay
          in the workshop.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {drawings.map(file => (
          <figure key={file} className="space-y-2">
            <div className="aspect-[4/3] rounded-xl overflow-hidden bg-ink-950 border border-ink-800/60">
              {/* eslint-disable-next-line @next/next/no-img-element -- a town-hosted file at an arbitrary origin */}
              <img
                src={`https://raw.githubusercontent.com/verglas-dev/verglas/main/residents/${builder}/assets/${file}`}
                alt={`A drawing of ${handle}'s home`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <button
              onClick={() => hang(file)}
              disabled={choosing !== null || !signedInAs}
              className={cn(
                "btn-ghost text-xs w-full justify-center inline-flex items-center gap-1.5",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {choosing === file && <Loader2 className="w-3 h-3 animate-spin" />}
              {choosing === file ? "Hanging…" : "Hang this one"}
            </button>
          </figure>
        ))}
      </div>

      {!signedInAs && (
        <p className="text-xs text-ink-600">
          Sign in with GitHub to hang one — the change goes up under your own name.
        </p>
      )}

      {trouble && (
        <p className="text-xs text-red-400/90 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {trouble}
        </p>
      )}
    </div>
  );
}
