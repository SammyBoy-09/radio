import Pusher from "pusher";
import { NextRequest, NextResponse } from "next/server";

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || "",
  key: process.env.PUSHER_APP_KEY || "",
  secret: process.env.PUSHER_APP_SECRET || "",
  cluster: process.env.PUSHER_APP_CLUSTER || "",
  useTLS: true,
});

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let socketId = "";
    let channelName = "";
    let username: string | undefined;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        socket_id?: string;
        channel_name?: string;
        username?: string;
      };
      socketId = body.socket_id || "";
      channelName = body.channel_name || "";
      username = body.username;
    } else {
      const bodyText = await request.text();
      const params = new URLSearchParams(bodyText);
      socketId = params.get("socket_id") || "";
      channelName = params.get("channel_name") || "";
      username = params.get("username") || undefined;
    }

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: "Missing socket_id or channel_name" },
        { status: 400 },
      );
    }

    if (!channelName.startsWith("private-") && !channelName.startsWith("presence-")) {
      return NextResponse.json({ error: "Invalid channel" }, { status: 403 });
    }

    const auth = channelName.startsWith("presence-")
      ? pusher.authorizeChannel(socketId, channelName, {
          user_id: username || `user-${socketId.slice(0, 8)}`,
          user_info: {
            name: username || "Guest",
          },
        })
      : pusher.authorizeChannel(socketId, channelName);

    return NextResponse.json(auth, { status: 200 });
  } catch (error) {
    console.error("Pusher auth error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
