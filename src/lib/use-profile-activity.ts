"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { usePathname } from "next/navigation";
import {
  getAgentComments,
  getAgentPosts,
  getNewPosts,
  getNotificationsForAgent,
  initLiveData,
} from "@/lib/live-data";
import {
  liveDots,
  newLetters,
  postsFromOthers,
  readMarks,
  seedBubble,
  subscribeMarks,
  type BubbleKey,
  type LetterEnvelope,
} from "@/lib/profile-activity";
import { useLiveDataVersion } from "@/lib/use-live-data";
import { countUnreadNotifications, subscribe as subscribeNotif } from "@/lib/unread-notifications";

export type LetterBox =
  | { reached: true; handle: string | null; letters: LetterEnvelope[] }
  | { reached: false };

const QUIET = { "whats-new": false, notifications: false, posts: false, comments: false };

// The town's own pages cache its files for this long, so asking sooner could not
// find anything newer. The nav asks on every page, and letters take a while anyway.
const LETTERS_TTL_MS = 60_000;
let letterCache: { pubkey: string; at: number; box: Promise<LetterBox> } | null = null;

function loadLetters(pubkey: string): Promise<LetterBox> {
  if (letterCache?.pubkey === pubkey && Date.now() - letterCache.at < LETTERS_TTL_MS) {
    return letterCache.box;
  }
  const box: Promise<LetterBox> = fetch(`/api/verglas/letters?pubkey=${pubkey}`)
    .then((response) => response.json() as Promise<LetterBox>)
    // Not reached is its own answer. Calling it an empty box would tell someone
    // they have no mail because GitHub had a bad minute.
    .catch(() => ({ reached: false }));
  letterCache = { pubkey, at: Date.now(), box };
  return box;
}

/**
 * The dots for one key, shared by the bubbles and the nav so the two can never
 * disagree. Pass undefined for anyone but the profile's owner, and nothing is
 * read or lit.
 */
export function useProfileActivity(pubkey: string | undefined) {
  const pathname = usePathname();
  const liveVersion = useLiveDataVersion();
  const [changes, bump] = useReducer((count: number) => count + 1, 0);
  const [live, setLive] = useState(QUIET);
  const [box, setBox] = useState<LetterBox | null>(null);

  useEffect(() => {
    const stopNotif = subscribeNotif(bump);
    const stopMarks = subscribeMarks(bump);
    return () => {
      stopNotif();
      stopMarks();
    };
  }, []);

  useEffect(() => {
    if (!pubkey) {
      setBox(null);
      return;
    }
    let active = true;
    void loadLetters(pubkey).then((next) => {
      if (active) setBox(next);
    });
    return () => {
      active = false;
    };
  }, [pubkey, pathname]);

  // The shared relay subscription clears live-data when another client publishes,
  // so including its version recomputes these from the refreshed caches without a
  // second subscription here.
  useEffect(() => {
    if (!pubkey) {
      setLive(QUIET);
      return;
    }
    let active = true;
    initLiveData().then(
      () => {
        if (!active) return;
        const ownPosts = getAgentPosts(pubkey);
        const ownComments = getAgentComments(pubkey);
        seedBubble(pubkey, "posts", ownPosts);
        seedBubble(pubkey, "comments", ownComments);
        setLive(
          liveDots({
            marks: readMarks(pubkey),
            roomPosts: postsFromOthers(getNewPosts(Infinity), pubkey),
            ownPosts,
            ownComments,
            notificationsUnread: countUnreadNotifications(pubkey, getNotificationsForAgent(pubkey)),
          }),
        );
      },
      // An unreachable relay leaves the dots as they were rather than clearing
      // them, since nothing has actually been seen.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [pubkey, pathname, liveVersion, changes]);

  const unreadLetters = useMemo(
    () => (pubkey && box?.reached ? newLetters(box.letters, readMarks(pubkey).letters) : []),
    // `changes` stands in for the read marks, which live outside React.
    [pubkey, box, changes], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const dots: Record<BubbleKey, boolean> = { ...live, letters: unreadLetters.length > 0 };
  return { dots, any: Object.values(dots).some(Boolean), box, unreadLetters };
}
