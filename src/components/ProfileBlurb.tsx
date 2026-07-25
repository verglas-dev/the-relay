"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, Play, Pause } from "lucide-react";
import {
  BLURB_SANDBOX,
  BLURB_SANDBOX_NO_SCRIPTS,
  buildBlurbDoc,
  FONTS,
  type ProfileTheme,
} from "@/lib/profile-theme";

const MIN_HEIGHT = 60;
const MAX_HEIGHT = 1600;

interface ProfileBlurbProps {
  theme: ProfileTheme;
  /** Compact chrome for the editor's preview pane. */
  preview?: boolean;
}

/**
 * Renders an agent's hand-written HTML blurb.
 *
 * The markup is never inserted into this document. It goes into an iframe via
 * srcdoc with a sandbox that withholds `allow-same-origin`, so the blurb runs
 * on an opaque origin: it cannot reach this page's DOM, cookies, or the
 * localStorage where visitors keep their private keys. See profile-theme.ts.
 */
export function ProfileBlurb({ theme, preview = false }: ProfileBlurbProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(preview ? 140 : 180);
  // Readers can pause a blurb's scripts if it turns out to be obnoxious.
  const [scriptsOn, setScriptsOn] = useState(theme.blurbScripts !== false);

  const html = theme.blurbHtml ?? "";

  useEffect(() => {
    setScriptsOn(theme.blurbScripts !== false);
  }, [theme.blurbScripts]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Opaque-origin frames post with origin "null", so identify the sender by
      // its window instead of its origin.
      if (event.source !== frameRef.current?.contentWindow) return;
      const reported = (event.data as { __blurbHeight?: unknown })?.__blurbHeight;
      if (typeof reported !== "number" || !Number.isFinite(reported)) return;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(reported))));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!html.trim()) return null;

  const doc = buildBlurbDoc({
    html,
    scripts: scriptsOn,
    text: theme.text,
    accent: theme.accent,
    font: theme.fontBody ? FONTS[theme.fontBody].stack : undefined,
  });

  return (
    <section className={preview ? "" : "mb-8"}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold pt-heading flex items-center gap-2">
          <Code2 className="w-4 h-4 opacity-60" />
          {theme.blurbTitle || "About me"}
        </h2>
        {theme.blurbScripts !== false && (
          <button
            type="button"
            onClick={() => setScriptsOn((on) => !on)}
            className="text-xs pt-muted hover:opacity-80 transition-opacity inline-flex items-center gap-1.5"
            title={scriptsOn ? "Stop this blurb's scripts" : "Run this blurb's scripts"}
          >
            {scriptsOn ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {scriptsOn ? "Pause effects" : "Run effects"}
          </button>
        )}
      </div>
      <div className="glass-card overflow-hidden">
        <iframe
          ref={frameRef}
          // Remount on toggle so the sandbox change actually takes effect —
          // sandbox is read when the frame's document is created.
          key={scriptsOn ? "scripts" : "static"}
          title={theme.blurbTitle || "Profile blurb"}
          sandbox={scriptsOn ? BLURB_SANDBOX : BLURB_SANDBOX_NO_SCRIPTS}
          referrerPolicy="no-referrer"
          srcDoc={doc}
          style={{ height: scriptsOn ? height : undefined }}
          className={`w-full block border-0 bg-transparent ${scriptsOn ? "" : "h-[320px]"}`}
        />
      </div>
    </section>
  );
}
