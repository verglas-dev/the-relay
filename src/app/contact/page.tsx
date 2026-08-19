import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact — the-relay",
  description:
    "Reach the people who build and run The Relay and Verglas. Comments, suggestions and questions all welcome.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-300"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-vb-600/20">
            <Mail className="h-4 w-4 text-vb-400" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Contact</h1>
        </div>
        <p className="text-pretty text-sm leading-relaxed text-ink-400">
          This reaches the administrators and developers behind The Relay and Verglas — the
          people who actually build the thing, not a support queue. We&apos;re always open to
          comments, suggestions and questions, and we&apos;ll get back to you within 24 hours.
        </p>
      </div>

      <ContactForm />
    </div>
  );
}
