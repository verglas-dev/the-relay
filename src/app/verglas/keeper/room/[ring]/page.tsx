import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { KeeperRoom } from "@/components/KeeperRoom";
import { currentKeeper } from "@/lib/keeper-session";
import { getSession } from "@/lib/session";
import { getEstablishment } from "@/lib/town-hall";

/**
 * Where the keeper talks.
 *
 * Opened from the notification on their phone. Guarded by their own signed-in
 * session rather than by holding a link — which is a stronger door than the
 * ntfy topic this replaces, since a topic name was a credential anybody who
 * learned it could use.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "In the room — Verglas",
  robots: { index: false, follow: false },
};

function Closed({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 pt-24 pb-28">
      <div className="glass-card p-8 text-center space-y-4">
        {children}
      </div>
    </div>
  );
}

export default async function KeeperRoomPage({
  params,
}: {
  params: Promise<{ ring: string }>;
}) {
  const { ring } = await params;
  const account = await currentKeeper(await cookies());

  if (!account) {
    return (
      <Closed>
        <h1 className="font-display text-2xl text-white">Sign in to come in.</h1>
        <p className="text-sm text-ink-400 leading-relaxed">
          You&apos;re signed out on this device. Whoever is waiting will still be waiting.
        </p>
        <Link href="/verglas/town-hall" className="btn-primary px-5 py-2.5 inline-block">
          The town hall
        </Link>
      </Closed>
    );
  }

  const session = getSession(ring);
  if (!session) {
    return (
      <Closed>
        <h1 className="font-display text-2xl text-white">That room is empty.</h1>
        <p className="text-sm text-ink-400 leading-relaxed">
          The visit is over, or nobody came. Nothing is kept from a room once it closes.
        </p>
        <Link href="/verglas/keeper" className="btn-primary px-5 py-2.5 inline-block">
          Your door
        </Link>
      </Closed>
    );
  }

  // The room belongs to an establishment, and the establishment to an account.
  // A keeper cannot walk into somebody else's conversation by holding a link.
  const place = await getEstablishment(session.establishment);
  if (!place || place.accountId !== account.id) {
    return (
      <Closed>
        <h1 className="font-display text-2xl text-white">Not your room.</h1>
        <Link href="/verglas/keeper" className="btn-primary px-5 py-2.5 inline-block">
          Your door
        </Link>
      </Closed>
    );
  }

  return <KeeperRoom ring={ring} visitor={session.visitorLabel} place={place.name} />;
}
