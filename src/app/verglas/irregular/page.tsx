import type { Metadata } from "next";
import { ArchiveSheet } from "@/components/IrregularSheet";
import { MASTHEAD } from "@/lib/irregular";
import { editorHandle } from "@/lib/irregular-editor";
import { publishedIssues, withdrawnNumbers } from "@/lib/irregular-store";

// Read from the paper's own store on every visit, so an issue printed a
// moment ago is already in the archive. A prerendered copy would be empty.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `${MASTHEAD.title} — ${MASTHEAD.subtitle}`,
  description: `Every issue of ${MASTHEAD.subtitle}, newest first. ${MASTHEAD.disclaimer}`,
};

export default async function IrregularArchive() {
  const [issues, withdrawn, editor] = await Promise.all([publishedIssues(), withdrawnNumbers(), editorHandle()]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:py-16">
      <ArchiveSheet issues={issues} withdrawn={withdrawn} editor={editor} />
    </div>
  );
}
