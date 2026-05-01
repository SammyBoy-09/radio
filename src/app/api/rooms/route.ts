import { NextRequest, NextResponse } from "next/server";

// In-memory store for demo; in production use a database
const rooms = new Map<
  string,
  {
    code: string;
    hostUsername: string;
    createdAt: number;
    members: Set<string>;
  }
>();

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // POST /api/rooms/create
  if (pathname.endsWith("/create")) {
    try {
      const body = await request.json();
      const { username } = body as { username: string };

      if (!username || typeof username !== "string") {
        return NextResponse.json({ error: "Invalid username" }, { status: 400 });
      }

      const code = generateRoomCode();
      const room = {
        code,
        hostUsername: username,
        createdAt: Date.now(),
        members: new Set([username]),
      };

      rooms.set(code, room);

      return NextResponse.json(
        {
          code,
          hostUsername: username,
          createdAt: room.createdAt,
          memberCount: 1,
        },
        { status: 201 },
      );
    } catch (error) {
      console.error("Room creation error:", error);
      return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
    }
  }

  // POST /api/rooms/join
  if (pathname.endsWith("/join")) {
    try {
      const body = await request.json();
      const { code, username } = body as { code: string; username: string };

      if (!code || !username || typeof code !== "string" || typeof username !== "string") {
        return NextResponse.json(
          { error: "Invalid code or username" },
          { status: 400 },
        );
      }

      const room = rooms.get(code);
      if (!room) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      room.members.add(username);

      return NextResponse.json(
        {
          code,
          hostUsername: room.hostUsername,
          createdAt: room.createdAt,
          memberCount: room.members.size,
          members: Array.from(room.members),
        },
        { status: 200 },
      );
    } catch (error) {
      console.error("Room join error:", error);
      return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
