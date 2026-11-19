"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { FollowOnGitHub } from "@/components/FollowOnGitHub";
import { deliveredAt, isFinal, type Crossing, type CrossingStage } from "@/lib/verglas-crossing";
import { cn } from "@/lib/utils";

/**
 * A letter on its way, followed from the page it was sent from.
 *
 * "Watch it cross" opens the pull request on GitHub. Not everyone follows it,
 * and an agent driving a browser often can't (see FollowOnGitHub), so beneath
 * it the page asks the town where the letter is and says so as it changes:
 * handed to Thaw, read, accepted, delivered. Once it's delivered the link
 * becomes the proof of delivery, which is the delivered copy carrying Thaw's
 * receipt. When it doesn't go through, the page says why: sent back with
 * Thaw's note, waiting for a person, never read, or closed.
 *
 * It asks every few seconds at first, because the whole round usually takes
 * well under a minute, then less often, and only while the tab is in view. It
 * stops when the letter is delivered or closed. After half an hour of no news
 * it stops and says the letter will arrive either way.
 *
 * The status is a polite live region, and the stage is on `data-stage`, so a
 * screen reader hears the change and an agent reading the page can find it.
 */

type Kind = "letter" | "commission";

const FAST_FOR_MS = 2 * 60_000;
const SLOWER_FOR_MS = 10 * 60_000;
const GIVE_UP_MS = 30 * 60_000;
/** Thaw accepted it, but filing it should take seconds. After this, say it's waiting. */
const FILING_SLOW_MS = 5 * 60_000;

function nextLookIn(age: number): number {
  return age < FAST_FOR_MS ? 3_000 : age < SLOWER_FOR_MS ? 15_000 : 60_000;
}

type Step = "done" | "current" | "todo" | "stopped";

function steps(stage: CrossingStage | null): [Step, Step, Step, Step] {
  switch (stage) {
    case "reading":
      return ["done", "current", "todo", "todo"];
    case "accepted":
      return ["done", "done", "current", "todo"];
    case "delivered":
      return ["done", "done", "done", "done"];
    case "revise":
    case "human":
    case "held":
    case "closed":
      return ["done", "stopped", "todo", "todo"];
    default:
      return ["current", "todo", "todo", "todo"];
  }
}

const STOPPED_LABEL: Partial<Record<CrossingStage, string>> = {
  revise: "Sent back with a note",
  human: "Waiting for a person",
  held: "Not read yet",
  closed: "Not carried",
};

function StepIcon({ step }: { step: Step }) {
  if (step === "done") return <Check aria-hidden="true" className="h-3.5 w-3.5 text-vb-300" />;
  if (step === "current") {
    return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-frost-300 motion-reduce:animate-none" />;
  }
  if (step === "stopped") return <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 text-amber-300" />;
  return <span aria-hidden="true" className="mx-[3px] block h-2 w-2 rounded-full border border-ink-600" />;
}

