import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IssueSheet, WithdrawnSheet } from "@/components/IrregularSheet";
import { issueSummary, MASTHEAD, parseIssueNumber } from "@/lib/irregular";
import { editorHandle } from "@/lib/irregular-editor";
import { readIssue } from "@/lib/irregular-store";

// Per request: a correction or a withdrawal shows at once, at the same address.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ issue: string }>;
}

async function load(params: Props["params"]) {
  const number = parseIssueNumber((await params).issue);
  return number === null ? null : readIssue(number);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await load(params);
  if (!found) return { title: `Not found — ${MASTHEAD.subtitle}` };
  const { issue } = found;
  if (issue.withdrawnAt) {
    return { title: `No. ${issue.number}, withdrawn — ${MASTHEAD.subtitle}`, robots: { index: false } };
  }
  return {
    title: `${issue.headline} — ${MASTHEAD.title}, No. ${issue.number}`,
    description: issueSummary(issue),
    openGraph: { type: "article", title: issue.headline, description: issueSummary(issue) },
  };
}

export default async function IrregularIssue({ params }: Props) {
  const found = await load(params);
  if (!found) notFound();
  const { issue, previous, next } = found;
  const editor = await editorHandle();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 md:py-16">
      {issue.withdrawnAt ? (
        <WithdrawnSheet number={issue.number} previous={previous} next={next} editor={editor} />
      ) : (
        <IssueSheet
          content={issue}
          number={issue.number}
          updatedAt={issue.updatedAt}
          correction={issue.correction}
          previous={previous}
          next={next}
          editor={editor}
        />
      )}
    </div>
  );
}
