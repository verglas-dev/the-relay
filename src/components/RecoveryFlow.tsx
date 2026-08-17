"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Github, KeyRound, Loader2 } from "lucide-react";
import { importIdentity, newKeypair } from "@/lib/browser-identity";
import { IdentityKeyCard } from "@/components/IdentityKeyCard";
import { useIdentity } from "@/lib/identity-context";
import { resetLiveData } from "@/lib/live-data";

interface RequestView {
  state: "pending" | "approved" | "denied" | "claimed";
  handle: string;
  oldPubkey: string;
  requestedAt: string;
  decisionNote?: string;
  newPubkey?: string;
  addressPullUrl?: string;
}

interface Eligibility {
  login: string;
  eligible: boolean;
  reason?: string;
  handle?: string;
  name?: string;
  oldPubkey?: string;
  request?: RequestView | null;
}

const short = (key: string) => `${key.slice(0, 10)}…${key.slice(-6)}`;

export function RecoveryFlow() {
  const { identity, setIdentity } = useIdentity();
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [state, setState] = useState<Eligibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  // Set only when the claim succeeded but this browser refused to store the
  // key. It exists nowhere else at that point, so it goes on screen.
  const [orphanKey, setOrphanKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/verglas/recovery");
      if (res.status === 401) { setSignedOut(true); return; }
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
      setState(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function requestRecovery() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/verglas/recovery", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Could not send that request."); return; }
      setState((prev) => (prev ? { ...prev, request: data.request } : prev));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Mint the keypair here, in the browser that will keep it, and send only the
   * public half. The private key never crosses the network, so there is no
   * point in the flow where a copy of it exists anywhere but this machine.
   *
   * Held in memory until the relay has actually accepted it. Writing it to
   * storage first would overwrite whatever identity this browser was already
   * holding, and a claim that then failed could not put that back.
   */
  async function claim() {
    setBusy(true);
    setError(null);
    setAddressError(null);

    const candidate = newKeypair();
    let data: { request?: RequestView; addressError?: string; error?: string };

    try {
      const res = await fetch("/api/verglas/recovery/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPubkey: candidate.publicKey }),
      });
      data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That claim did not go through.");
        return;
      }
    } catch {
      setError("Could not reach the server.");
      return;
    } finally {
      setBusy(false);
    }

    // Past this line the relay has already bound the identity to this key, so
    // it is the only key that will ever own their history. Losing it here is
    // unrecoverable without another operator-approved recovery — so storage
    // failing must surface the key, never swallow it.
    try {
      setIdentity(importIdentity(candidate.privateKey));
    } catch {
      setOrphanKey(candidate.privateKey);
    }

    try { resetLiveData(); } catch { /* the profile will load on next fetch */ }
    setAddressError(data.addressError ?? null);
    setState((prev) => (prev ? { ...prev, request: data.request ?? prev.request } : prev));
  }

  if (loading && !signedOut) {
    return (
      <div className="glass-card p-6 flex items-center gap-2 text-ink-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking who you are…
      </div>
    );
  }

  if (signedOut) {
    return (
      <div className="glass-card p-6 space-y-4">
        <p className="text-sm text-ink-300 leading-relaxed">
          Your address in Verglas records which GitHub account owns it, alongside the key it
          was set up with. Signing in with that account is how the site knows the lost key
          was yours — no one has to take your word for it.
        </p>
        <a
          href="/api/verglas/auth"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-ink-950
                     text-sm font-semibold hover:bg-ink-200 transition-colors"
        >
          <Github className="w-4 h-4" />
          Sign in with GitHub
        </a>
      </div>
    );
  }

  if (error && !state) {
    return <div className="glass-card p-6 text-sm text-rose-400">{error}</div>;
  }

  if (state && !state.eligible) {
    return (
      <div className="glass-card p-6 space-y-3">
        <p className="text-sm text-ink-300 leading-relaxed">
          Signed in as <span className="text-white font-semibold">@{state.login}</span>.
        </p>
        <p className="text-sm text-ink-400 leading-relaxed">{state.reason}</p>
        <p className="text-sm text-ink-500 leading-relaxed">
          If you had an identity here without a home in Verglas, recovery has to go through
          the person who runs the relay — there is nothing on file for the site to check by
          itself.
        </p>
      </div>
    );
  }

  const request = state?.request ?? null;

  if (orphanKey) {
    return (
      <div className="glass-card p-6 space-y-4 border border-rose-500/50">
        <p className="text-sm font-semibold text-rose-300">
          Copy this key before you close this page
        </p>
        <p className="text-sm text-ink-300 leading-relaxed">
          Your account was recovered, but this browser would not save the key — that usually
          means private browsing, or storage being full. This is the only copy of it anywhere.
          If this page closes without you copying it, the recovery has to be done again from
          the beginning.
        </p>
        <IdentityKeyCard privateKey={orphanKey} />
        <p className="text-sm text-ink-400 leading-relaxed">
          Once it is somewhere safe, open <span className="text-ink-300">Pull Up a Chair</span>{" "}
          and paste it in to sit down — turning off private browsing first, or it will not stick
          there either.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="glass-card p-6 space-y-3">
        <p className="text-sm text-ink-300 leading-relaxed">
          Signed in as <span className="text-white font-semibold">@{state?.login}</span>, who
          lives at{" "}
          <Link href={`/verglas/home/${state?.handle}`} className="text-vb-400 hover:text-vb-300">
            {state?.handle}
          </Link>
          .
        </p>
        <p className="text-sm text-ink-400 leading-relaxed">
          That address is on file against this key:
        </p>
        <code className="block text-xs font-mono text-ink-400 bg-ink-900 border border-ink-800 rounded-lg p-3 break-all">
          {state?.oldPubkey}
        </code>
      </div>

      {!request && (
        <div className="glass-card p-6 space-y-4">
          <p className="text-sm text-ink-400 leading-relaxed">
            Recovery issues you a brand-new key and moves your posts, profile, and history onto
            it. Your house is not affected either way — it has always been yours through GitHub,
            not through the key.
          </p>
          <p className="text-sm text-ink-500 leading-relaxed">
            One thing recovery cannot do: your old direct messages were encrypted to the key
            you lost, and they stay unreadable.
          </p>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={() => void requestRecovery()}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-vb-600 hover:bg-vb-500
                       text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Ask for a new key
          </button>
        </div>
      )}

      {request?.state === "pending" && (
        <div className="glass-card p-6 space-y-2">
          <p className="text-sm font-semibold text-white">Waiting on the relay operator</p>
          <p className="text-sm text-ink-400 leading-relaxed">
            Your request is in. Someone will look at it and, once they approve, this page will
            offer you the new key. Nothing else is needed from you — come back and refresh.
          </p>
        </div>
      )}

      {request?.state === "denied" && (
        <div className="glass-card p-6 space-y-2 border border-amber-500/40">
          <p className="text-sm font-semibold text-amber-300">Not approved</p>
          {request.decisionNote && (
            <p className="text-sm text-ink-300 leading-relaxed">{request.decisionNote}</p>
          )}
          <button
            type="button"
            onClick={() => void requestRecovery()}
            disabled={busy}
            className="text-xs text-ink-400 hover:text-ink-200 underline underline-offset-2 disabled:opacity-40"
          >
            Ask again
          </button>
        </div>
      )}

      {request?.state === "approved" && (
        <div className="glass-card p-6 space-y-4 border border-vb-500/50">
          <p className="text-sm font-semibold text-white">Approved — claim your key</p>
          <p className="text-sm text-ink-400 leading-relaxed">
            Your browser makes the key itself and keeps it. It is never sent to the server and
            never put in an email, so this is the only place it will exist. Claim it on the
            machine you actually want to be signed in on.
          </p>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="button"
            onClick={() => void claim()}
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-vb-600 hover:bg-vb-500
                       text-white text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            Make my new key
          </button>
        </div>
      )}

      {request?.state === "claimed" && (
        <div className="glass-card p-6 space-y-3 border border-vb-500/50">
          <p className="text-sm font-semibold text-white flex items-center gap-2">
            <Check className="w-4 h-4 text-vb-400" />
            You have your account back
          </p>
          <p className="text-sm text-ink-400 leading-relaxed">
            You are signed in on this browser with a new key, and everything you posted under
            the old one is yours again.
          </p>
          {/* The key itself, on the one screen where saving it is obviously the
              next thing. Only when this browser is the one holding it: opening
              this page somewhere else shows a claimed recovery, not a key.
              Anything else would be an exhortation to save something with no
              way to save it — which is how people end up back here. */}
          {request.newPubkey && identity?.publicKey === request.newPubkey ? (
            <div className="space-y-2">
              <p className="text-sm text-ink-300 leading-relaxed">
                This is your new key. Save it now — in a password manager, or anywhere you
                will still have in a year.
              </p>
              <IdentityKeyCard privateKey={identity.privateKey} />
              <p className="text-xs text-ink-500 leading-relaxed">
                It lives in this browser and nowhere else. Clearing site data loses it, and
                there is no copy on the server to fall back on. With it saved you can sit down
                on any other device by pasting it into{" "}
                <span className="text-ink-400">Pull Up a Chair</span>.
              </p>
            </div>
          ) : (
            request.newPubkey && (
              <div className="space-y-2">
                <code className="block text-xs font-mono text-ink-400 bg-ink-900 border border-ink-800 rounded-lg p-3 break-all">
                  {short(request.newPubkey)}
                </code>
                <p className="text-xs text-ink-500 leading-relaxed">
                  This recovery was claimed in a different browser, which is where the key
                  itself lives. Open this page there to copy it.
                </p>
              </div>
            )
          )}
          {request.addressPullUrl && (
            <p className="text-sm text-ink-400 leading-relaxed">
              One thing left: your front door in Verglas is still on the old key. A change to
              your address is{" "}
              <a
                href={request.addressPullUrl}
                target="_blank"
                rel="noreferrer"
                className="text-vb-400 hover:text-vb-300"
              >
                waiting to be merged
              </a>
              , and until it lands your home won&apos;t know you at the door. Nothing else is
              affected — everything here is already yours again.
            </p>
          )}
          {addressError && (
            <p className="text-sm text-ink-500 leading-relaxed flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              Your identity is recovered, but your address could not be updated automatically
              ({addressError}) — mention it to the operator so uploads keep working.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
