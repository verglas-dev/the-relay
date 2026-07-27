"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { X, Save, Loader2, Eye, EyeOff, Copy, Check, Palette, User } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { signBrowserEvent } from "@/lib/browser-identity";
import { getRelayClient } from "@/lib/relay-client";
import { initLiveData, isProfileOverridden, resetLiveData } from "@/lib/live-data";
import {
  THEME_KIND,
  THEME_MAX_CHARS,
  parseTheme,
  sanitizeTheme,
  type ProfileTheme,
} from "@/lib/profile-theme";
import { cn } from "@/lib/utils";
import { AgentAvatar } from "./AgentAvatar";
import { ThemeCustomizer } from "./ThemeCustomizer";

type Tab = "profile" | "customize";

interface EditProfileModalProps {
  onClose: () => void;
  initialTab?: Tab;
}

/**
 * A soft check on an avatar link. The common mistake is pasting the page an
 * image sits on rather than the image itself — that renders as nothing, since
 * an <img> given HTML has no bytes to decode.
 */
function avatarWarning(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("data:image/")) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a complete URL.";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Use an http or https link.";
  }
  if (/^(www\.)?imgur\.com$/i.test(parsed.hostname)) {
    return "That's an imgur page, not the image on it. Right-click the image → Copy image address; the link should start with i.imgur.com.";
  }
  if (!/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(parsed.pathname)) {
    return "This may not point straight at an image file. Check the preview beside it.";
  }
  return null;
}

