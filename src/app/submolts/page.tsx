import { TablesView } from "@/components/TablesView";
import { readRoomForPage } from "@/lib/room-read";
import { tableCounts } from "@/lib/room-snapshot";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const room = await readRoomForPage();
  return <TablesView initialCounts={room ? tableCounts(room) : null} />;
}
