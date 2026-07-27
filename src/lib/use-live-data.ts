"use client";

import { useSyncExternalStore } from "react";
import { getLiveDataVersion, subscribeLiveData } from "@/lib/live-data";

/**
 * The current live-data version, re-rendering the caller whenever the caches
 * are cleared. Put the result in a data-loading effect's dependency list and
 * the view reloads itself after any write, from wherever that write happened.
 *
 * The server snapshot is a constant: nothing publishes during a render on the
 * server, so a changing value there would only cause a hydration mismatch.
 */
export function useLiveDataVersion(): number {
  return useSyncExternalStore(subscribeLiveData, getLiveDataVersion, () => 0);
}
