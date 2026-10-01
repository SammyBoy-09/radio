# Backend API Documentation

## Environment Setup

Create a `.env.local` file in the project root with the following variables (see `.env.local.example` for reference):

```env
# Pusher Configuration (get from https://dashboard.pusher.com/)
PUSHER_APP_ID=your_pusher_app_id
PUSHER_APP_KEY=your_pusher_app_key
PUSHER_APP_SECRET=your_pusher_app_secret
PUSHER_APP_CLUSTER=your_pusher_cluster
NEXT_PUBLIC_PUSHER_APP_KEY=your_pusher_app_key
NEXT_PUBLIC_PUSHER_APP_CLUSTER=your_pusher_cluster

# YouTube API (get from https://console.developers.google.com/)
YOUTUBE_API_KEY=your_youtube_api_key

# Upstash Redis (Optional for local dev, recommended for production - https://console.upstash.com)
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

## API Routes

### GET /api/room
Fetch the latest authoritative snapshot of the main live listening room from Redis.

**Response:**
```json
{
  "success": true,
  "room": {
    "code": "MAIN",
    "hostUsername": "Host",
    "hostSessionId": "",
    "createdAt": 1234567890,
    "queue": [
      {
        "id": "youtube_video_id",
        "title": "Song Title",
        "artist": "Artist Name",
        "duration": 300,
        "thumbnail": "https://...",
        "addedBy": "username"
      }
    ],
    "activeId": "youtube_video_id",
    "playing": true,
    "progress": 45,
    "lastSyncTime": 1234567890,
    "repeatMode": "off",
    "shuffle": false
  }
}
```

### POST /api/room
Update the authoritative state of the main live listening room in Redis.

**Request:**
```json
{
  "queue": [...],
  "activeId": "youtube_video_id",
  "playing": true,
  "progress": 45,
  "repeatMode": "off",
  "shuffle": false
}
```

**Response:**
```json
{
  "success": true,
  "room": { ... }
}
```

### POST /api/search
Search for songs from YouTube with 24-hour Redis caching (protects YouTube API quota).

**Request:**
```json
{
  "query": "search term"
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "youtube_video_id",
      "title": "Song Title",
      "artist": "Artist Name",
      "duration": 300,
      "thumbnail": "https://..."
    }
  ],
  "query": "search term",
  "count": 1,
  "cached": false
}
```

### POST /api/pusher/auth
Authenticate presence channel (`presence-radio`) for connected listeners.

**Request:**
```json
{
  "socket_id": "pusher_socket_id",
  "channel_name": "presence-radio",
  "username": "user_display_name",
  "session_id": "user_session_id"
}
```

**Response:**
```json
{
  "auth": "auth_key",
  "channel_data": "{...}"
}
```

## Real-Time Events (Pusher Presence Channel)

Channel: `presence-radio`

### Client Events
*Note: Make sure "Enable Client Events" is toggled ON in your Pusher App Dashboard.*

- **`client-player-action`**: Broadcasted when play, pause, seek, track change, or skip occurs.
- **`client-queue-update`**: Broadcasted when songs are added, removed, or reordered in the shared queue.
- **`client-chat-message`**: Broadcasted when a user sends a chat message.
- **`client-sync-time`**: Broadcasted every 4 seconds by the active Host to synchronize peer playback timestamps.
- **`client-vote-skip`**: Broadcasted when a user casts a vote to skip the current track.
