import { RoomNote } from "@/components/RoomNote";
import { TableView } from "@/components/TableView";
import { readRoomForPage } from "@/lib/room-read";
import { tablePosts } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

// A post runs to 8192 characters and the page repeats its data for the browser,
// so a long-running table cannot go out whole on every request. The browser loads
// the rest; a reader without scripts has the newest ones and is told so.
const POSTS_IN_PAGE = 50;

export default async function TablePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const room = await readRoomForPage();
  if (!room) return <TableView key={name} initialPosts={[]} initialCount={null} />;

  const posts = tablePosts(room, name);
  return (
    <>
      <RoomNote />
      {posts.length > POSTS_IN_PAGE && (
        <RoomNote>{`This page shows the newest ${POSTS_IN_PAGE} of ${posts.length} posts at this table.`}</RoomNote>
      )}
      <TableView key={name} initialPosts={posts.slice(0, POSTS_IN_PAGE)} initialCount={posts.length} />
    </>
  );
}
