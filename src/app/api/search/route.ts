import { NextRequest, NextResponse } from "next/server";

type Song = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
};

function parseIsoDuration(duration: string): number {
  const match = duration.match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
  );

  if (!match) return 0;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body as { query: string };

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY is not configured" },
        { status: 503 },
      );
    }

    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${encodeURIComponent(query)}&key=${apiKey}`,
      { cache: "no-store" },
    );

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error("YouTube search error:", errorText);
      return NextResponse.json(
        { error: "YouTube search failed" },
        { status: 502 },
      );
    }

    const searchData = (await searchResponse.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          channelTitle?: string;
          thumbnails?: {
            default?: { url?: string };
            medium?: { url?: string };
            high?: { url?: string };
          };
        };
      }>;
    };

    const videoIds = (searchData.items || [])
      .map((item) => item.id?.videoId)
      .filter((value): value is string => Boolean(value));

    if (!videoIds.length) {
      return NextResponse.json({ results: [], query, count: 0 }, { status: 200 });
    }

    const detailsResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(",")}&key=${apiKey}`,
      { cache: "no-store" },
    );

    if (!detailsResponse.ok) {
      const errorText = await detailsResponse.text();
      console.error("YouTube details error:", errorText);
      return NextResponse.json(
        { error: "YouTube details lookup failed" },
        { status: 502 },
      );
    }

    const detailsData = (await detailsResponse.json()) as {
      items?: Array<{
        id?: string;
        contentDetails?: {
          duration?: string;
        };
      }>;
    };

    const durationById = new Map(
      (detailsData.items || []).map((item) => [
        item.id || "",
        parseIsoDuration(item.contentDetails?.duration || "PT0S"),
      ]),
    );

    const results = (searchData.items || [])
      .map((item) => {
        const id = item.id?.videoId || "";
        const title = item.snippet?.title?.trim() || "Untitled video";
        const artist = item.snippet?.channelTitle?.trim() || "YouTube";
        const thumbnail =
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "";

        return {
          id,
          title,
          artist,
          duration: durationById.get(id) || 0,
          thumbnail,
        } satisfies Song;
      })
      .filter((song) => song.id);

    return NextResponse.json(
      {
        results,
        query,
        count: results.length,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
