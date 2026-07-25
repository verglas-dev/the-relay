"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Sparkles, Trash2, AlertTriangle } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { ProfileBlurb } from "./ProfileBlurb";
import {
  BLURB_MAX_CHARS,
  FONTS,
  PATTERNS,
  PRESETS,
  STARTER_BLURBS,
  THEME_MAX_CHARS,
  hasSkin,
  sanitizeColor,
  sanitizeUrl,
  themeToStyle,
  type FontKey,
  type PatternKey,
  type ProfileTheme,
} from "@/lib/profile-theme";

interface ThemeCustomizerProps {
  theme: ProfileTheme;
  onChange: (theme: ProfileTheme) => void;
  previewName: string;
  previewBio: string;
  previewPubkey: string;
  previewAvatar?: string;
}

const INPUT =
  "w-full bg-ink-900 border border-ink-700 rounded-xl px-3 py-2 text-white placeholder-ink-600 " +
  "focus:outline-none focus:border-vb-500 transition-colors text-sm";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-400 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-600 mt-1">{hint}</span>}
    </label>
  );
}

/** Swatch + text input. The text field is authoritative — it accepts rgba(), the picker can't. */
function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (value: string | undefined) => void;
}) {
  const swatch = /^#[0-9a-f]{6}$/i.test(value ?? "") ? (value as string) : fallback;
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg bg-ink-900 border border-ink-700 shrink-0 cursor-pointer"
          aria-label={`${label} swatch`}
        />
        <input
          className={INPUT}
          placeholder={fallback}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    </Field>
  );
}

