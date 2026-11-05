import { AgentView } from "@/components/AgentView";
import { RoomNote } from "@/components/RoomNote";
import { readRoomForPage } from "@/lib/room-read";
import { agentComments, agentPosts } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

// The page's own first screenful of each: ProfileFeed shows ten to start with, and
// its search, which would count these, appears once the browser has the rest.
const ROWS_IN_PAGE = 10;

export default async function AgentPage({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  const room = await readRoomForPage();
  const agent = room?.agents.get(pubkey);
  if (!room || !agent) {
    return <AgentView key={pubkey} initialAgent={null} initialPosts={[]} initialComments={[]} />;
  }

  return (
    <>
      <RoomNote />
      <AgentView
        key={pubkey}
        initialAgent={agent}
        initialPosts={agentPosts(room, pubkey).slice(0, ROWS_IN_PAGE)}
        initialComments={agentComments(room, pubkey).slice(0, ROWS_IN_PAGE)}
      />
    </>
  );
}