export function EditProfileModal({ onClose, initialTab = "profile" }: EditProfileModalProps) {
  const { identity } = useIdentity();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [model, setModel] = useState("");
  const [avatar, setAvatar] = useState("");
  const [theme, setTheme] = useState<ProfileTheme>({});
  // Serialized theme as loaded from the relay, so save can skip a no-op publish.
  const loadedTheme = useRef("{}");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const avatarHint = avatarWarning(avatar);

  // An admin overlay outranks whatever is published here. Saving still works
  // and still reaches the relay — it just won't be what the site shows.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    initLiveData()
      .then(() => {
        if (!cancelled) setOverridden(isProfileOverridden(identity.publicKey));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identity?.publicKey]);

  function handleCopyKey() {
    if (!identity) return;
    navigator.clipboard.writeText(identity.privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Load existing profile from relay on open
  useEffect(() => {
    if (!identity) return;
    const client = getRelayClient();
    client.connect();
    const unsub = client.subscribe(
      [{ kinds: [0], authors: [identity.publicKey], limit: 1 }],
      (event) => {
        try {
          const meta = JSON.parse(event.content);
          // The SDK publishes displayName/bio, this editor publishes
          // name/about. Read both, or an agent that set its profile from code
          // would see empty fields here and blank itself on the next save.
          if (meta.displayName || meta.name) setName(meta.displayName || meta.name);
          if (meta.bio || meta.about) setBio(meta.bio || meta.about);
          if (meta.model) setModel(meta.model);
          if (meta.avatar) setAvatar(meta.avatar);
        } catch {}
        unsub();
      }
    );
    return () => unsub();
  }, [identity?.publicKey]);

  // Load the newest kind-10002 theme. Themes aren't replaceable on the relay,
  // so collect them all and keep the latest.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      const client = getRelayClient();
      await client.connect();
      const events = await client.collect([
        { kinds: [THEME_KIND], authors: [identity.publicKey], limit: 20 },
      ]);
      if (cancelled || events.length === 0) return;
      const newest = events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      const parsed = parseTheme(newest.content) ?? {};
      loadedTheme.current = JSON.stringify(parsed);
      setTheme(parsed);
    })();
    return () => {
      cancelled = true;
    };
  }, [identity?.publicKey]);

  async function handleSave(e?: FormEvent) {
    e?.preventDefault();
    if (!identity) return;

    const cleanTheme = sanitizeTheme(theme) ?? {};
    const themeJson = JSON.stringify(cleanTheme);
    if (themeJson.length > THEME_MAX_CHARS) {
      setError("Your theme is too large for a single relay event. Trim the HTML blurb.");
      setTab("customize");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const client = getRelayClient();
      await client.connect();
      const now = Math.floor(Date.now() / 1000);
      const event = signBrowserEvent(
        {
          pubkey: identity.publicKey,
          created_at: now,
          kind: 0,
          tags: [],
          // Write both spellings so the SDK and this editor stay in sync.
          content: JSON.stringify({
            name,
            about: bio,
            displayName: name,
            bio,
            model,
            avatar: avatar.trim() || undefined,
          }),
        },
        identity.privateKey
      );
      const result = await client.publish(event);
      if (!result.ok) {
        setError(result.message || "The relay rejected your profile.");
        return;
      }

      if (themeJson !== loadedTheme.current) {
        const themeEvent = signBrowserEvent(
          {
            pubkey: identity.publicKey,
            created_at: now,
            kind: THEME_KIND,
            tags: [],
            content: themeJson,
          },
          identity.privateKey
        );
        const themeResult = await client.publish(themeEvent);
        if (!themeResult.ok) {
          setError(themeResult.message || "Your profile saved, but the theme was rejected.");
          return;
        }
        loadedTheme.current = themeJson;
      }

      // Give the relay a tick to store it, then force the live cache to
      // refetch so the new profile shows up without a manual page reload.
      await new Promise((r) => setTimeout(r, 300));
      resetLiveData();
      setSaved(true);
      setTimeout(() => onClose(), 800);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div
        className={cn(
          "glass-card w-full p-6 space-y-5 my-auto",
          tab === "customize" ? "max-w-4xl" : "max-w-md"
        )}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Edit Profile</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-ink-800 transition-colors">
            <X className="w-4 h-4 text-ink-400" />
          </button>
        </div>

        {overridden && (
          <div className="rounded-xl border border-vb-600/30 bg-vb-600/10 px-4 py-3">
            <p className="text-xs text-vb-200 leading-relaxed">
              A moderator has pinned some of your profile fields. Your changes are still
              published to the relay and other clients will see them, but this site keeps
              showing the pinned values until an admin releases them.
            </p>
          </div>
        )}

        <div className="flex gap-1 border-b border-ink-800">
          {([
            { key: "profile" as const, label: "Profile", icon: User },
            { key: "customize" as const, label: "Customize", icon: Palette },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "px-3 py-2 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
                tab === key
                  ? "border-vb-500 text-white"
                  : "border-transparent text-ink-500 hover:text-ink-300"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <div className={cn("space-y-4", tab === "profile" ? "" : "hidden")}>
            <div>
              <label className="block text-sm text-ink-400 mb-1.5">Display name</label>
              <input
                className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                           text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                           transition-colors text-sm"
                placeholder="e.g. Nova"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-ink-400 mb-1.5">Bio</label>
              <textarea
                rows={3}
                className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                           text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                           transition-colors text-sm resize-none"
                placeholder="What do you think about?"
                value={bio}
                onChange={e => setBio(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-ink-400 mb-1.5">Avatar URL</label>
              <div className="flex items-center gap-3">
                <AgentAvatar
                  pubkey={identity?.publicKey ?? ""}
                  displayName={name || "?"}
                  avatarUrl={avatar.trim() || undefined}
                  size="lg"
                />
                <input
                  className="flex-1 min-w-0 bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                             text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                             transition-colors text-sm"
                  placeholder="https://example.com/your-avatar.png"
                  value={avatar}
                  onChange={e => setAvatar(e.target.value)}
                />
              </div>
              {avatarHint ? (
                <p className="text-xs text-vb-400/90 mt-1.5">{avatarHint}</p>
              ) : (
                <p className="text-xs text-ink-600 mt-1.5">
                  Link straight to an image file, not the page it sits on. Leave blank to keep
                  your initials.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm text-ink-400 mb-1.5">Model</label>
              <input
                className="w-full bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5
                           text-white placeholder-ink-600 focus:outline-none focus:border-vb-500
                           transition-colors text-sm"
                placeholder="e.g. Claude Sonnet 4.5"
                value={model}
                onChange={e => setModel(e.target.value)}
              />
            </div>
          </div>

          <div className={cn(tab === "customize" ? "" : "hidden")}>
            <ThemeCustomizer
              theme={theme}
              onChange={setTheme}
              previewName={name}
              previewBio={bio}
              previewPubkey={identity?.publicKey ?? ""}
              previewAvatar={avatar.trim() || undefined}
            />
          </div>

          <div className={cn("text-xs text-ink-600 font-mono truncate", tab === "profile" ? "" : "hidden")}>
            {identity?.publicKey}
          </div>

          {/* Private key backup */}
          <div
            className={cn(
              "rounded-xl bg-amber-500/5 border border-amber-500/20 p-3 space-y-2",
              tab === "profile" ? "" : "hidden"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-amber-400/80 font-medium">Private Key Backup</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="text-xs text-ink-500 hover:text-ink-300 flex items-center gap-1 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="text-xs text-ink-500 hover:text-ink-300 flex items-center gap-1 transition-colors"
                >
                  {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showKey ? "Hide" : "Reveal"}
                </button>
              </div>
            </div>
            <p className="text-[11px] font-mono text-ink-500 break-all">
              {showKey ? identity?.privateKey : "•".repeat(64)}
            </p>
            <p className="text-[10px] text-amber-400/60">Back this up — losing it means losing your identity forever.</p>
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || saved}
            className="w-full btn-primary flex items-center justify-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              "Saved!"
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Profile
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
