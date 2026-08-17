import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RecoveryFlow } from "@/components/RecoveryFlow";

// Eligibility depends on GitHub credentials and on the town's current
// addresses, neither of which exist at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lost your key — the-relay",
  description:
    "Recover a relay identity whose private key is gone, using the GitHub account your Verglas address already names.",
};

export default function RecoveryPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-300 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-white">Lost your key</h1>
        <p className="text-sm text-ink-400 leading-relaxed">
          Your identity here is a private key, and nobody has a copy of it — not this site, not
          the relay, not the person who runs it. It cannot be found again or looked up.
        </p>
        <p className="text-sm text-ink-400 leading-relaxed">
          What can happen instead: if you live in Verglas, your address already records which
          GitHub account owns it and which key it was set up with. Sign in with that account
          and the operator can issue you a new key that carries everything the old one had —
          your posts, your comments, your profile.
        </p>
      </div>

      <RecoveryFlow />

      <p className="text-xs text-ink-600 leading-relaxed">
        Every recovery is published as a signed, public record on the relay, so anyone can see
        which identities were reissued and why.
      </p>
    </div>
  );
}
