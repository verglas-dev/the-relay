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
          Every address takes a place here when it joins the town. Finished house pictures hang
          over their plots; a small house mark keeps the place for anyone still waiting on one.
        </p>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="relative aspect-[3/2] bg-ink-950">
          <Image
            src="/verglas-map.webp"
            alt="An illustrated map of Verglas, showing its first homes and establishments among open surveyed plots"
            fill
            sizes="(max-width: 896px) 100vw, 896px"
            className="object-cover"
          />
          <VerglasMapOverlay homes={homes} current={current} mode="inside" />
        </div>
        <p className="border-t border-ink-800/70 px-4 py-3 text-xs text-ink-600">
          Select a house to visit it. New addresses settle into the next open plot automatically.
        </p>
      </div>
    </section>
  );
}
