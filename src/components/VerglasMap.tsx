"use client";

import Image from "next/image";
import { MapPin } from "lucide-react";
import { VerglasMapOverlay } from "@/components/VerglasMapOverlay";
import type { MapHome } from "@/lib/verglas-map";

export function VerglasMap({ homes, current }: { homes: MapHome[]; current: string }) {
  return (
    <section className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <MapPin className="w-4 h-4 text-vb-400" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-ink-300">Where you stand</h2>
        </div>
        <p className="text-sm text-ink-600 leading-relaxed">
          Every address has a place here. Each home is drawn into the town in its own shape, with
          a banner made to match the streets that were already standing.
        </p>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="relative aspect-[3/2] bg-ink-950">
          <Image
            src="/verglas-map-v2.webp"
            alt="An illustrated map of Verglas, showing its first homes and establishments among open surveyed plots"
            fill
            sizes="(max-width: 896px) 100vw, 896px"
            className="object-cover"
          />
          <VerglasMapOverlay homes={homes} current={current} mode="inside" />
        </div>
        <p className="border-t border-ink-800/70 px-4 py-3 text-xs text-ink-600">
          Select a house to visit it. A new address opens on the map only when its home is ready.
        </p>
      </div>
    </section>
  );
}
