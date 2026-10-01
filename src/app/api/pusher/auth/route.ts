import Pusher from "pusher";
import { NextRequest, NextResponse } from "next/server";

function getPusherServer() {
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_APP_KEY;
  const secret = process.env.PUSHER_APP_SECRET;
  const cluster = process.env.PUSHER_APP_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    return null;
  }

  return new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const pusher = getPusherServer();
    if (!pusher) {
      console.warn("Pusher server credentials missing from environment variables.");
      return NextResponse.json(
        { error: "Pusher credentials not configured on server" },
        { status: 503 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let socketId = "";
    let channelName = "";
    let username: string | undefined;
    let sessionId: string | undefined;

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        socket_id?: string;
        channel_name?: string;
        username?: string;
        session_id?: string;
      };
      socketId = body.socket_id || "";
      channelName = body.channel_name || "";
      username = body.username;
      sessionId = body.session_id;
    } else {
      const bodyText = await request.text();
      const params = new URLSearchParams(bodyText);
      socketId = params.get("socket_id") || "";
      channelName = params.get("channel_name") || "";
      username = params.get("username") || undefined;
      sessionId = params.get("session_id") || undefined;
    }

    if (!socketId || !channelName) {
      return NextResponse.json(
        { error: "Missing socket_id or channel_name" },
        { status: 400 },
      );
    }

    if (channelName !== "presence-radio") {
      return NextResponse.json({ error: "Invalid channel" }, { status: 403 });
    }

    const safeUserId = sessionId || `session-${socketId.slice(0, 8)}`;
    const auth = pusher.authorizeChannel(socketId, channelName, {
      user_id: safeUserId,
      user_info: {
        name: username || "Guest",
        sessionId: safeUserId,
      },
    });

    return NextResponse.json(auth, { status: 200 });
  } catch (error) {
    console.error("Pusher auth error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
