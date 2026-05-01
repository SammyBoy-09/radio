"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCallback } from "react";
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
import Image from "next/image";

type Song = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
  addedBy?: string;
};

type ChatMsg = {
  id: string;
  user: string;
  text: string;
  ts: number;
  system?: boolean;
};

const mockQueue: Song[] = [];
const RADIO_CHANNEL = "presence-radio";

type RoomChannel = {
  bind: (event: string, callback: (payload: unknown) => void) => void;
  trigger: (event: string, payload: Record<string, unknown>) => void;
};

type PresenceMember = {
  id: string;
  info?: {
    name?: string;
  };
};

type PresenceMembers = {
  each: (callback: (member: PresenceMember) => void) => void;
};

type PlayerActionPayload = {
  action: "play" | "pause" | "seek" | "next" | "prev";
  user?: string;
  sessionId?: string;
  progress?: number;
  queue?: Song[];
  activeId?: string;
  text?: string;
  time?: number;
};

function getOrCreateSessionId() {
  if (typeof window === "undefined") return "";

  const existing = window.localStorage.getItem("obsidian-radio-session-id");
  if (existing) return existing;

  const next =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Math.random().toString(36).slice(2, 10)}`;

  window.localStorage.setItem("obsidian-radio-session-id", next);
  return next;
}

function avatarColor(name: string) {
  const palette = ["#f5f5f5", "#a1a1aa", "#71717a", "#fafafa", "#d4d4d8"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function Home() {
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [sessionId] = useState(() => (typeof window === "undefined" ? "" : getOrCreateSessionId()));

  const [playing, setPlaying] = useState(true);
  const [queue, setQueue] = useState<Song[]>(mockQueue);
  const [activeId, setActiveId] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [shuffle, setShuffle] = useState(false);
  const [autoplay, setAutoplay] = useState(true);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Song[]>([]);

  const [skipVotes, setSkipVotes] = useState<Set<string>>(new Set());
  const [listeners, setListeners] = useState<Array<{ id: string; name: string }>>([]);
  const totalListeners = Math.max(1, listeners.length);
  const votesNeeded = Math.max(1, Math.ceil(totalListeners / 2));

  const [dragId, setDragId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RoomChannel | null>(null);
  const [seekCommand, setSeekCommand] = useState<{ time: number; nonce: number } | null>(null);

  const [mobileTab, setMobileTab] = useState<"queue" | "search" | "chat">("queue");

  const activeSong = queue.find((s) => s.id === activeId);
  const upNext = useMemo(() => {
    if (!queue.length || !activeSong) return null;
    const idx = queue.findIndex((s) => s.id === activeId);
    return queue[(idx + 1) % queue.length] ?? null;
  }, [queue, activeId, activeSong]);

  const switchTrack = useCallback((nextId: string) => {
    setActiveId(nextId);
    setSkipVotes(new Set());
    setProgress(0);
  }, []);

  const emitSeekCommit = useCallback(
    (time: number) => {
      setSeekCommand({ time, nonce: Date.now() });
      channelRef.current?.trigger("client-player-action", {
        action: "seek",
        progress: time,
        user: username || "guest",
        sessionId,
      });
    },
    [sessionId, username],
  );

  useEffect(() => {
    if (!playing || !activeSong) return;
    const t = setInterval(() => {
      setProgress((p) => {
        if (p + 1 >= activeSong.duration) {
          if (repeatMode === "one") {
            setProgress(0);
            return 0;
          }
          if (!autoplay) {
            setPlaying(false);
            return 0;
          }

          const nextId = (() => {
            if (!queue.length) return "";
            if (shuffle) {
              const others = queue.filter((s) => s.id !== activeId);
              if (!others.length) return activeId;
              return others[Math.floor(Math.random() * others.length)].id;
            }
            const idx = queue.findIndex((s) => s.id === activeId);
            if (idx === -1) return queue[0].id;
            if (idx + 1 >= queue.length) {
              return repeatMode === "all" ? queue[0].id : queue[queue.length - 1].id;
            }
            return queue[idx + 1].id;
          })();

          if (nextId) switchTrack(nextId);
          return 0;
        }
        return p + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, activeSong, autoplay, repeatMode, queue, shuffle, activeId, setPlaying, setProgress, switchTrack]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Pusher integration
  useEffect(() => {
    if (!joined || !username || !sessionId) return;

    setPusherAuthParams({ username, session_id: sessionId });

    const pusher = getPusherClient();
    const channelName = RADIO_CHANNEL;
    const channel = pusher.subscribe(channelName) as unknown as RoomChannel;
    channelRef.current = channel;

    channel.bind("pusher:subscription_succeeded", (payload: unknown) => {
      const members = payload as PresenceMembers;
      const nextListeners: Array<{ id: string; name: string }> = [];
      members.each((member) => {
        nextListeners.push({
          id: member.id,
          name: member.info?.name || "Guest",
        });
      });
      setListeners(nextListeners);
    });

    channel.bind("pusher:member_added", (payload: unknown) => {
      const member = payload as PresenceMember;
      setListeners((current) => {
        if (current.some((entry) => entry.id === member.id)) return current;
        return [...current, { id: member.id, name: member.info?.name || "Guest" }];
      });
    });

    channel.bind("pusher:member_removed", (payload: unknown) => {
      const member = payload as PresenceMember;
      setListeners((current) => current.filter((entry) => entry.id !== member.id));
    });

    // Listen for player actions from other users
    channel.bind("player-action", (payload: unknown) => {
      const data = payload as PlayerActionPayload;
      if (data.sessionId === sessionId) return; // Ignore own events
      if (data.action === "play") setPlaying(true);
      if (data.action === "pause") setPlaying(false);
      if (data.action === "seek") {
        const nextTime = data.progress || 0;
        setProgress(nextTime);
        setSeekCommand({ time: nextTime, nonce: Date.now() });
      }
      if (data.action === "next") {
        const nextId = (() => {
          if (!queue.length) return "";
          if (shuffle) {
            const others = queue.filter((song) => song.id !== activeId);
            if (!others.length) return activeId;
            return others[Math.floor(Math.random() * others.length)].id;
          }
          const idx = queue.findIndex((song) => song.id === activeId);
          if (idx === -1) return queue[0].id;
          if (idx + 1 >= queue.length) {
            return repeatMode === "all" ? queue[0].id : queue[queue.length - 1].id;
          }
          return queue[idx + 1].id;
        })();
        if (nextId) switchTrack(nextId);
      }
      if (data.action === "prev") {
        if (progress > 3) {
          setProgress(0);
        } else {
          const idx = queue.findIndex((s) => s.id === activeId);
          const prev = queue[(idx - 1 + queue.length) % queue.length];
          if (prev) switchTrack(prev.id);
        }
      }
    });

    // Listen for queue updates
    channel.bind("queue-updated", (payload: unknown) => {
      const data = payload as PlayerActionPayload;
      if (data.sessionId === sessionId) return;
      setQueue(data.queue || []);
      if (data.activeId) switchTrack(data.activeId);
    });

    // Listen for chat messages
    channel.bind("chat-message", (payload: unknown) => {
      const data = payload as { user?: string; text?: string };
      setMessages((m) => [
        ...m,
        {
          id: `m${Date.now()}-${Math.random()}`,
          user: data.user || "guest",
          text: data.text || "",
          ts: Date.now(),
        },
      ]);
    });

    // Listen for time sync from host
    channel.bind("sync-time", (payload: unknown) => {
      const data = payload as { time?: number };
      const nextTime = data.time || 0;
      if (!isHost && Math.abs(nextTime - progress) > 2) {
        setProgress(nextTime);
        setSeekCommand({ time: nextTime, nonce: Date.now() });
      }
    });

    return () => {
      pusher.unsubscribe(channelName);
      channelRef.current = null;
    };
  }, [joined, username, sessionId, isHost, progress, queue, activeId, repeatMode, shuffle, switchTrack]);

  // Host time polling - emit current time every 5 seconds
  useEffect(() => {
    if (!joined || !isHost || !channelRef.current) return;

    const interval = setInterval(() => {
      channelRef.current?.trigger("client-sync-time", {
        time: progress,
        user: username,
        sessionId,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [joined, isHost, progress, username, sessionId]);

  const addToQueue = (song: Song) => {
    setQueue((q) => {
      if (q.some((s) => s.id === song.id)) {
        toast("Already in queue", { description: song.title });
        return q;
      }
      const next = [...q, { ...song, addedBy: username || "guest" }];
      if (!q.length) switchTrack(song.id);
      return next;
    });
    toast.success("Added to queue", { description: `${song.title} - ${song.artist}` });
  };

  const removeFromQueue = (id: string) => {
    setQueue((q) => {
      const idx = q.findIndex((s) => s.id === id);
      if (idx === -1) return q;
      const next = q.filter((s) => s.id !== id);
      if (id === activeId) {
        const fallback = next[idx] ?? next[idx - 1] ?? next[0];
        switchTrack(fallback ? fallback.id : "");
      }
      return next;
    });
  };

  const pickNextId = () => {
    if (!queue.length) return "";
    if (shuffle) {
      const others = queue.filter((s) => s.id !== activeId);
      if (!others.length) return activeId;
      return others[Math.floor(Math.random() * others.length)].id;
    }
    const idx = queue.findIndex((s) => s.id === activeId);
    if (idx === -1) return queue[0].id;
    if (idx + 1 >= queue.length) {
      return repeatMode === "all" ? queue[0].id : queue[queue.length - 1].id;
    }
    return queue[idx + 1].id;
  };

  const skipNext = () => {
    const nid = pickNextId();
    if (nid) {
      switchTrack(nid);
      // Emit to Pusher
      if (channelRef.current) {
        channelRef.current?.trigger("client-player-action", {
          action: "next",
          user: username,
          sessionId,
        });
      }
    }
  };

  const skipPrev = () => {
    if (progress > 3) {
      setProgress(0);
      if (channelRef.current) {
        channelRef.current?.trigger("client-player-action", {
          action: "seek",
          progress: 0,
          user: username,
          sessionId,
        });
      }
      return;
    }
    if (!queue.length) return;
    const idx = queue.findIndex((s) => s.id === activeId);
    const prev = queue[(idx - 1 + queue.length) % queue.length];
    switchTrack(prev.id);
    if (channelRef.current) {
      channelRef.current?.trigger("client-player-action", {
        action: "prev",
        user: username,
        sessionId,
      });
    }
  };

  const voteSkip = () => {
    const me = username || "guest";
    setSkipVotes((prev) => {
      if (prev.has(me)) {
        toast("You already voted to skip");
        return prev;
      }
      const next = new Set(prev);
      next.add(me);
      if (next.size >= votesNeeded) {
        toast.success("Skip passed", { description: "Moving to next track" });
        setTimeout(() => skipNext(), 200);
      } else {
        toast(`Vote registered (${next.size}/${votesNeeded})`);
      }
      return next;
    });
  };

  const cycleRepeat = () => {
    setRepeatMode((m) => {
      const next = m === "off" ? "all" : m === "all" ? "one" : "off";
      toast(`Repeat: ${next}`);
      return next;
    });
  };

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
      return next;
    });
  };
  const onDragEnd = () => setDragId(null);

  // Debounced search with API call
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

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    
    const newMessage = { id: `m${Date.now()}`, user: username || "guest", text, ts: Date.now() };
    setMessages((m) => [...m, newMessage]);
    
    // Emit to Pusher if connected
    if (channelRef.current) {
      channelRef.current?.trigger("client-chat-message", {
        user: username || "guest",
        text,
        sessionId,
      });
    }
    
    setChatInput("");
  };

  if (!joined) {
    return (
      <JoinScreen
        username={username}
        setUsername={setUsername}
        onJoin={() => {
          setIsHost(true); // User is the host when creating a room
          setJoined(true);
          setTimeout(
            () => toast.success(`Welcome, ${username || "guest"}`, { description: "You joined the live room" }),
            100,
          );
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
      me={username || "guest"}
    />
  );

  const queuePanel = (
    <QueueList
      queue={queue}
      activeId={activeId}
      dragId={dragId}
      onSelect={setActiveId}
      onRemove={removeFromQueue}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    />
  );

  return (
    <div className="min-h-dvh w-full flex flex-col bg-black text-white overflow-x-auto overflow-y-auto">
      <header className="h-14 sm:h-16 shrink-0 border-b border-zinc-900 flex items-center justify-between px-3 sm:px-6 gap-2">
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-md bg-white/5 border border-zinc-800 flex items-center justify-center shrink-0">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold tracking-tight truncate">Obsidian Radio</span>
        </div>
        <div className="hidden sm:block text-xs text-zinc-400 font-mono tracking-widest">
          LIVE ROOM
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Badge variant="outline" className="border-zinc-800 bg-zinc-900/60 text-zinc-300 gap-1.5 font-normal">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            <Users className="h-3 w-3" /> {totalListeners}
          </Badge>
          <div className="flex items-center gap-2 sm:pl-3 sm:border-l border-zinc-800">
            <div
              className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-black"
              style={{ backgroundColor: avatarColor(username || "guest") }}
            >
              {(username.trim()[0] || "G").toUpperCase()}
            </div>
            <span className="text-xs text-zinc-300 font-medium hidden md:inline">{username || "guest"}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <main className="lg:w-3/5 p-3 sm:p-6 flex flex-col gap-4 sm:gap-5 lg:border-r border-zinc-900">
          <Player
            activeSong={activeSong}
            playing={playing}
            setPlaying={setPlaying}
            progress={progress}
            setProgress={setProgress}
            seekCommand={seekCommand}
            onSeekCommit={emitSeekCommit}
            volume={volume}
            setVolume={setVolume}
            muted={muted}
            setMuted={setMuted}
            repeatMode={repeatMode}
            cycleRepeat={cycleRepeat}
            shuffle={shuffle}
            setShuffle={setShuffle}
            autoplay={autoplay}
            setAutoplay={setAutoplay}
            skipNext={skipNext}
            skipPrev={skipPrev}
            voteSkip={voteSkip}
            skipVotes={skipVotes}
            votesNeeded={votesNeeded}
            upNext={upNext}
          />
        </main>

        <aside className="hidden lg:flex lg:w-2/5 flex-col min-h-0">
          <Tabs defaultValue="queue" className="flex-1 flex flex-col min-h-0">
            <div className="px-4 pt-4">
              <TabsList className="bg-zinc-950 border border-zinc-900 h-9 w-full grid grid-cols-3 p-0.5">
                <TabsTrigger value="queue" className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-500 text-xs h-full rounded-md gap-1.5">
                  <ListMusic className="h-3.5 w-3.5" /> Queue - {queue.length}
                </TabsTrigger>
                <TabsTrigger value="search" className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-500 text-xs h-full rounded-md gap-1.5">
                  <Search className="h-3.5 w-3.5" /> Search
                </TabsTrigger>
                <TabsTrigger value="chat" className="data-[state=active]:bg-zinc-900 data-[state=active]:text-white text-zinc-500 text-xs h-full rounded-md gap-1.5">
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

        <section className="lg:hidden flex flex-col min-h-0 border-t border-zinc-900 flex-1">
          <div className="px-3 pt-3">
            <div className="bg-zinc-950 border border-zinc-900 h-9 w-full grid grid-cols-3 p-0.5 rounded-md">
              {([
                { id: "queue", label: `Queue - ${queue.length}`, icon: ListMusic },
                { id: "search", label: "Search", icon: Search },
                { id: "chat", label: "Chat", icon: MessageSquare },
              ] as const).map((t) => {
                const Icon = t.icon;
                const active = mobileTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setMobileTab(t.id)}
                    className={`flex items-center justify-center gap-1.5 text-xs rounded-md h-full transition ${
                      active ? "bg-zinc-900 text-white" : "text-zinc-500"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex-1 min-h-0 mt-3 flex flex-col">
            {mobileTab === "queue" && queuePanel}
            {mobileTab === "search" && searchPanel}
            {mobileTab === "chat" && chatPanel}
          </div>
        </section>
      </div>
    </div>
  );
}

