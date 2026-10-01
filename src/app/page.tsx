"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import debounce from "lodash.debounce";
import {
  Play,
  Pause,
  SkipForward,
  Search,
  Plus,
  X,
  Radio,
  Users,
  Music2,
  Volume2,
  VolumeX,
  Repeat,
  Repeat1,
  Shuffle,
  GripVertical,
  SkipForward as Forward,
  MessageSquare,
  ListMusic,
  SendHorizontal,
  Sparkles,
  Loader2,
  Crown,
  Sun,
  SunMedium,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getPusherClient, setPusherAuthParams } from "@/lib/pusher";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { Song, RoomState } from "@/lib/redis";

type ChatMsg = {
  id: string;
  user: string;
  text: string;
  ts: number;
  system?: boolean;
};

const RADIO_CHANNEL = "presence-radio";

type RoomChannel = {
  bind: (event: string, callback: (payload: unknown) => void) => void;
  unbind: (event: string, callback?: (payload: unknown) => void) => void;
  trigger: (event: string, payload: Record<string, unknown>) => void;
};

type PresenceMember = {
  id: string;
  info?: {
    name?: string;
    sessionId?: string;
  };
};

type PresenceMembers = {
  each: (callback: (member: PresenceMember) => void) => void;
  members: Record<string, { name?: string; sessionId?: string }>;
};

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "obsidian-radio-session-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem(key, next);
  return next;
}

