# Vercel Deployment Guide

This app is a Next.js App Router project and is ready for Vercel hosting.

## Prerequisites

1. A GitHub repository for the app.
2. A Vercel account.
3. Pusher credentials from the Pusher dashboard.
4. A YouTube Data API v3 key from Google Cloud Console.

## Environment Variables

Set these in Vercel under Project Settings > Environment Variables, and also place the same values in `.env.local` for local development.

```env
PUSHER_APP_ID=your_pusher_app_id
PUSHER_APP_KEY=your_pusher_app_key
PUSHER_APP_SECRET=your_pusher_app_secret
PUSHER_APP_CLUSTER=your_pusher_cluster
NEXT_PUBLIC_PUSHER_APP_KEY=your_pusher_app_key
NEXT_PUBLIC_PUSHER_APP_CLUSTER=your_pusher_cluster
YOUTUBE_API_KEY=your_youtube_api_key
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` from `.env.local.example` and fill in the values.

3. Run the app locally:

```bash
npm run dev
```

4. Build it locally before deploying:

```bash
npm run build
```

## Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel, choose Add New Project and import `SammyBoy-09/radio`.
3. Keep the default Next.js framework detection.
4. Add the environment variables above in both Preview and Production.
5. Deploy.

## After Deployment

1. Open the live site and verify search, playback, and room sync.
2. If search returns no results, confirm `YOUTUBE_API_KEY` is valid and YouTube Data API v3 is enabled.
3. If realtime sync fails, confirm the Pusher keys and cluster match across client and server variables.