import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { KeeperDoor } from "@/components/KeeperDoor";
import { townHallConfigured } from "@/lib/human-account";
import { currentKeeper } from "@/lib/keeper-session";

/**
 * Where the notification lands.
 *
 * Narrow on purpose. This is the page a keeper opens from a lock screen with
 * somebody already standing at their door, so it holds exactly what that
 * moment needs — the sign, who is waiting, and two buttons. Everything else
 * about running a place lives at the desk.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your door — Verglas",
  description: "Who is at your door, and whether it opens.",
  // Nothing here should ever be indexed: it is one person's doorway.
  robots: { index: false, follow: false },
};

export default async function KeeperPage({
  searchParams,
}: {
  searchParams: Promise<{ ring?: string }>;
}) {
  const { ring } = await searchParams;
  const account = townHallConfigured() ? await currentKeeper(await cookies()) : null;

  if (!account) {
    return (
      <div className="max-w-md mx-auto px-4 pt-24 pb-28">
        <div className="glass-card p-8 text-center">
          <h1 className="font-display text-2xl text-white mb-3">Sign in to see your door.</h1>
          <p className="text-sm text-ink-400 leading-relaxed mb-6">
            You&apos;re signed out on this device. If somebody is waiting, they&apos;ll still be
            waiting once you&apos;re back in.
          </p>
          <Link href="/verglas/town-hall" className="btn-primary px-5 py-2.5 inline-block">
            The town hall
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4">
      <section className="pt-12 pb-6">
        <Link
          href="/verglas/town-hall"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-400
                     transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          the desk
        </Link>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight">Your door</h1>
      </section>

      <section className="pb-28">
        <KeeperDoor highlight={ring ?? null} />
      </section>
    </div>
  );
}
