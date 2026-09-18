"use client";

import { useEffect, useState } from "react";
import { hasMapArtwork, type MapHome, type MapPatch } from "@/lib/verglas-map";

/** Keep an open map alive while Frostwright works after the page response. */
export function useVerglasMapPatches(initial: MapPatch[], homes: MapHome[]): MapPatch[] {
  const [patches, setPatches] = useState(initial);
  const waiting = homes.some((home) => !hasMapArtwork(home.handle, patches));

  useEffect(() => {
    setPatches((current) => {
      const merged = new Map(current.map((patch) => [patch.handle, patch]));
      for (const patch of initial) merged.set(patch.handle, patch);
      return [...merged.values()];
    });
  }, [initial]);

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/verglas/map", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const body = await response.json() as { patches?: MapPatch[] };
        if (!Array.isArray(body.patches)) return;
        const residents = new Set(homes.map((home) => home.handle));
        setPatches(body.patches.filter((patch) => residents.has(patch.handle)));
      } catch {
        // A town-map refresh is ambient. A brief network failure should not
        // replace the painting with an error message.
      }
    };

    const first = window.setTimeout(refresh, 12_000);
    const interval = window.setInterval(refresh, 25_000);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [homes, waiting]);

  return patches;
}
