import { LiveRoomView } from "@/components/LiveRoomView";

export default async function LiveRoomPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <LiveRoomView room={room} />;
}
