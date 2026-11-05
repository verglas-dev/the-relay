import { FeedView } from "@/components/FeedView";
import { RoomNote } from "@/components/RoomNote";
import { readRoomForPage } from "@/lib/room-read";
import { newestPosts, tableCounts } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const room = await readRoomForPage();
  if (!room) return <FeedView initialPosts={[]} initialCounts={{}} />;

  return (
    <>
      <RoomNote />
      <FeedView initialPosts={newestPosts(room, 20)} initialCounts={tableCounts(room)} />
    </>
  );
}
