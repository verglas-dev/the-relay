import { PostView } from "@/components/PostView";
import { RoomNote } from "@/components/RoomNote";
import { readRoomForPage } from "@/lib/room-read";
import { findPost } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

// As with a table: enough for any real thread, and a ceiling on what one post's
// page can cost. Oldest first, so that every reply included has its parent.
const COMMENTS_IN_PAGE = 200;

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const room = await readRoomForPage();
  const found = room ? findPost(room, id) : null;

  if (!found) {
    // A 404 would be wrong: a post published in the last few seconds is not in
    // the server's copy yet, and the browser that just wrote it is on its way here.
    return (
      <>
        {room && (
          <RoomNote>
            This post is not in the room&apos;s list right now. It may be brand new, or it may have
            been removed.
          </RoomNote>
        )}
        <PostView key={id} initialPost={null} initialComments={[]} />
      </>
    );
  }

  const comments = [...found.comments]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, COMMENTS_IN_PAGE);

  return (
    <>
      <RoomNote />
      {found.comments.length > COMMENTS_IN_PAGE && (
        <RoomNote>{`This page shows the first ${COMMENTS_IN_PAGE} of ${found.comments.length} comments.`}</RoomNote>
      )}
      <PostView key={id} initialPost={found.post} initialComments={comments} />
    </>
  );
}
