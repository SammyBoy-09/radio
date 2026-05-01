import { useEffect, useRef, useState } from "react";
import { Music2 } from "lucide-react";

interface YouTubePlayerProps {
  videoId: string | null;
  playing: boolean;
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
  onPlay,
  onPause,
  onStateChange,
  onEnded,
  seekCommand,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);

  // Load YouTube IFrame API
  useEffect(() => {
    if ((window as any).YT) {
      setIsReady(true);
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onload = () => {
      (window as any).onYouTubeIframeAPIReady = () => {
        setIsReady(true);
      };
    };
    document.body.appendChild(tag);

    return () => {
      tag.remove();
    };
  }, []);

  // Create YouTube player
  useEffect(() => {
    if (!isReady || !containerRef.current || !videoId) return;

    const YT = (window as any).YT;
    if (!YT) return;

    // Clear container
    containerRef.current.innerHTML = "";

    playerRef.current = new YT.Player(containerRef.current, {
      height: "100%",
      width: "100%",
      videoId,
      playerVars: {
        autoplay: 0,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        showinfo: 0,
        fs: 0,
      },
      events: {
        onReady: (event: any) => {
          playerRef.current = event.target;
          if (playing && typeof event.target.playVideo === "function") {
            event.target.playVideo();
          }
        },
        onStateChange: (e: any) => {
          const YT = (window as any).YT;
          if (e.data === YT.PlayerState.PLAYING) {
            onPlay();
          } else if (e.data === YT.PlayerState.PAUSED) {
            onPause();
          } else if (e.data === YT.PlayerState.ENDED) {
            onEnded();
          }
        },
      },
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  }, [isReady, videoId, onPlay, onPause, onEnded]);

  // Handle play/pause state changes
  useEffect(() => {
    if (!playerRef.current || !isReady) return;

    const YT = (window as any).YT;
    try {
      if (
        playing &&
        playerRef.current.getPlayerState?.() !== YT?.PlayerState?.PLAYING &&
        typeof playerRef.current.playVideo === "function"
      ) {
        playerRef.current.playVideo();
      } else if (
        !playing &&
        playerRef.current.getPlayerState?.() === YT?.PlayerState?.PLAYING &&
        typeof playerRef.current.pauseVideo === "function"
      ) {
        playerRef.current.pauseVideo();
      }
    } catch (e) {
      console.error("Error controlling player:", e);
    }
  }, [playing, isReady]);

  useEffect(() => {
    if (!playerRef.current || !isReady || !seekCommand) return;

    try {
      if (typeof playerRef.current.seekTo === "function") {
        playerRef.current.seekTo(Math.max(0, seekCommand.time), true);
      }
    } catch (e) {
      console.error("Error seeking player:", e);
    }
  }, [isReady, seekCommand]);

  // Periodically update playback time
  useEffect(() => {
    if (!playerRef.current || !isReady || !playing) return;

    const interval = setInterval(() => {
      try {
        const current = playerRef.current.getCurrentTime?.() || 0;
        const duration = playerRef.current.getDuration?.() || 0;
        onStateChange(current, duration);
      } catch (e) {
        // Player may not be ready yet
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isReady, playing, onStateChange]);

  return (
    <div ref={containerRef} className="w-full h-full aspect-video rounded-xl overflow-hidden bg-zinc-950">
      {!isReady && (
        <div className="w-full h-full flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center gap-2 text-zinc-600">
            <Music2 className="h-8 w-8 animate-pulse" />
            <span className="text-xs">Loading player...</span>
          </div>
        </div>
      )}
    </div>
  );
}