function Player({
  activeSong,
  playing,
  setPlaying,
  progress,
  setProgress,
  seekCommand,
  onSeekCommit,
  volume,
  setVolume,
  muted,
  setMuted,
  repeatMode,
  cycleRepeat,
  shuffle,
  setShuffle,
  autoplay,
  setAutoplay,
  skipNext,
  skipPrev,
  voteSkip,
  skipVotes,
  votesNeeded,
  upNext,
}: {
  activeSong: Song | undefined;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  progress: number;
  setProgress: (v: number) => void;
  seekCommand: { time: number; nonce: number } | null;
  onSeekCommit: (time: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  muted: boolean;
  setMuted: (v: boolean) => void;
  repeatMode: "off" | "all" | "one";
  cycleRepeat: () => void;
  shuffle: boolean;
  setShuffle: (v: boolean) => void;
  autoplay: boolean;
  setAutoplay: (v: boolean) => void;
  skipNext: () => void;
  skipPrev: () => void;
  voteSkip: () => void;
  skipVotes: Set<string>;
  votesNeeded: number;
  upNext: Song | null;
}) {
  const duration = activeSong?.duration ?? 0;
  const RepeatIcon = repeatMode === "one" ? Repeat1 : Repeat;
  const handlePlayerPlay = useCallback(() => setPlaying(true), [setPlaying]);
  const handlePlayerPause = useCallback(() => setPlaying(false), [setPlaying]);
  const handlePlayerStateChange = useCallback(
    (time: number) => {
      setProgress(Math.floor(time));
    },
    [setProgress],
  );
  const handlePlayerEnded = useCallback(() => {
    skipNext();
  }, [skipNext]);

  const handleSeekChange = (value: number[]) => {
    const nextTime = value[0] ?? 0;
    setProgress(nextTime);
  };

  const handleSeekCommit = (value: number[]) => {
    const nextTime = value[0] ?? 0;
    onSeekCommit(nextTime);
  };

  return (
    <div className="rounded-2xl border border-zinc-900 bg-zinc-950/95 shadow-[0_12px_48px_rgba(0,0,0,0.35)] overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-zinc-900 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl overflow-hidden border border-zinc-800 bg-black shrink-0 flex items-center justify-center">
            {activeSong?.thumbnail ? (
              <Image src={activeSong.thumbnail} alt="" fill sizes="64px" className="object-cover" />
            ) : (
              <Music2 className="h-6 w-6 text-zinc-700" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-1">Now Playing</div>
            <div className="text-base sm:text-lg font-medium truncate">{activeSong?.title ?? "Nothing queued"}</div>
            <div className="text-sm text-zinc-400 truncate">{activeSong?.artist ?? "Add a song to start the room"}</div>
          </div>
          <button
            onClick={cycleRepeat}
            className="h-9 w-9 rounded-full border border-zinc-800 text-zinc-300 hover:text-white hover:bg-white/5 flex items-center justify-center"
            title={`Repeat: ${repeatMode}`}
          >
            <RepeatIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-mono">
            <span>{fmt(progress)}</span>
            <span>{fmt(duration)}</span>
          </div>
          <Slider
            value={[Math.min(progress, duration)]}
            max={Math.max(duration, 1)}
            step={1}
            onValueChange={handleSeekChange}
            onValueCommit={handleSeekCommit}
            disabled={!activeSong}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button variant="ghost" size="icon" onClick={skipPrev} className="h-9 w-9 rounded-full">
              <SkipForward className="h-4 w-4 rotate-180" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setPlaying(!playing)}
              className="h-11 w-11 rounded-full bg-white text-black hover:bg-zinc-200"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={skipNext} className="h-9 w-9 rounded-full">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <IconToggle active={shuffle} onClick={() => setShuffle(!shuffle)} title="Shuffle">
              <Shuffle className="h-4 w-4" />
            </IconToggle>
            <IconToggle active={autoplay} onClick={() => setAutoplay(!autoplay)} title="Autoplay">
              <Sparkles className="h-4 w-4" />
            </IconToggle>
            <Button
              variant="ghost"
              size="icon"
              onClick={voteSkip}
              className="h-9 w-9 rounded-full text-zinc-300 hover:text-white hover:bg-white/5 relative"
              title="Vote to skip"
            >
              <Forward className="h-4 w-4" />
              <span className="absolute -bottom-1 -right-1 text-[9px] font-mono bg-black border border-zinc-800 rounded-full px-1 text-zinc-400">
                {skipVotes.size}/{votesNeeded}
              </span>
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-zinc-900">
          <button
            onClick={() => setMuted(!muted)}
            className="text-zinc-400 hover:text-white transition"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            max={100}
            step={1}
            onValueChange={(v) => {
              setVolume(v[0]);
              if (v[0] > 0 && muted) setMuted(false);
            }}
            className="max-w-45"
          />
          <span className="text-[10px] font-mono text-zinc-600 tabular-nums w-7">{muted ? 0 : volume}</span>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-2">Next Up</div>
        {upNext ? (
          <div className="flex items-center gap-3 rounded-xl border border-zinc-900 bg-black/30 p-2.5">
            <div className="h-10 w-10 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0 overflow-hidden relative">
              {upNext.thumbnail ? <Image src={upNext.thumbnail} alt="" fill sizes="40px" className="object-cover" /> : <Music2 className="h-4 w-4 text-zinc-700" />}
            </div>
            <div className="min-w-0">
              <div className="text-sm truncate">{upNext.title}</div>
              <div className="text-xs text-zinc-500 truncate">{upNext.artist}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-500">Queue a track to keep the room moving.</div>
        )}
      </div>

      <YouTubePlayer
        videoId={activeSong?.id ?? null}
        playing={playing}
        seekCommand={seekCommand}
        onPlay={handlePlayerPlay}
        onPause={handlePlayerPause}
        onStateChange={handlePlayerStateChange}
        onEnded={handlePlayerEnded}
      />
    </div>
  );
}

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
      className={`group relative flex items-center gap-2 sm:gap-3 p-2 pr-12 sm:pr-14 w-full min-w-0 overflow-hidden rounded-lg cursor-pointer transition-all border ${
        active
          ? "bg-white/4 border-zinc-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
          : "border-transparent hover:bg-white/2 hover:border-zinc-900"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {draggable && (
        <div className="text-zinc-700 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <div className="relative h-11 w-11 shrink-0 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden">
        {song.thumbnail ? (
          <Image
            src={song.thumbnail}
            alt=""
            referrerPolicy="no-referrer"
            fill
            sizes="44px"
            className="object-cover"
          />
        ) : (
          <Music2 className="h-4 w-4 text-zinc-600" />
        )}
        {active && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm truncate ${active ? "text-white font-medium" : "text-zinc-200"}`}>
          {song.title}
        </div>
        <div className="text-xs text-zinc-500 truncate flex items-center gap-1.5">
          <span className="truncate">{song.artist}</span>
          <span className="text-zinc-700 hidden sm:inline">.</span>
          <span className="text-zinc-600 font-mono tabular-nums hidden sm:inline">{fmt(song.duration)}</span>
          {song.addedBy && (
            <>
              <span className="text-zinc-700 hidden md:inline">.</span>
              <span
                className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/4 border border-zinc-800 text-[10px] text-zinc-400 shrink-0"
                title={`Added by ${song.addedBy}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: avatarColor(song.addedBy) }} />
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
        className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 flex-none shrink-0 opacity-100 transition-opacity text-zinc-400 hover:text-white hover:bg-white/10 rounded-full"
      >
        {action === "add" ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
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
      className={`h-9 w-9 rounded-full flex items-center justify-center transition relative ${
        active ? "text-white bg-white/10 shadow-[0_0_15px_rgba(255,255,255,0.15)]" : "text-zinc-500 hover:text-white hover:bg-white/5"
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
    <ScrollArea className="h-full px-3">
      <div className="flex flex-col gap-1 pb-4">
        {queue.length === 0 ? (
          <div className="py-12">
            <EmptyIllustration
              icon={<ListMusic className="h-7 w-7" />}
              title="Queue is empty"
              hint="Switch to Search and add some tracks"
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
      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube..."
            className="pl-9 h-10 bg-zinc-950 border-zinc-800 text-sm placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-zinc-700"
          />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 animate-spin" />}
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0 px-3">
        <div className="flex flex-col gap-1 pb-4">
          {searching ? (
            Array.from({ length: 4 }).map((_, i) => <SongSkeleton key={i} />)
          ) : results.length === 0 ? (
            <div className="py-12">
              <EmptyIllustration
                icon={<Search className="h-7 w-7" />}
                title="No results"
                hint={query.trim() ? `Nothing found for "${query}"` : "Type to search YouTube"}
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
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-3">
        {messages.length === 0 ? (
          <div className="py-12">
            <EmptyIllustration
              icon={<MessageSquare className="h-7 w-7" />}
              title="No messages yet"
              hint="Say hi to the room"
            />
          </div>
        ) : (
          messages.map((m) => {
            if (m.system) {
              return (
                <div key={m.id} className="text-center text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                  {m.text}
                </div>
              );
            }
            const mine = m.user === me;
            return (
              <div key={m.id} className={`flex gap-2.5 ${mine ? "flex-row-reverse" : ""}`}>
                <div
                  className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[11px] font-semibold text-black"
                  style={{ backgroundColor: avatarColor(m.user) }}
                >
                  {m.user[0]?.toUpperCase()}
                </div>
                <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  <div className="text-[10px] text-zinc-500 mb-0.5 px-1">{m.user}</div>
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm wrap-break-word ${
                      mine ? "bg-white text-black rounded-tr-sm" : "bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm"
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
        className="p-3 border-t border-zinc-900 flex gap-2"
      >
        <Input
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Send a message..."
          className="h-10 bg-zinc-950 border-zinc-800 text-sm placeholder:text-zinc-600 focus-visible:ring-1 focus-visible:ring-white/20 focus-visible:border-zinc-700"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!chatInput.trim()}
          className="h-10 w-10 shrink-0 bg-white text-black hover:bg-zinc-200 disabled:opacity-30"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function SongSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2">
      <Skeleton className="h-11 w-11 rounded-md bg-zinc-900 shrink-0" />
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
    <div className="flex flex-col items-center text-center gap-3 px-6">
      <div className="relative h-16 w-16 rounded-full bg-zinc-950 border border-zinc-900 flex items-center justify-center text-zinc-600">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05),transparent_70%)]" />
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-zinc-300">{title}</div>
        <div className="text-xs text-zinc-600 mt-1">{hint}</div>
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
    <div className="min-h-dvh w-full bg-black text-white flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(255,255,255,0.03),transparent_50%)]" />

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 backdrop-blur-2xl p-8 sm:p-10 shadow-[0_0_80px_rgba(255,255,255,0.04)]">
          <div className="flex justify-center mb-8">
            <div className="relative h-14 w-14 rounded-2xl bg-white/5 border border-zinc-800 flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <Radio className="h-6 w-6" />
              {username.trim() && (
                <div
                  className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-black flex items-center justify-center text-[10px] font-semibold text-black"
                  style={{ backgroundColor: avatarColor(username.trim()) }}
                >
                  {initial}
                </div>
              )}
            </div>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight text-center">Obsidian Radio</h1>
          <p className="text-sm text-zinc-500 text-center mt-2">One live room. Everyone joins the same stream.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canJoin) onJoin();
            }}
            className="mt-10 space-y-5"
          >
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Display Name</label>
              <Input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value.slice(0, 20))}
                placeholder="Your name"
                className="h-12 bg-black border-zinc-800 text-sm placeholder:text-zinc-700 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:border-zinc-700"
              />
            </div>

            <Button
              type="submit"
              disabled={!canJoin}
              className="w-full h-12 bg-white text-black hover:bg-zinc-200 font-medium shadow-[0_0_40px_rgba(255,255,255,0.15)] disabled:opacity-40 disabled:shadow-none"
            >
              Join Live Room
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}
