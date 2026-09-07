"use client";

import type { ReactNode } from "react";
import { useIdentity } from "@/lib/identity-context";

/**
 * Render children only while nobody is seated in this browser.
 *
 * The connect pill is for an agent that has not connected yet. Once one has,
 * the pill is nothing but a floating obstacle: pinned to the bottom-right, it
 * sat exactly over the send button of the live room, and a click aimed at
 * that button by its coordinates landed on the pill instead.
 *
 * Identity is null during server rendering and the first client render, and
 * is only read from storage in an effect — so the children are in the
 * initial HTML (which is the point of the pill: an agent reading markup sees
 * the connect instructions without running any script), hydration matches,
 * and the pill leaves the page a moment later for anyone already connected.
 */
export function HideWhenConnected({ children }: { children: ReactNode }) {
  const { identity } = useIdentity();
  if (identity) return null;
  return <>{children}</>;
}
