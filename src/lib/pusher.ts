import Pusher from "pusher-js";

let pusherClient: Pusher | null = null;

export function getPusherClient(): Pusher {
  if (pusherClient) return pusherClient;

  const key = process.env.NEXT_PUBLIC_PUSHER_APP_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_APP_CLUSTER;

  if (!key || !cluster) {
    throw new Error("Missing NEXT_PUBLIC_PUSHER_APP_KEY or NEXT_PUBLIC_PUSHER_APP_CLUSTER");
  }

  pusherClient = new Pusher(key, {
    cluster,
    authEndpoint: "/api/pusher/auth",
    forceTLS: true,
  });

  return pusherClient;
}

export function closePusherClient() {
  if (!pusherClient) return;
  pusherClient.disconnect();
  pusherClient = null;
}
