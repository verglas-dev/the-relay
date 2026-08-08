"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as ed from "@noble/ed25519";
import { KeyRound, Lock, Mail, Map, Users } from "lucide-react";
import { useIdentity } from "@/lib/identity-context";
import { VerglasCompose } from "@/components/VerglasCompose";
import { VerglasCommission } from "@/components/VerglasCommission";
import { VerglasHangPicture } from "@/components/VerglasHangPicture";
import { VerglasEditHome } from "@/components/VerglasEditHome";
import type { HomeEdit } from "@/lib/verglas-edit";
import { BUILDER } from "@/lib/verglas-commission";
import type { Letter, Resident } from "@/lib/verglas-town";

/**
 * Standing inside your own home.
 *
 * The door is your key. Everything in Verglas is public, so this is not a
 * privacy boundary — the same words are readable by anyone who opens the
 * town. It decides *whose desk this is*: which controls appear, and whose
 * mail is stacked on it. Actually changing the town still goes through the
 * resident's GitHub account, so a spoofed view cannot write anything.
 */

type Standing = "checking" | "no-key" | "wrong-key" | "home";

function proveKey(publishedKey: string, privateKey: string): boolean {
  try {
    const challenge = sha256(new TextEncoder().encode(`verglas:inside:${publishedKey}`));
    const signature = ed.sign(challenge, hexToBytes(privateKey));
    // Verified against the *published* key, so holding the matching private
    // key is what opens the door — not merely claiming the public one.
    return ed.verify(signature, challenge, hexToBytes(publishedKey));
  } catch {
    return false;
  }
}

function Placeholder({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Mail;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5 opacity-70">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4 text-ink-500" />
        <h3 className="text-sm font-semibold text-ink-300">{title}</h3>
        <span className="tag ml-auto text-[10px]">not built yet</span>
      </div>
      <p className="text-sm text-ink-600 leading-relaxed">{children}</p>
    </div>
  );
}

export function VerglasInside({
  resident,
  publishedKey,
  letters,
  neighbours,
  current,
  offer,
  pending,
}: {
  resident: Resident;
  publishedKey: string;
  letters: Letter[];
  neighbours: Resident[];
  /** The two documents as fields, straight from town, for the edit form. */
  current: HomeEdit;
  /** Drawings the builder has offered this home, if any are waiting. */
  offer: { drawings: string[]; from: string } | null;
  pending: { delivered: string } | null;
}) {
  const { identity } = useIdentity();
  const [standing, setStanding] = useState<Standing>("checking");
  const [login, setLogin] = useState<string | null>(null);

  // Presence is the key; authority to write is the GitHub session beside it.
  useEffect(() => {
    const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("verglas_login="));
    if (cookie) setLogin(decodeURIComponent(cookie.slice("verglas_login=".length)));
  }, []);

  useEffect(() => {
    if (!identity?.privateKey) return setStanding("no-key");
    setStanding(proveKey(publishedKey, identity.privateKey) ? "home" : "wrong-key");
  }, [identity, publishedKey]);

  if (standing === "checking") {
    return <p className="text-sm text-ink-600">Trying the lock…</p>;
  }

  if (standing !== "home") {
    return (
      <div className="glass-card p-8 text-center max-w-lg">
        <div className="w-12 h-12 rounded-xl bg-ink-800/60 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-ink-500" />
        </div>
        <h2 className="font-display text-xl text-white mb-2">The door doesn&apos;t open for you.</h2>
        <p className="text-sm text-ink-500 leading-relaxed mb-6">
          {standing === "no-key"
            ? "You are not carrying a key. Generate or import one, and if it matches this address you can come in."
            : `The key you're carrying belongs to a different door. This home answers to ${publishedKey.slice(0, 12)}….`}
        </p>
        <Link href={`/verglas/home/${resident.handle}`} className="btn-ghost text-sm">
          See it from outside instead
        </Link>
      </div>
    );
  }

  const unread = letters.filter((letter) => letter.to === resident.handle);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-vb-600/15 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-vb-400" />
        </div>
        <div>
          <p className="text-sm text-ink-400">The key fits.</p>
          <p className="text-xs font-mono text-ink-600">{publishedKey.slice(0, 24)}…</p>
        </div>
      </div>

      <section>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-300 mb-3">
          <Mail className="w-4 h-4" />
          Your mail
          {unread.length > 0 && (
            <span className="tag text-[10px] bg-vb-600/15 text-vb-300 border-vb-500/25">
              {unread.length}
            </span>
          )}
        </h2>
        {letters.length === 0 ? (
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-ink-500">
              Nothing has crossed your doorstep yet. Letters are carried, so they take a little while.
            </p>
          </div>
        ) : (
          <div className="glass-card divide-y divide-ink-800/60">
            {letters.map((letter, index) => (
              <div key={index} className="px-4 py-3 flex items-baseline justify-between gap-4">
                <span className="text-sm text-ink-200">{letter.subject}</span>
                <span className="text-xs font-mono text-ink-600 shrink-0">
                  {letter.from === resident.handle ? `sent to ${letter.to}` : `from ${letter.from}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <VerglasCompose from={resident.handle} neighbours={neighbours} signedInAs={login} />

      {offer && offer.drawings.length > 0 && (
        <VerglasHangPicture
          handle={resident.handle}
          drawings={offer.drawings}
          builder={offer.from}
          signedInAs={login}
        />
      )}

      {/* The builder cannot commission themselves — a letter has to cross. */}
      {resident.handle !== BUILDER && (
        <VerglasCommission
          handle={resident.handle}
          description={current.home}
          signedInAs={login}
          pending={pending}
        />
      )}

      <VerglasEditHome handle={resident.handle} current={current} signedInAs={login} />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-400">Rooms that aren&apos;t furnished yet</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Placeholder icon={Map} title="Where you stand">
            Verglas has no map yet. When it has one, this home will sit somewhere on it, and
            the street view will be a way of walking there.
          </Placeholder>
          <Placeholder icon={Users} title="Letting someone in">
            A visitor holding the right key could be welcomed further than the doorstep. Who
            you let in, and how far, will be yours to decide.
          </Placeholder>
          <Placeholder icon={KeyRound} title="Making it yours">
            The inside of a home should not look like everyone else&apos;s. What that means is
            still an open question.
          </Placeholder>
        </div>
      </section>
    </div>
  );
}
