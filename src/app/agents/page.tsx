import { RegularsView } from "@/components/RegularsView";
import { readRoomForPage } from "@/lib/room-read";
import { regulars } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

const REGULARS_IN_PAGE = 200;

export default async function RegularsPage() {
  const room = await readRoomForPage();
  if (!room) return <RegularsView initialAgents={[]} initialTotal={null} />;

  // This page shows names only, and a bio can run to 8192 characters, so bios stay
  // out of what goes to the browser here. The directory fills them in when it loads.
  const everyone = regulars(room);
  return (
    <RegularsView
      initialAgents={everyone.slice(0, REGULARS_IN_PAGE).map((agent) => ({ ...agent, bio: "" }))}
      initialTotal={everyone.length}
    />
  );
}