function avatarColor(name: string): string {
  const palette = ["#f5f5f5", "#a1a1aa", "#71717a", "#fafafa", "#d4d4d8", "#e4e4e7"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState("");
  const [sessionId] = useState(() => (typeof window === "undefined" ? "" : getOrCreateSessionId()));

  // Playback & Queue State
  const [playing, setPlaying] = useState(false);
  const [queue, setQueue] = useState<Song[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [shuffle, setShuffle] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [keepAwake, setKeepAwake] = useState(false);

  // Search State
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Song[]>([]);

  // Presence & Voting
  const [listeners, setListeners] = useState<Array<{ id: string; name: string }>>([]);
  const [skipVotes, setSkipVotes] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  // Chat State
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Mobile Tabs
  const [mobileTab, setMobileTab] = useState<"queue" | "search" | "chat">("queue");

  // Player & Sync Control
  const [seekCommand, setSeekCommand] = useState<{ time: number; nonce: number } | null>(null);
  const channelRef = useRef<RoomChannel | null>(null);
  const wakeLockRef = useRef<any>(null);

  // Refs for access inside real-time callbacks without stale closures
  const progressRef = useRef(0);
  const queueRef = useRef<Song[]>([]);
  const activeIdRef = useRef("");
  const playingRef = useRef(false);
  const repeatModeRef = useRef<"off" | "all" | "one">("off");
  const shuffleRef = useRef(false);
  const sessionIdRef = useRef("");
  const listenersRef = useRef<Array<{ id: string; name: string }>>([]);
  const isHostRef = useRef(false);

  // Determine host: The first listener in presence order is the designated Host
  const isHost = useMemo(() => {
    if (!listeners.length) return true;
    return listeners[0]?.id === sessionId;
  }, [listeners, sessionId]);

  const totalListeners = Math.max(1, listeners.length);
  const votesNeeded = Math.max(1, Math.ceil(totalListeners / 2));

  // Sync refs with state
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);
  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    listenersRef.current = listeners;
  }, [listeners]);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  // Active track and Up Next track
  const activeSong = queue.find((s) => s.id === activeId);
  const upNext = useMemo(() => {
    if (!queue.length || !activeSong) return null;
    const idx = queue.findIndex((s) => s.id === activeId);
    return queue[(idx + 1) % queue.length] ?? null;
  }, [queue, activeId, activeSong]);

  // Sync room state to Redis in the background
  const syncToRedis = useCallback(
    async (partial: Partial<RoomState>) => {
      try {
        await fetch("/api/room", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
      } catch (err) {
        console.warn("Failed to sync room state to backend:", err);
      }
    },
    [],
  );

  // Switch Track helper
  const switchTrack = useCallback(
    (nextId: string, shouldBroadcast = true) => {
      setActiveId(nextId);
      setProgress(0);
      setSkipVotes(new Set());

      if (shouldBroadcast && channelRef.current) {
        channelRef.current.trigger("client-player-action", {
          action: "track-changed",
          activeId: nextId,
          user: username || "Guest",
          sessionId,
        });
      }

      syncToRedis({ activeId: nextId, progress: 0 });
    },
    [sessionId, syncToRedis, username],
  );

  // Pick Next Track based on shuffle and repeat settings
  const pickNextId = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return "";

    if (shuffleRef.current) {
      const others = q.filter((s) => s.id !== activeIdRef.current);
      if (!others.length) return activeIdRef.current;
      return others[Math.floor(Math.random() * others.length)].id;
    }

    const idx = q.findIndex((s) => s.id === activeIdRef.current);
    if (idx === -1) return q[0].id;
    if (idx + 1 >= q.length) {
      return repeatModeRef.current === "all" ? q[0].id : q[q.length - 1].id;
    }
    return q[idx + 1].id;
  }, []);

  const skipNext = useCallback(
    (shouldBroadcast = true) => {
      const nextId = pickNextId();
      if (nextId) {
        switchTrack(nextId, false);
        if (shouldBroadcast && channelRef.current) {
          channelRef.current.trigger("client-player-action", {
            action: "next",
            activeId: nextId,
            user: username || "Guest",
            sessionId,
          });
        }
      }
    },
    [pickNextId, sessionId, switchTrack, username],
  );

  const skipPrev = useCallback(
    (shouldBroadcast = true) => {
      if (progressRef.current > 3) {
        setProgress(0);
        setSeekCommand({ time: 0, nonce: Date.now() });
        if (shouldBroadcast && channelRef.current) {
          channelRef.current.trigger("client-player-action", {
            action: "seek",
            progress: 0,
            user: username || "Guest",
            sessionId,
          });
        }
        return;
      }

      const q = queueRef.current;
      if (!q.length) return;
      const idx = q.findIndex((s) => s.id === activeIdRef.current);
      const prev = q[(idx - 1 + q.length) % q.length];
      if (prev) {
        switchTrack(prev.id, false);
        if (shouldBroadcast && channelRef.current) {
          channelRef.current.trigger("client-player-action", {
            action: "prev",
            activeId: prev.id,
            user: username || "Guest",
            sessionId,
          });
        }
      }
    },
    [sessionId, switchTrack, username],
  );

  // Play / Pause Handlers
  const handleTogglePlay = useCallback(
    (newPlayingState: boolean) => {
      setPlaying(newPlayingState);
      channelRef.current?.trigger("client-player-action", {
        action: newPlayingState ? "play" : "pause",
        user: username,
        sessionId,
      });
      syncToRedis({ playing: newPlayingState });
    },
    [sessionId, syncToRedis, username],
  );

  // Seeking Handlers
  const handleSeekCommit = useCallback(
    (time: number) => {
      setProgress(time);
      setSeekCommand({ time, nonce: Date.now() });
      channelRef.current?.trigger("client-player-action", {
        action: "seek",
        progress: time,
        user: username,
        sessionId,
      });
      syncToRedis({ progress: time });
    },
    [sessionId, syncToRedis, username],
  );

  // 1. Media Session API for Lock Screen Controls & Artwork
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    if (activeSong) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeSong.title,
        artist: activeSong.artist,
        album: "Obsidian Radio",
        artwork: activeSong.thumbnail
          ? [
              { src: activeSong.thumbnail, sizes: "96x96", type: "image/jpeg" },
              { src: activeSong.thumbnail, sizes: "128x128", type: "image/jpeg" },
              { src: activeSong.thumbnail, sizes: "192x192", type: "image/jpeg" },
              { src: activeSong.thumbnail, sizes: "256x256", type: "image/jpeg" },
              { src: activeSong.thumbnail, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    }

    navigator.mediaSession.playbackState = playing ? "playing" : "paused";

    try {
      navigator.mediaSession.setActionHandler("play", () => handleTogglePlay(true));
      navigator.mediaSession.setActionHandler("pause", () => handleTogglePlay(false));
      navigator.mediaSession.setActionHandler("nexttrack", () => skipNext(true));
      navigator.mediaSession.setActionHandler("previoustrack", () => skipPrev(true));
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime != null) {
          handleSeekCommit(details.seekTime);
        }
      });
    } catch (e) {
      console.warn("MediaSession action handler error:", e);
    }
  }, [activeSong, playing, handleTogglePlay, skipNext, skipPrev, handleSeekCommit]);

  // 2. Screen Wake Lock API (Keep Screen Awake Mode)
  useEffect(() => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) return;

    async function requestWakeLock() {
      if (keepAwake && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
          wakeLockRef.current.addEventListener("release", () => {
            wakeLockRef.current = null;
          });
        } catch (err: any) {
          console.warn("Wake Lock request error:", err.message);
        }
      } else if (!keepAwake && wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch {}
      }
    }

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && keepAwake) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [keepAwake]);

  // Fetch initial snapshot from Redis on load
  useEffect(() => {
    async function loadInitialRoomState() {
      try {
        const res = await fetch("/api/room");
        if (!res.ok) return;
        const data = await res.json();
        if (data.room) {
          const room: RoomState = data.room;
          if (room.queue && room.queue.length > 0) {
            setQueue(room.queue);
            setActiveId(room.activeId || room.queue[0].id);
            setPlaying(room.playing);
            setRepeatMode(room.repeatMode || "off");
            setShuffle(room.shuffle || false);
          }
        }
      } catch (err) {
        console.error("Failed to load initial room state:", err);
      }
    }
    loadInitialRoomState();
  }, []);

  // Pusher Realtime Synchronization Setup
  useEffect(() => {
    if (!joined || !username || !sessionId) return;

    setPusherAuthParams({ username, session_id: sessionId });

    let pusherInstance: ReturnType<typeof getPusherClient>;
    try {
      pusherInstance = getPusherClient();
    } catch (err) {
      console.warn("Pusher client failed to initialize:", err);
      return;
    }

    const channel = pusherInstance.subscribe(RADIO_CHANNEL) as unknown as RoomChannel;
    channelRef.current = channel;

    // Presence Listeners Management
    channel.bind("pusher:subscription_succeeded", (payload: unknown) => {
      const members = payload as PresenceMembers;
      const list: Array<{ id: string; name: string }> = [];
      members.each((member) => {
        list.push({
          id: member.id,
          name: member.info?.name || "Guest",
        });
      });
      setListeners(list);
    });

    channel.bind("pusher:member_added", (payload: unknown) => {
      const member = payload as PresenceMember;
      setListeners((curr) => {
        if (curr.some((e) => e.id === member.id)) return curr;
        return [...curr, { id: member.id, name: member.info?.name || "Guest" }];
      });
    });

    channel.bind("pusher:member_removed", (payload: unknown) => {
      const member = payload as PresenceMember;
      setListeners((curr) => curr.filter((e) => e.id !== member.id));
      setSkipVotes((votes) => {
        const next = new Set(votes);
        next.delete(member.info?.name || "");
        return next;
      });
    });

    // Handle incoming player actions
    channel.bind("client-player-action", (payload: unknown) => {
      const data = payload as {
        action: "play" | "pause" | "seek" | "next" | "prev" | "track-changed";
        user?: string;
        sessionId?: string;
        progress?: number;
        activeId?: string;
      };

      if (data.sessionId === sessionIdRef.current) return;

      if (data.action === "play") {
        setPlaying(true);
      } else if (data.action === "pause") {
        setPlaying(false);
      } else if (data.action === "seek") {
        const target = data.progress ?? 0;
        setProgress(target);
        setSeekCommand({ time: target, nonce: Date.now() });
      } else if (data.action === "next" || data.action === "prev" || data.action === "track-changed") {
        if (data.activeId) {
          setActiveId(data.activeId);
          setProgress(0);
          setSkipVotes(new Set());
        }
      }
    });

    // Handle incoming queue updates
    channel.bind("client-queue-update", (payload: unknown) => {
      const data = payload as {
        queue: Song[];
        activeId?: string;
        user?: string;
        sessionId?: string;
      };

      if (data.sessionId === sessionIdRef.current) return;

      setQueue(data.queue || []);
      if (data.activeId) {
        setActiveId(data.activeId);
      }
    });

    // Handle incoming chat messages
    channel.bind("client-chat-message", (payload: unknown) => {
      const data = payload as {
        user?: string;
        text?: string;
        sessionId?: string;
      };

      if (data.sessionId === sessionIdRef.current) return;

      setMessages((m) => [
        ...m,
        {
          id: `m${Date.now()}-${Math.random()}`,
          user: data.user || "Guest",
          text: data.text || "",
          ts: Date.now(),
        },
      ]);
    });

    // Handle host heartbeat time sync
    channel.bind("client-sync-time", (payload: unknown) => {
      const data = payload as {
        time?: number;
        user?: string;
        sessionId?: string;
      };

      if (isHostRef.current || data.sessionId === sessionIdRef.current) return;

      const hostTime = data.time ?? 0;
      const drift = Math.abs(hostTime - progressRef.current);

      if (drift > 2.5) {
        setProgress(hostTime);
        setSeekCommand({ time: hostTime, nonce: Date.now() });
      }
    });

    // Handle vote skip from peers
    channel.bind("client-vote-skip", (payload: unknown) => {
      const data = payload as {
        user?: string;
        sessionId?: string;
      };

      if (data.user) {
        setSkipVotes((prev) => {
          const next = new Set(prev);
          next.add(data.user!);
          return next;
        });
      }
    });

    return () => {
      pusherInstance.unsubscribe(RADIO_CHANNEL);
      channelRef.current = null;
    };
  }, [joined, username, sessionId]);

  // Host Heartbeat
  useEffect(() => {
    if (!joined || !isHost || !channelRef.current) return;

    const interval = setInterval(() => {
      if (playingRef.current) {
        channelRef.current?.trigger("client-sync-time", {
          time: progressRef.current,
          user: username,
          sessionId,
        });
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [joined, isHost, username, sessionId]);

  // Auto-scroll chat
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Queue Operations
  const addToQueue = (song: Song) => {
    setQueue((curr) => {
      if (curr.some((s) => s.id === song.id)) {
        toast("Already in queue", { description: song.title });
        return curr;
      }
      const nextQueue = [...curr, { ...song, addedBy: username || "Guest" }];
      const nextActiveId = curr.length === 0 ? song.id : activeId;

      if (curr.length === 0) {
        setActiveId(song.id);
        setPlaying(true);
      }

      channelRef.current?.trigger("client-queue-update", {
        queue: nextQueue,
        activeId: nextActiveId,
        user: username,
        sessionId,
      });

      syncToRedis({ queue: nextQueue, activeId: nextActiveId, playing: true });
      return nextQueue;
    });

    toast.success("Added to queue", { description: `${song.title} - ${song.artist}` });
  };

  const removeFromQueue = (id: string) => {
    setQueue((curr) => {
      const idx = curr.findIndex((s) => s.id === id);
      if (idx === -1) return curr;

      const nextQueue = curr.filter((s) => s.id !== id);
      let nextActiveId = activeId;

      if (id === activeId) {
        const fallback = nextQueue[idx] ?? nextQueue[idx - 1] ?? nextQueue[0];
        nextActiveId = fallback ? fallback.id : "";
        setActiveId(nextActiveId);
        setProgress(0);
      }

      channelRef.current?.trigger("client-queue-update", {
        queue: nextQueue,
        activeId: nextActiveId,
        user: username,
        sessionId,
      });

      syncToRedis({ queue: nextQueue, activeId: nextActiveId });
      return nextQueue;
    });
  };

  // Vote Skip Handler
  const handleVoteSkip = () => {
    const voter = username || "Guest";
    if (skipVotes.has(voter)) {
      toast("You already voted to skip");
      return;
    }

    const nextVotes = new Set(skipVotes);
    nextVotes.add(voter);
    setSkipVotes(nextVotes);

    channelRef.current?.trigger("client-vote-skip", {
      user: voter,
      sessionId,
    });

    if (nextVotes.size >= votesNeeded) {
      toast.success("Skip vote passed!", { description: "Skipping to next track" });
      skipNext(true);
    } else {
      toast(`Vote recorded (${nextVotes.size}/${votesNeeded})`);
    }
  };

  const cycleRepeat = () => {
    setRepeatMode((m) => {
      const next = m === "off" ? "all" : m === "all" ? "one" : "off";
      toast(`Repeat: ${next}`);
      syncToRedis({ repeatMode: next });
      return next;
    });
  };

  const toggleShuffle = () => {
    setShuffle((s) => {
      const next = !s;
      syncToRedis({ shuffle: next });
      return next;
    });
  };

  const toggleKeepAwake = () => {
    setKeepAwake((curr) => {
      const next = !curr;
      toast(next ? "Screen will stay awake" : "Normal screen timeout restored");
      return next;
    });
  };

  // Drag and drop reordering
  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (e: React.DragEvent, overId: string) => {
    e.preventDefault();
    if (!dragId || dragId === overId) return;

    setQueue((q) => {
      const from = q.findIndex((s) => s.id === dragId);
      const to = q.findIndex((s) => s.id === overId);
      if (from === -1 || to === -1) return q;

      const next = [...q];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      channelRef.current?.trigger("client-queue-update", {
        queue: next,
        activeId,
        user: username,
        sessionId,
      });

      syncToRedis({ queue: next });
      return next;
    });
  };
  const onDragEnd = () => setDragId(null);

  // Debounced search
  const debouncedSearch = useMemo(
    () =>
      debounce(async (q: string) => {
        if (!q.trim()) {
          setResults([]);
          setSearching(false);
          return;
        }

        try {
          setSearching(true);
          const response = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q }),
          });

          if (!response.ok) throw new Error("Search failed");
          const data = await response.json();
          setResults(data.results || []);
        } catch (error) {
          console.error("Search error:", error);
          setResults([]);
        } finally {
          setSearching(false);
        }
      }, 300),
    [],
  );

  useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);
  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  // Chat message send
  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;

    const newMessage: ChatMsg = {
      id: `m${Date.now()}`,
      user: username || "Guest",
      text,
      ts: Date.now(),
    };

    setMessages((m) => [...m, newMessage]);

    channelRef.current?.trigger("client-chat-message", {
      user: username || "Guest",
      text,
      sessionId,
    });

    setChatInput("");
  };

  // Player Callbacks
  const handlePlayerPlay = useCallback(() => setPlaying(true), []);
  const handlePlayerPause = useCallback(() => setPlaying(false), []);
  const handlePlayerStateChange = useCallback((currentTime: number, songDuration: number) => {
    setProgress(Math.floor(currentTime));
    if (songDuration > 0) setDuration(Math.floor(songDuration));
  }, []);
  const handlePlayerEnded = useCallback(() => {
    if (repeatModeRef.current === "one") {
      setSeekCommand({ time: 0, nonce: Date.now() });
      setPlaying(true);
      return;
    }
    skipNext(true);
  }, [skipNext]);

  // Render Join Screen if not yet joined
  if (!joined) {
    return (
      <JoinScreen
        username={username}
        setUsername={setUsername}
        onJoin={() => {
          setJoined(true);
          setTimeout(() => {
            toast.success(`Welcome, ${username || "Guest"}`, {
              description: "You tuned in to Obsidian Live Radio",
            });
          }, 100);
        }}
      />
    );
  }

  const searchPanel = (
    <SearchPanel
      query={query}
      setQuery={setQuery}
      searching={searching}
      results={results}
      queue={queue}
      onAdd={addToQueue}
      onRemove={removeFromQueue}
    />
  );

  const chatPanel = (
    <ChatPanel
      messages={messages}
      chatInput={chatInput}
      setChatInput={setChatInput}
      onSend={sendMessage}
      scrollRef={chatScrollRef}
      me={username || "Guest"}
    />
  );

  const queuePanel = (
    <QueueList
      queue={queue}
      activeId={activeId}
      dragId={dragId}
      onSelect={(id) => switchTrack(id, true)}
      onRemove={removeFromQueue}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    />
  );

  return (
    <div className="min-h-dvh w-full flex flex-col bg-black text-white selection:bg-white selection:text-black">
      {/* Responsive Top Header */}
      <header className="h-14 sm:h-16 shrink-0 border-b border-zinc-900 flex items-center justify-between px-3.5 sm:px-6 gap-2 sticky top-0 z-30 bg-black/95 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-white/5 border border-zinc-800 flex items-center justify-center shrink-0 shadow-inner">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight truncate">Obsidian Radio</span>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400 font-mono tracking-widest">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>LIVE STREAM</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Badge
            variant="outline"
            className="border-zinc-800 bg-zinc-900/80 text-zinc-300 gap-1.5 font-normal text-xs px-2.5 py-1"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse sm:hidden" />
            <Users className="h-3 w-3" />
            <span>{totalListeners}</span>
            <span className="hidden sm:inline">{totalListeners === 1 ? "listener" : "listeners"}</span>
          </Badge>

          <div className="flex items-center gap-1.5 sm:gap-2 sm:pl-3 sm:border-l border-zinc-800">
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-black relative shadow"
              style={{ backgroundColor: avatarColor(username || "Guest") }}
            >
              {(username.trim()[0] || "G").toUpperCase()}
              {isHost && (
                <Crown className="h-3 w-3 text-amber-400 absolute -top-1 -right-1 drop-shadow" />
              )}
            </div>
            <span className="text-xs text-zinc-300 font-medium hidden md:inline max-w-[120px] truncate">
              {username || "Guest"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Responsive Grid Layout */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left Column (Desktop 60% / Mobile Top Full Width) */}
        <main className="w-full lg:w-3/5 p-3 sm:p-5 lg:p-6 flex flex-col gap-4 lg:border-r border-zinc-900 lg:overflow-y-auto shrink-0 lg:shrink">
          <div className="rounded-2xl border border-zinc-900 bg-zinc-950/95 shadow-[0_12px_48px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col">
            {/* Player Metadata & Controls */}
            <div className="p-3.5 sm:p-5 border-b border-zinc-900 space-y-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="h-13 w-13 sm:h-16 sm:w-16 rounded-xl overflow-hidden border border-zinc-800 bg-black shrink-0 flex items-center justify-center shadow">
                  {activeSong?.thumbnail ? (
                    <img
                      src={activeSong.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Music2 className="h-6 w-6 text-zinc-700" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-0.5">
                    {playing ? "Now Streaming" : "Paused"}
                  </div>
                  <div className="text-sm sm:text-base md:text-lg font-medium truncate">
                    {activeSong?.title ?? "Nothing queued"}
                  </div>
                  <div className="text-xs sm:text-sm text-zinc-400 truncate">
                    {activeSong?.artist ?? "Search YouTube to add tracks to the room"}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={toggleKeepAwake}
                    className={`h-9 w-9 sm:h-10 sm:w-10 rounded-full border border-zinc-800 flex items-center justify-center transition ${
                      keepAwake
                        ? "text-amber-400 bg-amber-400/10 border-amber-400/30 shadow-[0_0_12px_rgba(251,191,36,0.2)]"
                        : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                    }`}
                    title={keepAwake ? "Keep Screen Awake: ON" : "Keep Screen Awake: OFF"}
                  >
                    {keepAwake ? <Sun className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
                  </button>

                  <button
                    onClick={cycleRepeat}
                    className="h-9 w-9 sm:h-10 sm:w-10 rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-white/5 flex items-center justify-center transition"
                    title={`Repeat: ${repeatMode}`}
                  >
                    {repeatMode === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Progress Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-mono">
                  <span>{fmt(progress)}</span>
                  <span>{fmt(duration || activeSong?.duration || 0)}</span>
                </div>
                <Slider
                  value={[Math.min(progress, duration || activeSong?.duration || 1)]}
                  max={Math.max(duration || activeSong?.duration || 1, 1)}
                  step={1}
                  onValueChange={(v) => setProgress(v[0] ?? 0)}
                  onValueCommit={(v) => handleSeekCommit(v[0] ?? 0)}
                  disabled={!activeSong}
                />
              </div>

              {/* Playback Buttons Bar */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1 sm:gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => skipPrev(true)}
                    className="h-9 w-9 sm:h-10 sm:w-10 rounded-full text-zinc-300 hover:text-white"
                    disabled={!activeSong}
                  >
                    <SkipForward className="h-4 w-4 sm:h-4.5 sm:w-4.5 rotate-180" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => handleTogglePlay(!playing)}
                    disabled={!activeSong}
                    className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-white text-black hover:bg-zinc-200 shadow-md transition transform active:scale-95"
                  >
                    {playing ? (
                      <Pause className="h-4 w-4 sm:h-5 sm:w-5" />
                    ) : (
                      <Play className="h-4 w-4 sm:h-5 sm:w-5 ml-0.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => skipNext(true)}
                    className="h-9 w-9 sm:h-10 sm:w-10 rounded-full text-zinc-300 hover:text-white"
                    disabled={!activeSong}
                  >
                    <SkipForward className="h-4 w-4 sm:h-4.5 sm:w-4.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-1 sm:gap-2">
                  <IconToggle active={shuffle} onClick={toggleShuffle} title="Shuffle">
                    <Shuffle className="h-4 w-4" />
                  </IconToggle>

                  <IconToggle
                    active={autoplay}
                    onClick={() => setAutoplay(!autoplay)}
                    title="Autoplay next"
                  >
                    <Sparkles className="h-4 w-4" />
                  </IconToggle>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleVoteSkip}
                    disabled={!activeSong}
                    className="h-9 w-9 sm:h-10 sm:w-10 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 relative"
                    title="Vote to skip"
                  >
                    <Forward className="h-4 w-4" />
                    <span className="absolute -bottom-1 -right-1 text-[9px] font-mono bg-black border border-zinc-800 rounded-full px-1 text-zinc-300 shadow">
                      {skipVotes.size}/{votesNeeded}
                    </span>
                  </Button>
                </div>
              </div>

              {/* Volume Scrubber */}
              <div className="flex items-center gap-3 pt-2.5 border-t border-zinc-900">
                <button
                  onClick={() => setMuted(!muted)}
                  className="text-zinc-400 hover:text-white transition p-1"
                  title={muted ? "Unmute" : "Mute"}
                >
                  {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <Slider
                  value={[muted ? 0 : volume]}
                  max={100}
                  step={1}
                  onValueChange={(v) => {
                    const next = v[0] ?? 0;
                    setVolume(next);
                    if (next > 0 && muted) setMuted(false);
                  }}
                  className="max-w-[140px] sm:max-w-[180px]"
                />
                <span className="text-[10px] font-mono text-zinc-500 tabular-nums w-6">
                  {muted ? 0 : volume}
                </span>
              </div>
            </div>

            {/* Video Stage Frame */}
            <div className="p-3 sm:p-4 bg-zinc-950/60">
              <YouTubePlayer
                videoId={activeSong?.id ?? null}
                playing={playing}
                volume={volume}
                muted={muted}
                seekCommand={seekCommand}
                onPlay={handlePlayerPlay}
                onPause={handlePlayerPause}
                onStateChange={handlePlayerStateChange}
                onEnded={handlePlayerEnded}
              />
            </div>

            {/* Next Up Banner */}
            <div className="px-3.5 py-3 sm:px-5 sm:py-3.5 border-t border-zinc-900 bg-zinc-950/40">
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-1.5 font-medium">
                Next Up
              </div>
              {upNext ? (
                <div className="flex items-center gap-3 rounded-xl border border-zinc-900 bg-black/40 p-2 sm:p-2.5">
                  <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0 overflow-hidden relative">
                    {upNext.thumbnail ? (
                      <img
                        src={upNext.thumbnail}
                        alt=""
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Music2 className="h-4 w-4 text-zinc-700" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs sm:text-sm font-medium truncate">{upNext.title}</div>
                    <div className="text-[11px] text-zinc-500 truncate">{upNext.artist}</div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-500">Queue a track to keep the stream moving.</div>
              )}
            </div>
          </div>
        </main>

        {/* Right Column (Desktop Tabs: 40% Width) */}
        <aside className="hidden lg:flex lg:w-2/5 flex-col min-h-0">
          <Tabs defaultValue="queue" className="flex-1 flex flex-col min-h-0">
            <div className="px-4 pt-4 shrink-0">
              <TabsList className="bg-zinc-950 border border-zinc-900 h-10 w-full grid grid-cols-3 p-1 rounded-lg">
                <TabsTrigger
                  value="queue"
                  className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-400 text-xs h-full rounded-md gap-1.5 transition"
                >
                  <ListMusic className="h-3.5 w-3.5" /> Queue ({queue.length})
                </TabsTrigger>
                <TabsTrigger
                  value="search"
                  className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-400 text-xs h-full rounded-md gap-1.5 transition"
                >
                  <Search className="h-3.5 w-3.5" /> Search
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-400 text-xs h-full rounded-md gap-1.5 transition"
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Chat
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="queue" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
              {queuePanel}
            </TabsContent>
            <TabsContent value="search" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
              {searchPanel}
            </TabsContent>
            <TabsContent value="chat" className="flex-1 min-h-0 mt-3 data-[state=inactive]:hidden">
              {chatPanel}
            </TabsContent>
          </Tabs>
        </aside>

        {/* Mobile / Tablet Bottom Tabs Section */}
        <section className="lg:hidden flex flex-col border-t border-zinc-900 flex-1 min-h-[420px]">
          {/* Sticky Tab Switcher */}
          <div className="px-3.5 pt-3 pb-2 sticky top-14 z-20 bg-black/95 backdrop-blur border-b border-zinc-900/60">
            <div className="bg-zinc-950 border border-zinc-900 h-10 w-full grid grid-cols-3 p-1 rounded-lg shadow-sm">
              {([
                { id: "queue", label: `Queue (${queue.length})`, icon: ListMusic },
                { id: "search", label: "Search", icon: Search },
                { id: "chat", label: "Chat", icon: MessageSquare },
              ] as const).map((t) => {
                const Icon = t.icon;
                const active = mobileTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setMobileTab(t.id)}
                    className={`flex items-center justify-center gap-1.5 text-xs font-medium rounded-md h-full transition ${
                      active ? "bg-zinc-900 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Tab Panel for Mobile */}
          <div className="flex-1 min-h-0 flex flex-col pt-2 pb-6">
            {mobileTab === "queue" && queuePanel}
            {mobileTab === "search" && searchPanel}
            {mobileTab === "chat" && chatPanel}
          </div>
        </section>
      </div>
    </div>
  );
}

// Subcomponents: SongRow, IconToggle, QueueList, SearchPanel, ChatPanel, JoinScreen
function SongRow({
  song,
  active,
  action,
  onClick,
  onAction,
  draggable,
  dimmed,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  song: Song;
  active: boolean;
  action: "add" | "remove";
  onClick?: () => void;
  onAction?: () => void;
  draggable?: boolean;
  dimmed?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-2.5 sm:gap-3 p-2 sm:p-2.5 w-full min-w-0 rounded-xl cursor-pointer transition-all border ${
        active
          ? "bg-white/5 border-zinc-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
          : "border-transparent hover:bg-white/3 hover:border-zinc-900"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {draggable && (
        <div className="text-zinc-700 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0 hidden sm:block">
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <div className="relative h-11 w-11 shrink-0 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden">
        {song.thumbnail ? (
          <img
            src={song.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Music2 className="h-4 w-4 text-zinc-600" />
        )}
        {active && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="h-2 w-2 rounded-full bg-white animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 pr-1">
        <div
          className={`text-xs sm:text-sm truncate font-medium ${
            active ? "text-white" : "text-zinc-200"
          }`}
        >
          {song.title}
        </div>
        <div className="text-[11px] text-zinc-500 truncate flex items-center gap-1.5 mt-0.5">
          <span className="truncate">{song.artist}</span>
          <span className="text-zinc-700">.</span>
          <span className="text-zinc-500 font-mono tabular-nums">{fmt(song.duration)}</span>
          {song.addedBy && (
            <>
              <span className="text-zinc-700 hidden sm:inline">.</span>
              <span
                className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/5 border border-zinc-800 text-[10px] text-zinc-400 shrink-0"
                title={`Added by ${song.addedBy}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: avatarColor(song.addedBy) }}
                />
                <span>{song.addedBy}</span>
              </span>
            </>
          )}
        </div>
      </div>

      <Button
        size="icon"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onAction?.();
        }}
        className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full active:scale-95 transition bg-white/5 sm:bg-transparent"
      >
        {action === "add" ? <Plus className="h-4 w-4 text-white" /> : <X className="h-4 w-4 text-zinc-400" />}
      </Button>
    </div>
  );
}

function IconToggle({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`h-9 w-9 sm:h-10 sm:w-10 rounded-full flex items-center justify-center transition relative ${
        active
          ? "text-white bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.15)]"
          : "text-zinc-500 hover:text-white hover:bg-white/5"
      }`}
    >
      {children}
      {active && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-white" />}
    </button>
  );
}

function QueueList({
  queue,
  activeId,
  dragId,
  onSelect,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  queue: Song[];
  activeId: string;
  dragId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, overId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <ScrollArea className="h-full px-3 sm:px-4">
      <div className="flex flex-col gap-1.5 pb-6">
        {queue.length === 0 ? (
          <div className="py-12 sm:py-16">
            <EmptyIllustration
              icon={<ListMusic className="h-7 w-7 sm:h-8 sm:w-8" />}
              title="Queue is empty"
              hint="Search YouTube to add songs to the live broadcast"
            />
          </div>
        ) : (
          queue.map((s) => (
            <SongRow
              key={s.id}
              song={s}
              active={s.id === activeId}
              action="remove"
              draggable
              dimmed={dragId === s.id}
              onClick={() => onSelect(s.id)}
              onAction={() => onRemove(s.id)}
              onDragStart={() => onDragStart(s.id)}
              onDragOver={(e) => onDragOver(e, s.id)}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </ScrollArea>
  );
}

function SearchPanel({
  query,
  setQuery,
  searching,
  results,
  queue,
  onAdd,
  onRemove,
}: {
  query: string;
  setQuery: (v: string) => void;
  searching: boolean;
  results: Song[];
  queue: Song[];
  onAdd: (s: Song) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3.5 sm:px-4 pb-3 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube for songs, artists, tracks..."
            className="pl-9 pr-9 h-11 bg-zinc-950 border-zinc-800 text-sm placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-zinc-700 rounded-xl"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 animate-spin" />
          )}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0 px-3 sm:px-4">
        <div className="flex flex-col gap-1.5 pb-6">
          {searching ? (
            Array.from({ length: 4 }).map((_, i) => <SongSkeleton key={i} />)
          ) : results.length === 0 ? (
            <div className="py-12 sm:py-16">
              <EmptyIllustration
                icon={<Search className="h-7 w-7 sm:h-8 sm:w-8" />}
                title="No results found"
                hint={query.trim() ? `Nothing found for "${query}"` : "Type a query above to search YouTube"}
              />
            </div>
          ) : (
            results.map((s) => {
              const inQueue = queue.some((q) => q.id === s.id);
              return (
                <SongRow
                  key={s.id}
                  song={s}
                  active={false}
                  action={inQueue ? "remove" : "add"}
                  onAction={() => (inQueue ? onRemove(s.id) : onAdd(s))}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ChatPanel({
  messages,
  chatInput,
  setChatInput,
  onSend,
  scrollRef,
  me,
}: {
  messages: ChatMsg[];
  chatInput: string;
  setChatInput: (v: string) => void;
  onSend: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  me: string;
}) {
  return (
    <div className="flex flex-col h-full min-h-[360px] lg:min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 sm:px-4 py-2 space-y-3">
        {messages.length === 0 ? (
          <div className="py-12 sm:py-16">
            <EmptyIllustration
              icon={<MessageSquare className="h-7 w-7 sm:h-8 sm:w-8" />}
              title="No messages yet"
              hint="Say hi to other listeners in the room"
            />
          </div>
        ) : (
          messages.map((m) => {
            if (m.system) {
              return (
                <div
                  key={m.id}
                  className="text-center text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono"
                >
                  {m.text}
                </div>
              );
            }
            const mine = m.user === me;
            return (
              <div key={m.id} className={`flex gap-2 sm:gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                <div
                  className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] sm:text-[11px] font-semibold text-black shadow"
                  style={{ backgroundColor: avatarColor(m.user) }}
                >
                  {m.user[0]?.toUpperCase()}
                </div>
                <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  <div className="text-[10px] text-zinc-500 mb-0.5 px-1">{m.user}</div>
                  <div
                    className={`px-3 py-2 rounded-2xl text-xs sm:text-sm break-words ${
                      mine
                        ? "bg-white text-black rounded-tr-sm"
                        : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
        className="p-3 border-t border-zinc-900 flex gap-2 shrink-0 bg-black/80 backdrop-blur"
      >
        <Input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Send a chat message..."
          className="h-10 sm:h-11 bg-zinc-950 border-zinc-800 text-xs sm:text-sm placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-zinc-700 rounded-xl"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!chatInput.trim()}
          className="h-10 w-10 sm:h-11 sm:w-11 shrink-0 bg-white text-black hover:bg-zinc-200 disabled:opacity-30 rounded-xl transition"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function SongSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl border border-zinc-900/50">
      <Skeleton className="h-11 w-11 rounded-lg bg-zinc-900 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/2 bg-zinc-900" />
        <Skeleton className="h-2.5 w-1/3 bg-zinc-900" />
      </div>
    </div>
  );
}

function EmptyIllustration({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 px-4">
      <div className="relative h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-zinc-500 shadow-inner">
        <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.06),transparent_70%)]" />
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-300">{title}</div>
        <div className="text-xs text-zinc-500 mt-1 max-w-xs">{hint}</div>
      </div>
    </div>
  );
}

function JoinScreen({
  username,
  setUsername,
  onJoin,
}: {
  username: string;
  setUsername: (v: string) => void;
  onJoin: () => void;
}) {
  const canJoin = username.trim().length > 0;
  const initial = (username.trim()[0] || "?").toUpperCase();

  return (
    <div className="min-h-dvh w-full bg-black text-white flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.04),transparent_55%)]" />

      <div className="relative w-full max-w-sm sm:max-w-md">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950/60 backdrop-blur-2xl p-6 sm:p-10 shadow-[0_0_80px_rgba(255,255,255,0.04)]">
          <div className="flex justify-center mb-6 sm:mb-8">
            <div className="relative h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-white/5 border border-zinc-800 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <Radio className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              {username.trim() && (
                <div
                  className="absolute -bottom-1.5 -right-1.5 h-6 w-6 sm:h-7 sm:w-7 rounded-full border-2 border-black flex items-center justify-center text-[10px] sm:text-[11px] font-semibold text-black shadow"
                  style={{ backgroundColor: avatarColor(username.trim()) }}
                >
                  {initial}
                </div>
              )}
            </div>
          </div>

          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-center">
            Obsidian Radio
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 text-center mt-2">
            One live room. Listen together in real time.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canJoin) onJoin();
            }}
            className="mt-8 sm:mt-10 space-y-4 sm:space-y-5"
          >
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-medium">
                Display Name
              </label>
              <Input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 20))}
                placeholder="Enter your name"
                className="h-12 bg-black border-zinc-800 text-sm placeholder:text-zinc-700 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:border-zinc-700 rounded-xl"
              />
            </div>

            <Button
              type="submit"
              disabled={!canJoin}
              className="w-full h-12 bg-white text-black hover:bg-zinc-200 font-medium shadow-[0_0_40px_rgba(255,255,255,0.15)] disabled:opacity-40 disabled:shadow-none transition rounded-xl"
            >
              Tune In To Live Broadcast
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