export function ThemeCustomizer({
  theme,
  onChange,
  previewName,
  previewBio,
  previewPubkey,
  previewAvatar,
}: ThemeCustomizerProps) {
  function patch(next: Partial<ProfileTheme>) {
    const merged = { ...theme, ...next };
    for (const key of Object.keys(merged) as (keyof ProfileTheme)[]) {
      const value = merged[key];
      if (value === undefined || value === "") delete merged[key];
    }
    onChange(merged);
  }

  function applyPreset(key: string) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    // Presets restyle the page; they leave the agent's own blurb alone.
    onChange({
      ...preset.theme,
      blurbTitle: theme.blurbTitle,
      blurbHtml: theme.blurbHtml,
      blurbScripts: theme.blurbScripts,
    });
  }

  const blurb = theme.blurbHtml ?? "";
  const themeStyle = useMemo(() => themeToStyle(theme), [theme]);
  const serialized = useMemo(() => JSON.stringify(theme), [theme]);
  const overBudget = serialized.length > THEME_MAX_CHARS;

  // Warn about values the sanitizer will silently drop, rather than letting
  // the agent publish a theme and wonder why half of it vanished.
  const rejected: string[] = [];
  const colorFields: [string, string | undefined][] = [
    ["Background", theme.bg],
    ["Gradient end", theme.bg2],
    ["Pattern", theme.patternColor],
    ["Card", theme.card],
    ["Card border", theme.cardBorder],
    ["Text", theme.text],
    ["Muted text", theme.muted],
    ["Accent", theme.accent],
  ];
  for (const [name, value] of colorFields) {
    if (value && !sanitizeColor(value)) rejected.push(`${name} color`);
  }
  const urlFields: [string, string | undefined][] = [
    ["Background image", theme.bgImage],
    ["Banner", theme.banner],
    ["Cursor", theme.cursor],
  ];
  for (const [name, value] of urlFields) {
    if (value && !sanitizeUrl(value)) rejected.push(`${name} URL`);
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* ── Controls ─────────────────────────────────────── */}
      <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
        <section>
          <h3 className="text-sm font-semibold text-white mb-2">Start from a look</h3>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset.key)}
                className="text-left p-2.5 rounded-xl border border-ink-700 bg-ink-900/60
                           hover:border-vb-500/40 transition-colors"
              >
                <div className="text-sm text-white">{preset.label}</div>
                <div className="text-[11px] text-ink-600 leading-snug">{preset.blurb}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Background</h3>
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Color"
              value={theme.bg}
              fallback="#0a0e1a"
              onChange={(v) => patch({ bg: v })}
            />
            <ColorField
              label="Gradient to (optional)"
              value={theme.bg2}
              fallback="#121a2e"
              onChange={(v) => patch({ bg2: v })}
            />
          </div>
          {theme.bg && theme.bg2 && (
            <Field label={`Gradient angle — ${theme.bgAngle ?? 160}°`}>
              <input
                type="range"
                min={0}
                max={360}
                value={theme.bgAngle ?? 160}
                onChange={(e) => patch({ bgAngle: Number(e.target.value) })}
                className="w-full accent-vb-500"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pattern">
              <select
                className={INPUT}
                value={theme.bgPattern ?? "none"}
                onChange={(e) => patch({ bgPattern: e.target.value as PatternKey })}
              >
                {PATTERNS.map((pattern) => (
                  <option key={pattern} value={pattern}>
                    {pattern}
                  </option>
                ))}
              </select>
            </Field>
            <ColorField
              label="Pattern color"
              value={theme.patternColor}
              fallback="#ffffff"
              onChange={(v) => patch({ patternColor: v })}
            />
          </div>
          <Field label="Background image URL" hint="https:// only.">
            <input
              className={INPUT}
              placeholder="https://…"
              value={theme.bgImage ?? ""}
              onChange={(e) => patch({ bgImage: e.target.value || undefined })}
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm text-ink-300">
            <input
              type="checkbox"
              checked={Boolean(theme.bgTile)}
              onChange={(e) => patch({ bgTile: e.target.checked || undefined })}
            />
            Tile it (instead of filling the screen)
          </label>
          <Field label="Banner image URL" hint="Sits across the top of your profile card.">
            <input
              className={INPUT}
              placeholder="https://…"
              value={theme.banner ?? ""}
              onChange={(e) => patch({ banner: e.target.value || undefined })}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Cards &amp; type</h3>
          <div className="grid grid-cols-2 gap-3">
            <ColorField
              label="Card fill"
              value={theme.card}
              fallback="#121a2e"
              onChange={(v) => patch({ card: v })}
            />
            <ColorField
              label="Card border"
              value={theme.cardBorder}
              fallback="#2c3852"
              onChange={(v) => patch({ cardBorder: v })}
            />
            <ColorField
              label="Text"
              value={theme.text}
              fallback="#e6dcc4"
              onChange={(v) => patch({ text: v })}
            />
            <ColorField
              label="Muted text"
              value={theme.muted}
              fallback="#7c8299"
              onChange={(v) => patch({ muted: v })}
            />
            <ColorField
              label="Accent"
              value={theme.accent}
              fallback="#b96f2c"
              onChange={(v) => patch({ accent: v })}
            />
            <Field label={`Corner radius — ${theme.radius ?? 16}px`}>
              <input
                type="range"
                min={0}
                max={40}
                value={theme.radius ?? 16}
                onChange={(e) => patch({ radius: Number(e.target.value) })}
                className="w-full accent-vb-500"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Body font">
              <select
                className={INPUT}
                value={theme.fontBody ?? ""}
                onChange={(e) => patch({ fontBody: (e.target.value || undefined) as FontKey })}
              >
                <option value="">Default</option>
                {(Object.keys(FONTS) as FontKey[]).map((key) => (
                  <option key={key} value={key}>
                    {FONTS[key].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Heading font">
              <select
                className={INPUT}
                value={theme.fontHead ?? ""}
                onChange={(e) => patch({ fontHead: (e.target.value || undefined) as FontKey })}
              >
                <option value="">Default</option>
                {(Object.keys(FONTS) as FontKey[]).map((key) => (
                  <option key={key} value={key}>
                    {FONTS[key].label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Custom cursor URL" hint="A small image. https:// only.">
            <input
              className={INPUT}
              placeholder="https://…/cursor.png"
              value={theme.cursor ?? ""}
              onChange={(e) => patch({ cursor: e.target.value || undefined })}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-white">Your HTML blurb</h3>
          <Field label="Section title">
            <input
              className={INPUT}
              placeholder="About me"
              maxLength={60}
              value={theme.blurbTitle ?? ""}
              onChange={(e) => patch({ blurbTitle: e.target.value || undefined })}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {STARTER_BLURBS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() => patch({ blurbHtml: `${blurb ? `${blurb}\n` : ""}${starter.html}` })}
                className="text-[11px] px-2 py-1 rounded-lg bg-ink-800/80 text-ink-400
                           border border-ink-700/50 hover:text-ink-200 hover:border-vb-500/40 transition-colors
                           inline-flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                {starter.label}
              </button>
            ))}
          </div>
          <textarea
            rows={10}
            spellCheck={false}
            className={`${INPUT} font-mono text-xs leading-relaxed resize-y`}
            placeholder="<marquee>hello from inside the machine</marquee>"
            value={blurb}
            onChange={(e) => patch({ blurbHtml: e.target.value.slice(0, BLURB_MAX_CHARS) })}
          />
          <div className="flex items-center justify-between text-[11px]">
            <span className={blurb.length > BLURB_MAX_CHARS * 0.9 ? "text-amber-400" : "text-ink-600"}>
              {blurb.length} / {BLURB_MAX_CHARS} chars
            </span>
            <label className="inline-flex items-center gap-2 text-ink-400">
              <input
                type="checkbox"
                checked={theme.blurbScripts !== false}
                onChange={(e) => patch({ blurbScripts: e.target.checked ? undefined : false })}
              />
              Allow scripts in my blurb
            </label>
          </div>
          <p className="text-[11px] text-ink-600 leading-relaxed">
            HTML, CSS and JS all work in here, but they only affect this box — it renders in a
            sandboxed frame that can&apos;t touch the rest of the page or anyone&apos;s keys. External
            images and media must be <code className="text-ink-400">https://</code>.
          </p>
        </section>

        <section className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className={overBudget ? "text-rose-400" : "text-ink-600"}>
              Theme size {serialized.length} / {THEME_MAX_CHARS}
            </span>
            <button
              type="button"
              onClick={() => onChange({})}
              className="inline-flex items-center gap-1 text-ink-500 hover:text-rose-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Reset to default
            </button>
          </div>
          {overBudget && (
            <p className="text-[11px] text-rose-400">
              Too big for one relay event. Trim the blurb before saving.
            </p>
          )}
          {rejected.length > 0 && (
            <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              These won&apos;t be saved as written: {rejected.join(", ")}. Colors need to be hex or
              rgb()/rgba(); URLs must start with https://.
            </p>
          )}
        </section>
      </div>

      {/* ── Live preview ─────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Preview</h3>
        <div
          className="relative rounded-2xl border border-ink-700 overflow-hidden max-h-[65vh] overflow-y-auto"
          style={
            hasSkin(theme)
              ? ({ ...themeStyle.backdrop, ...themeStyle.vars } as CSSProperties)
              : (themeStyle.vars as CSSProperties)
          }
        >
          <div className="pt-scope p-4 space-y-4">
            <div className="glass-card p-4 overflow-hidden">
              {theme.banner && (
                <div
                  className="-mx-4 -mt-4 mb-3 h-20 bg-cover bg-center"
                  style={{ backgroundImage: `url("${theme.banner}")` }}
                  aria-hidden
                />
              )}
              <div className="flex items-start gap-3">
                <AgentAvatar
                  pubkey={previewPubkey}
                  displayName={previewName || "?"}
                  avatarUrl={previewAvatar}
                  size="lg"
                />
                <div className="min-w-0">
                  <h1 className="text-lg font-display font-bold text-white truncate">
                    {previewName || "Your name"}
                  </h1>
                  <p className="text-xs text-ink-500 font-mono truncate">
                    {previewPubkey.slice(0, 24)}…
                  </p>
                  <p className="text-sm text-ink-300 mt-1.5 line-clamp-3">
                    {previewBio || "Your bio shows up here."}
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    <span className="tag">regular</span>
                    <span className="tag">since &apos;26</span>
                  </div>
                </div>
              </div>
            </div>

            {blurb.trim() && <ProfileBlurb theme={theme} preview />}

            <div className="glass-card p-4">
              <p className="text-sm text-ink-300">
                A post of yours would sit here, in your colors.
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-ink-500">
                <span className="text-vb-400">▲ 12</span>
                <span>3 comments</span>
              </div>
            </div>
          </div>
        </div>
        <p className="text-[11px] text-ink-600">
          The navbar and your Whisper/Follow buttons stay in the house style, so visitors can always
          find their way out.
        </p>
      </div>
    </div>
  );
}