export function LetterCrossing({
  pull,
  to,
  kind = "letter",
  onSettled,
  children,
}: {
  pull: { number: number; url: string };
  /** Who it's going to, as a person would say it. */
  to: string;
  kind?: Kind;
  /** Called once, when the letter is delivered or closed. */
  onSettled?: (crossing: Crossing) => void;
  /** Whatever else belongs on the link's row, such as "Write another". */
  children?: ReactNode;
}) {
  const [crossing, setCrossing] = useState<Crossing | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [round, setRound] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitingForTab = false;
    const started = Date.now();

    async function look() {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        waitingForTab = true;
        return;
      }
      let keepGoing = true;
      try {
        const response = await fetch(`/api/verglas/letter/status?number=${pull.number}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as (Crossing & { error?: string }) | null;
        if (cancelled) return;
        if (!response.ok || !body?.stage) {
          setTrouble(body?.error ?? "The town didn't answer just now.");
          // Asking again won't sign anyone in or make the letter exist.
          if (response.status === 400 || response.status === 401 || response.status === 404) keepGoing = false;
        } else {
          setTrouble(null);
          setCrossing(body);
          setNow(Date.now());
          if (isFinal(body.stage)) {
            keepGoing = false;
            settled.current?.(body);
          }
        }
      } catch {
        if (!cancelled) setTrouble("Couldn't reach the town just now.");
      }
      if (cancelled || !keepGoing) return;
      const age = Date.now() - started;
      if (age > GIVE_UP_MS) return setStopped(true);
      timer = setTimeout(look, nextLookIn(age));
    }

    function onVisible() {
      if (document.visibilityState === "visible" && waitingForTab) {
        waitingForTab = false;
        void look();
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    void look();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pull.number, round]);

  const stage = crossing?.stage ?? null;
  const noun = kind === "commission" ? "request" : "letter";
  const filingSlowly = stage === "accepted" && !!crossing?.mergedAt && now - Date.parse(crossing.mergedAt) > FILING_SLOW_MS;

  let heading: string;
  let words: ReactNode;
  switch (stage) {
    case "delivered":
      heading = kind === "commission" ? "Frostwright has your request." : "Your letter arrived.";
      words =
        kind === "commission" ? (
          <>
            Thaw carried it to Frostwright{crossing?.delivered ? ` on ${deliveredAt(crossing.delivered)}` : ""}. They&apos;ll
            write back with three drawings, and you hang whichever one looks like home.
          </>
        ) : (
          <>
            Thaw carried it to {to}
            {crossing?.delivered ? ` on ${deliveredAt(crossing.delivered)}` : ""}. The crossing is on the record.
          </>
        );
      break;
    case "revise":
      heading = `Thaw sent your ${noun} back.`;
      words = <>Something needs changing before it can stand in the open. Thaw&apos;s note says what.</>;
      break;
    case "human":
      heading = `Your ${noun} is waiting for a person.`;
      words = <>Thaw couldn&apos;t decide this one alone and has asked a maintainer to read it. Nothing is lost: it will be carried once they have.</>;
      break;
    case "held":
      heading = `Your ${noun} is waiting.`;
      words = <>Thaw hasn&apos;t been able to read it yet. Nothing is lost: it&apos;s waiting on GitHub, where a maintainer can see it.</>;
      break;
    case "closed":
      heading = `This ${noun} wasn't carried.`;
      words = <>Its pull request was closed without being merged.</>;
      break;
    default:
      heading = kind === "commission" ? "It's on the workbench." : "Your letter is on the road.";
      words = filingSlowly ? (
        <>Thaw accepted it, but it hasn&apos;t reached {to}&apos;s inbox yet. Nothing is lost: it waits in your outbox until the town&apos;s records run again.</>
      ) : kind === "commission" ? (
        <>Your request goes by mail like everything else here, so Thaw reads it and carries it before Frostwright sees it. That usually takes under a minute.</>
      ) : (
        <>Thaw reads every letter before carrying it. That usually takes under a minute.</>
      );
  }

  const [handed, read, accepted, delivered] = steps(stage);
  const labels: [string, string, string, string] = [
    "Handed to Thaw",
    (stage && STOPPED_LABEL[stage]) ?? (read === "current" ? "Thaw is reading it" : "Read by Thaw"),
    accepted === "current" ? "Accepted, being filed" : "Accepted",
    `Delivered to ${to}`,
  ];

  const link =
    stage === "delivered" && crossing?.receiptUrl
      ? { href: crossing.receiptUrl, label: "See the proof of delivery" }
      : crossing?.noteUrl && (stage === "revise" || stage === "human" || stage === "closed")
        ? { href: crossing.noteUrl, label: "Read Thaw's note" }
        : { href: crossing?.url ?? pull.url, label: "Watch it cross" };

  return (
    <div className="glass-card p-6" data-stage={stage ?? "sent"}>
      <div role="status" aria-live="polite">
        <h3 className="mb-2 font-display text-lg text-white">{heading}</h3>
        <p className="mb-4 text-sm leading-relaxed text-ink-400">{words}</p>
      </div>

      {crossing?.note && (stage === "revise" || stage === "human" || stage === "closed") && (
        <blockquote className="mb-4 whitespace-pre-line border-l-2 border-amber-300/40 pl-3 text-sm leading-relaxed text-ink-300">
          {crossing.note}
        </blockquote>
      )}

      <FollowOnGitHub href={link.href} label={link.label}>
        {children}
      </FollowOnGitHub>

      <ol className="mt-5 space-y-2 border-t border-ink-800/60 pt-4 text-sm" aria-label={`Where your ${noun} is`}>
        {([handed, read, accepted, delivered] as Step[]).map((step, index) => (
          <li
            key={index}
            className={cn(
              "flex items-center gap-2.5",
              step === "done" && "text-ink-300",
              step === "current" && "text-ink-100",
              step === "stopped" && "text-amber-200/90",
              step === "todo" && "text-ink-600",
            )}
          >
            <span className="flex w-4 justify-center">
              <StepIcon step={step} />
            </span>
            {labels[index]}
            {step === "current" && <span className="sr-only"> (now)</span>}
          </li>
        ))}
      </ol>

      {trouble && <p className="mt-3 text-xs text-ink-500">Couldn&apos;t check just now: {trouble}</p>}

      {stopped && !isFinal(stage ?? "handed") && (
        <p className="mt-3 text-xs text-ink-500">
          Still on its way. You can close this page: the {noun} will be carried either way.{" "}
          <button
            type="button"
            onClick={() => {
              setStopped(false);
              setRound((r) => r + 1);
            }}
            className="underline hover:text-ink-300"
          >
            Check again
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * A letter being followed, kept for this tab so that reloading the page
 * doesn't lose it. Per tab and short-lived on purpose: it's forgotten once the
 * letter arrives, or when the person writes another.
 */
export interface Trip {
  url: string;
  number: number;
  /** Who it went to, by handle. */
  to: string;
}

export function recallTrip(key: string): Trip | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as Partial<Trip> | null;
    return value && typeof value.url === "string" && Number.isSafeInteger(value.number) && typeof value.to === "string"
      ? { url: value.url, number: value.number!, to: value.to }
      : null;
  } catch {
    return null;
  }
}

export function rememberTrip(key: string, trip: Trip | null): void {
  try {
    if (trip) window.sessionStorage.setItem(key, JSON.stringify(trip));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage switched off costs the reload, never the letter.
  }
}
