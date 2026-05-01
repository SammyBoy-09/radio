# Backend API Documentation

## Environment Setup

Create a `.env.local` file in the project root with the following variables (see `.env.local.example` for reference):

```env
# Pusher Configuration (get from https://dashboard.pusher.com/)
PUSHER_APP_ID=your_pusher_app_id
PUSHER_APP_KEY=your_pusher_app_key
PUSHER_APP_SECRET=your_pusher_app_secret
NEXT_PUBLIC_PUSHER_APP_KEY=your_pusher_app_key
NEXT_PUBLIC_PUSHER_APP_CLUSTER=your_pusher_cluster

# YouTube API (get from https://console.developers.google.com/)
YOUTUBE_API_KEY=your_youtube_api_key
```

## API Routes

### POST /api/search
Search for songs from YouTube.

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
      "duration": 300
    }
  ],
  "query": "search term",
  "count": 1
}
```

**Status:** 200 (success), 400 (bad request), 500 (error)

### POST /api/pusher/auth
Authenticate private Pusher channels for a user.

**Request:**
```json
{
  "socket_id": "pusher_socket_id",
  "channel_name": "private-room-code",
  "username": "user_display_name"
}
```

**Response:**
```json
{
  "auth": "auth_key",
  "user_data": {...}
}
```

**Status:** 200 (success), 400 (bad request), 403 (forbidden), 500 (error)

### POST /api/rooms/create
Create a new listening room.

**Request:**
```json
{
  "username": "host_name"
}
```

**Response:**
```json
{
  "code": "X7A9",
  "hostUsername": "host_name",
  "createdAt": 1234567890,
  "memberCount": 1
}
```

**Status:** 201 (created), 400 (bad request), 500 (error)

### POST /api/rooms/join
Join an existing listening room.

**Request:**
```json
{
  "code": "X7A9",
  "username": "user_name"
}
```

**Response:**
```json
{
  "code": "X7A9",
  "hostUsername": "host_name",
  "createdAt": 1234567890,
  "memberCount": 2,
  "members": ["host_name", "user_name"]
}
```

**Status:** 200 (success), 400 (bad request), 404 (not found), 500 (error)

## Real-Time Events (Pusher)

### Subscribe to Private Channel

Client subscribes to `private-room-{code}` where `{code}` is the room code.

### Broadcast Events

#### `client-player-action`
Sent by client when player state changes (play, pause, seek, skip).

```typescript
{
  action: "play" | "pause" | "seek" | "next" | "prev",
  user: "username",
  progress?: number  // for seek actions
}
```

#### `client-chat-message`
Sent by client when sending a message.

```typescript
{
  user: "username",
  text: "message content"
}
```

#### `client-sync-time`
Sent by host every 5 seconds with current playback time.

```typescript
{
  time: 120,    // current playback time in seconds
  user: "host_username"
}
```

### Server Events

#### `player-action`
Received by all clients when a remote user controls playback.

```typescript
{
  action: "play" | "pause" | "seek" | "next" | "prev",
  user: "username",
  progress?: number
}
```

#### `chat-message`
Received by all clients when a message is sent.

```typescript
{
  user: "username",
  text: "message content"
}
```

#### `queue-updated`
Received by all clients when queue changes.

```typescript
{
  queue: [...],
  activeId: "song_id",
  user: "username"
}
```

#### `sync-time`
Received by non-host clients from host's time sync signal.

```typescript
{
  time: 120,
  user: "host_username"
}
```

## Implementation Details

### Time Synchronization
- Host broadcasts current playback time via `client-sync-time` every 5 seconds
- Non-host clients listen for `sync-time` events
- If drift > 2 seconds, client snaps to host's time
- This ensures all listeners stay in sync with the host

### Debounced Search
- Search input debounces with 300ms delay to reduce API calls
- After user stops typing, single request is made to `/api/search`
- Results are displayed incrementally as they arrive

### YouTube Integration
- Song IDs are mapped to YouTube video IDs via `videoIdMap` in YouTubePlayer.tsx
- YouTube IFrame API is loaded dynamically on client
- Player state changes (play/pause/end) trigger Pusher events
- Comments and related videos are disabled for clean UI

### Room Management
- Rooms are created with unique 5-character codes
- Room creator is designated as "Host" (can control playback globally)
- Joiners must provide valid room code and username
- In-memory storage for demo (use database for production)

## Next Steps

1. **Database Integration**: Replace in-memory room storage with a database (PostgreSQL/MongoDB)
2. **YouTube API**: Replace mock search with actual YouTube Data API v3 calls
3. **Deployment**: Deploy to Vercel (recommended for Next.js) or other platform
4. **Authentication**: Add user authentication and session management
5. **Permissions**: Implement role-based access (queue management, skip voting)
6. **Persistence**: Save playlists and room history to database
