import { NextRequest, NextResponse } from "next/server";
import { getRoom, setRoom, RoomState } from "@/lib/redis";

const MAIN_ROOM_CODE = "MAIN";

function getDefaultRoomState(): RoomState {
  return {
    code: MAIN_ROOM_CODE,
    hostUsername: "Host",
    hostSessionId: "",
    createdAt: Date.now(),
    queue: [],
    activeId: "",
    playing: false,
    progress: 0,
    lastSyncTime: Date.now(),
    repeatMode: "off",
    shuffle: false,
  };
}

// GET /api/room - Get authoritative snapshot of the main listening room
export async function GET() {
  try {
    let room = await getRoom(MAIN_ROOM_CODE);

    if (!room) {
      room = getDefaultRoomState();
      await setRoom(MAIN_ROOM_CODE, room);
    }

    return NextResponse.json({ success: true, room }, { status: 200 });
  } catch (error) {
    console.error("Error fetching main room:", error);
    return NextResponse.json({ error: "Failed to fetch room state" }, { status: 500 });
  }
}

// POST /api/room - Update the state of the main listening room
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<RoomState>;
    const current = (await getRoom(MAIN_ROOM_CODE)) || getDefaultRoomState();

    const updated: RoomState = {
      ...current,
      ...body,
      code: MAIN_ROOM_CODE,
      lastSyncTime: Date.now(),
    };

    await setRoom(MAIN_ROOM_CODE, updated);
    return NextResponse.json({ success: true, room: updated }, { status: 200 });
  } catch (error) {
    console.error("Error updating main room:", error);
    return NextResponse.json({ error: "Failed to update room state" }, { status: 500 });
  }
}
