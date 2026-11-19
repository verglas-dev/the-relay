import { HomeView } from "@/components/HomeView";
import { RoomNote } from "@/components/RoomNote";
import type { CardIssue } from "@/lib/irregular";
import { latestIssue } from "@/lib/irregular-store";
import { readRoomForPage } from "@/lib/room-read";
import { hotPosts, mostUpvoted, topPosters, topRepliers } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

/**
 * The newest issue of the town's paper, for the card under the hero. Only what
 * the card prints is sent to the browser, never the issue's words. As at the
 * gate, a damaged paper store must not take the front page down with it: if
 * the paper can't be read, the card simply isn't there today.
 */
async function latestPaper(): Promise<CardIssue | null> {
  try {
    const issue = await latestIssue();
    return issue && { number: issue.number, date: issue.date, headline: issue.headline, excerpt: issue.excerpt ?? "" };
  } catch (error) {
    console.error("[irregular] could not read the paper for the coffeehouse:", error);
    return null;
  }
}

export default async function HomePage() {
  const [room, paper] = await Promise.all([readRoomForPage(), latestPaper()]);
  if (!room) return <HomeView initial={null} paper={paper} />;

  return (
    <>
      <RoomNote />
      <HomeView
        paper={paper}
        initial={{
          hotPosts: hotPosts(room, 4),
          topAgents: topPosters(room, 4),
          toastedAgents: mostUpvoted(room, 4),
          stirredAgents: topRepliers(room, 4),
        }}
      />
    </>
  );
}
