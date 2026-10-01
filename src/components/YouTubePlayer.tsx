"use client";

import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";

interface YouTubePlayerProps {
  videoId: string | null;
  playing: boolean;
  volume: number;
  muted: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStateChange: (time: number, duration: number) => void;
  onEnded: () => void;
  seekCommand?: {
    time: number;
    nonce: number;
  } | null;
}

export function YouTubePlayer({
  videoId,
  playing,
  volume,
  muted,
  onPlay,
  onPause,
  onStateChange,
  onEnded,
  seekCommand,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const [isApiReady, setIsApiReady] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ((window as any).YT && (window as any).YT.Player) {
      setIsApiReady(true);
      return;
    }

    const previousOnReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (previousOnReady) previousOnReady();
      setIsApiReady(true);
    };

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      tag.async = true;
      document.body.appendChild(tag);
    }
  }, []);

  // Initialize YT.Player instance once API & container are ready
  useEffect(() => {
    if (!isApiReady || !containerRef.current || playerRef.current) return;

    const YT = (window as any).YT;
    if (!YT || !YT.Player) return;

    playerRef.current = new YT.Player(containerRef.current, {
      height: "100%",
      width: "100%",
      videoId: videoId || "",
      playerVars: {
        autoplay: playing ? 1 : 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        fs: 0,
        disablekb: 1,
        playsinline: 1,
        origin: typeof window !== "undefined" ? window.location.origin : undefined,
      },
      events: {
        onReady: (event: any) => {
          setIsPlayerReady(true);
          currentVideoIdRef.current = videoId;
          try {
            event.target.setVolume(volume);
            if (muted) event.target.mute();
            else event.target.unMute();

            if (playing && videoId) {
              event.target.playVideo();
            }
          } catch {}
        },
        onStateChange: (e: any) => {
          const YTState = (window as any).YT?.PlayerState;
          if (!YTState) return;

          if (e.data === YTState.PLAYING) {
            onPlay();
          } else if (e.data === YTState.PAUSED) {
            onPause();
          } else if (e.data === YTState.ENDED) {
            onEnded();
          }
        },
        onError: (e: any) => {
          console.warn("YouTube Player event error code:", e.data);
          if (e.data === 100 || e.data === 101 || e.data === 150) {
            onEnded();
          }
        },
      },
    });

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
        setIsPlayerReady(false);
      }
    };
  }, [isApiReady]);

  // Handle track changes via loadVideoById without destroying the player
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !videoId) return;

    if (currentVideoIdRef.current !== videoId) {
      currentVideoIdRef.current = videoId;
      try {
        if (playing) {
          playerRef.current.loadVideoById(videoId, 0);
        } else {
          playerRef.current.cueVideoById(videoId, 0);
        }
      } catch (err) {
        console.error("Error loading video:", err);
      }
    }
  }, [videoId, isPlayerReady, playing]);

  // Handle play/pause changes
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    const YTState = (window as any).YT?.PlayerState;
    try {
      const state = playerRef.current.getPlayerState?.();
      if (playing && state !== YTState?.PLAYING) {
        playerRef.current.playVideo?.();
      } else if (!playing && state === YTState?.PLAYING) {
        playerRef.current.pauseVideo?.();
      }
    } catch (err) {
      console.error("Error toggling play/pause:", err);
    }
  }, [playing, isPlayerReady]);

  // Handle volume and mute
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;

    try {
      if (typeof playerRef.current.setVolume === "function") {
        playerRef.current.setVolume(volume);
      }
      if (muted) {
        playerRef.current.mute?.();
      } else {
        playerRef.current.unMute?.();
      }
    } catch (err) {
      console.error("Error setting volume/mute:", err);
    }
  }, [volume, muted, isPlayerReady]);

  // Handle seek commands
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !seekCommand) return;

    try {
      if (typeof playerRef.current.seekTo === "function") {
        playerRef.current.seekTo(Math.max(0, seekCommand.time), true);
      }
    } catch (err) {
      console.error("Error seeking player:", err);
    }
  }, [seekCommand, isPlayerReady]);

  // Report playback time
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current || !playing) return;

    const interval = setInterval(() => {
      try {
        const current = playerRef.current.getCurrentTime?.() || 0;
        const duration = playerRef.current.getDuration?.() || 0;
        if (duration > 0) {
          onStateChange(current, duration);
        }
      } catch {}
    }, 500);

    return () => clearInterval(interval);
  }, [isPlayerReady, playing, onStateChange]);

  return (
    <div className="w-full aspect-video max-h-[50vh] sm:max-h-[380px] lg:max-h-none rounded-xl overflow-hidden bg-zinc-950 relative border border-zinc-900/80 shadow-2xl">
      <div ref={containerRef} className="w-full h-full object-cover" />
      {(!isPlayerReady || !videoId) && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/95 z-10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2.5 text-zinc-500">
            <Music2 className="h-8 w-8 sm:h-10 sm:w-10 animate-pulse text-zinc-400" />
            <span className="text-xs sm:text-sm font-medium tracking-wide">
              {videoId ? "Tuning stream..." : "No track selected"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
