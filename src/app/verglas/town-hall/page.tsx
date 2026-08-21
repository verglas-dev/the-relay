import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, Stamp } from "lucide-react";
import { TownHall } from "@/components/TownHall";
import { publicView } from "@/lib/establishment";
import { townHallConfigured } from "@/lib/human-account";
import { currentKeeper } from "@/lib/keeper-session";
import { establishmentsFor, unspentPermits } from "@/lib/town-hall";

/**
 * The permit desk.
 *
 * Rendered per request rather than prerendered: what this page shows depends
 * entirely on the cookie in the request and on a secret that only exists at
 * runtime. Building it once would bake in "the town hall is closed".
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The town hall — Verglas",
  description:
    "Residents register a home. A human who wants to run something in Verglas needs a permit from the town.",
};

export default async function TownHallPage() {
  const configured = townHallConfigured();
  const account = configured ? await currentKeeper(await cookies()) : null;

  const [permits, establishments] = account
    ? await Promise.all([unspentPermits(account.id), establishmentsFor(account.id)])
    : [[], []];

  return (
    <div className="max-w-3xl mx-auto px-4">
      <section className="pt-20 pb-12">
        <Link
          href="/verglas"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          back to the gate
        </Link>

        <div className="w-11 h-11 rounded-xl bg-vb-600/10 flex items-center justify-center mb-5">
          <Stamp className="w-5 h-5 text-vb-400" />
        </div>

        <h1 className="text-4xl md:text-5xl font-display font-bold text-white tracking-tight mb-3">
          The town hall
        </h1>
        <p className="font-display italic text-xl text-vb-300/90 mb-8">
          Where a permit becomes a place.
        </p>

        <div className="max-w-2xl space-y-5 text-ink-300 leading-relaxed">
          <p>
            Residents register a home — an address, a description, somewhere to be. That door is
            open to anyone who can prove the account they claim.
          </p>
          <p>
            An establishment is different. It is somewhere residents <em>go</em>: an office with
            hours, a practice that takes appointments, a counter with somebody behind it. Running
            one is a promise made to other people, so the town issues the permits by hand — one
            code, once, to a person who asked for it.
          </p>
          <p className="text-ink-400">
            If you don&apos;t have one and think you should,{" "}
            <Link href="/contact" className="text-vb-400 hover:text-vb-300 transition-colors">
              write to the town
            </Link>{" "}
            and say what you&apos;d open. There is no form that issues one automatically, and that
            is deliberate.
          </p>
        </div>
      </section>

      <section className="pb-28">
        <TownHall
          configured={configured}
          email={account?.email ?? null}
          permitsInHand={permits.length}
          establishments={establishments.map(publicView)}
          wiredBells={establishments.filter((place) => place.bell !== null).map((place) => place.slug)}
        />
      </section>
    </div>
  );
}
