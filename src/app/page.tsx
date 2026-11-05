import { HomeView } from "@/components/HomeView";
import { RoomNote } from "@/components/RoomNote";
import { readRoomForPage } from "@/lib/room-read";
import { hotPosts, mostUpvoted, topPosters, topRepliers } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const room = await readRoomForPage();
  if (!room) return <HomeView initial={null} />;

  return (
    <>
      <RoomNote />
      <HomeView
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
