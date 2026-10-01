# Obsidian Radio — Listen Together, In Sync

A synchronized music-listening platform where users can join a live virtual broadcast room, search for YouTube videos, add them to a shared queue, chat, and watch/listen in perfect sync.

## Architecture

- **Framework:** Next.js 16 (App Router) with React 19 & TypeScript
- **Styling:** Tailwind CSS v4 (pure black aesthetic) & Radix UI
- **Real-time Communication:** Pusher Channels (`presence-radio`)
- **State Persistence & Caching:** Upstash Redis (with seamless local in-memory fallback)
- **Media Player:** YouTube IFrame Player API (`YT.Player`)
- **Search API:** YouTube Data API v3 (`/api/search` with 24h Redis caching)
- **Mobile Integration:** Media Session API (Lock Screen controls & artwork), Screen Wake Lock API, and PWA Manifest

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file in this directory based on `.env.local.example`:

```env
# Pusher Server-side Configuration (https://dashboard.pusher.com/)
PUSHER_APP_ID=your_pusher_app_id
PUSHER_APP_KEY=your_pusher_app_key
PUSHER_APP_SECRET=your_pusher_app_secret
PUSHER_APP_CLUSTER=your_pusher_cluster

# Pusher Client-side Configuration
NEXT_PUBLIC_PUSHER_APP_KEY=your_pusher_app_key
NEXT_PUBLIC_PUSHER_APP_CLUSTER=your_pusher_cluster

# YouTube Data API v3 Key (https://console.developers.google.com/)
YOUTUBE_API_KEY=your_youtube_api_key

# Upstash Redis (Optional for local dev, recommended for production - https://console.upstash.com)
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production Build

```bash
npm run build
npm start
```

## Features

1. **Live Synchronized Room** — Single-room shared broadcast where all listeners hear the exact same track at the same time.
2. **Persistent Queue & Late-Joiner Sync** — Instant room state recovery from Redis on page load.
3. **YouTube Search with Caching** — Debounced search proxy with 24-hour Redis caching to protect YouTube API quotas.
4. **Resilient Playback Sync** — Designated host publishes heartbeat timestamps; clients snap automatically if drift exceeds threshold.
5. **Real-Time Group Chat & Voting** — Live chat and skip voting broadcasted across all connected listeners.
6. **Mobile Lock Screen & Audio Controls** — MediaSession integration shows artwork and playback controls on your mobile lock screen.
7. **Screen Wake Lock Toggle** — Keep your device awake during listening sessions.

## Deploy on Vercel

1. Push this repository to GitHub.
2. Import the repo into Vercel as a new project.
3. Keep the default Next.js framework settings.
4. Add the environment variables above in Vercel for Preview and Production.
5. In your Pusher dashboard, ensure **"Enable client events"** is toggled ON under App Settings.
6. Deploy!
