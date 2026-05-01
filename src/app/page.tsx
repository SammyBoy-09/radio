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
import { getPusherClient } from "@/lib/pusher";
import { YouTubePlayer } from "@/components/YouTubePlayer";

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

const mockResultsBank: Song[] = [];

const mockListeners: string[] = [];

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
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [isHost, setIsHost] = useState(false);

  const [playing, setPlaying] = useState(true);
  const [queue, setQueue] = useState<Song[]>(mockQueue);
  const [activeId, setActiveId] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [volume, setVolume] = useState(70);
  const [muted, setMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [shuffle, setShuffle] = useState(false);
  const [autoplay, setAutoplay] = useState(true);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Song[]>([]);

  const [skipVotes, setSkipVotes] = useState<Set<string>>(new Set());
  const totalListeners = mockListeners.length;
  const votesNeeded = Math.max(1, Math.ceil(totalListeners / 2));

  const [dragId, setDragId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<any>(null);

  const [mobileTab, setMobileTab] = useState<"queue" | "search" | "chat">("queue");

  const activeSong = queue.find((s) => s.id === activeId);
  const upNext = useMemo(() => {
    if (!queue.length || !activeSong) return null;
    const idx = queue.findIndex((s) => s.id === activeId);
    return queue[(idx + 1) % queue.length] ?? null;
  }, [queue, activeId, activeSong]);

  useEffect(() => {
    setSkipVotes(new Set());
    setProgress(0);
  }, [activeId]);

  useEffect(() => {
    if (!playing || !activeSong || seeking) return;
    const t = setInterval(() => {
      setProgress((p) => {
        if (p + 1 >= activeSong.duration) {
          handleTrackEnd();
          return 0;
        }
        return p + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [playing, activeSong, seeking, repeatMode, shuffle, autoplay, queue]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Pusher integration
  useEffect(() => {
    if (!joined || !code || !username) return;

    const pusher = getPusherClient();
    const channelName = `private-room-${code}`;
    const channel = pusher.subscribe(channelName);
    channelRef.current = channel;

    // Listen for player actions from other users
    channel.bind("player-action", (data: any) => {
      if (data.user === username) return; // Ignore own events
      if (data.action === "play") setPlaying(true);
      if (data.action === "pause") setPlaying(false);
      if (data.action === "seek") setProgress(data.progress);
      if (data.action === "next") {
        setActiveId((current) => {
          const q = queue;
          if (shuffle) {
            const others = q.filter((s) => s.id !== current);
            if (!others.length) return current;
            return others[Math.floor(Math.random() * others.length)].id;
          }
          const idx = q.findIndex((s) => s.id === current);
          if (idx === -1) return q[0]?.id || "";
          if (idx + 1 >= q.length) {
            return repeatMode === "all" ? q[0]?.id || "" : q[q.length - 1]?.id || "";
          }
          return q[idx + 1]?.id || "";
        });
      }
      if (data.action === "prev") {
        if (progress > 3) {
          setProgress(0);
        } else {
          setActiveId((current) => {
            const q = queue;
            if (!q.length) return current;
            const idx = q.findIndex((s) => s.id === current);
            const prev = q[(idx - 1 + q.length) % q.length];
            return prev.id;
          });
        }
      }
    });

    // Listen for queue updates
    channel.bind("queue-updated", (data: any) => {
      if (data.user === username) return;
      setQueue(data.queue);
      if (data.activeId) setActiveId(data.activeId);
    });

    // Listen for chat messages
    channel.bind("chat-message", (data: any) => {
      setMessages((m) => [
        ...m,
        {
          id: `m${Date.now()}-${Math.random()}`,
          user: data.user,
          text: data.text,
          ts: Date.now(),
        },
      ]);
    });

    // Listen for time sync from host
    channel.bind("sync-time", (data: any) => {
      if (!isHost && Math.abs(data.time - progress) > 2) {
        setProgress(data.time);
      }
    });

    return () => {
      pusher.unsubscribe(channelName);
      channelRef.current = null;
    };
  }, [joined, code, username, isHost, progress, queue, repeatMode, shuffle]);

  // Host time polling - emit current time every 5 seconds
  useEffect(() => {
    if (!joined || !isHost || !channelRef.current) return;

    const interval = setInterval(() => {
      channelRef.current?.trigger("client-sync-time", {
        time: progress,
        user: username,
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [joined, isHost, progress, username]);

  function handleTrackEnd() {
    if (repeatMode === "one") {
      setProgress(0);
      return;
    }
    if (!autoplay) {
      setPlaying(false);
      return;
    }
    skipNext();
  }

  const addToQueue = (song: Song) => {
    setQueue((q) => {
      if (q.some((s) => s.id === song.id)) {
        toast("Already in queue", { description: song.title });
        return q;
      }
      const next = [...q, { ...song, addedBy: username || "guest" }];
      if (!q.length) setActiveId(song.id);
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
        setActiveId(fallback ? fallback.id : "");
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
      setActiveId(nid);
      // Emit to Pusher
      if (channelRef.current) {
        channelRef.current?.trigger("client-player-action", {
          action: "next",
          user: username,
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
        });
      }
      return;
    }
    if (!queue.length) return;
    const idx = queue.findIndex((s) => s.id === activeId);
    const prev = queue[(idx - 1 + queue.length) % queue.length];
    setActiveId(prev.id);
    if (channelRef.current) {
      channelRef.current?.trigger("client-player-action", {
        action: "prev",
        user: username,
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
  const debouncedSearch = useCallback(
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
      });
    }
    
    setChatInput("");
  };

  if (!joined) {
    return (
      <JoinScreen
        code={code}
        setCode={setCode}
        username={username}
        setUsername={setUsername}
        onJoin={() => {
          setIsHost(true); // User is the host when creating a room
          setJoined(true);
          setTimeout(
            () => toast.success(`Welcome, ${username || "guest"}`, { description: `Created room ${code}` }),
            100,
          );
        }}
      />
    );
  }

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
          ROOM - <span className="text-white">{code}</span>
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
            seeking={seeking}
            setSeeking={setSeeking}
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
  seeking,
  setSeeking,
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
  seeking: boolean;
  setSeeking: (v: boolean) => void;
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
  const [seekCommand, setSeekCommand] = useState<{ time: number; nonce: number } | null>(null);
  const handlePlayerPlay = useCallback(() => setPlaying(true), [setPlaying]);
  const handlePlayerPause = useCallback(() => setPlaying(false), [setPlaying]);
  const handlePlayerStateChange = useCallback((time: number) => {
    setProgress(Math.floor(time));
  }, [setProgress]);
  const handlePlayerEnded = useCallback(() => {
    // The host-side timer advances tracks; keep the player callback stable.
  }, []);

  return (
    <>
      <div className="aspect-video w-full rounded-xl border border-zinc-800 bg-zinc-950 relative overflow-hidden">
        {activeSong ? (
          <YouTubePlayer
            videoId={activeSong.id}
            playing={playing}
            onPlay={handlePlayerPlay}
            onPause={handlePlayerPause}
            onStateChange={handlePlayerStateChange}
            onEnded={handlePlayerEnded}
            seekCommand={seekCommand}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <EmptyIllustration
              icon={<Music2 className="h-8 w-8" />}
              title="Nothing is playing"
              hint="Search for a track to start the room"
            />
          </div>
        )}

        {upNext && activeSong && upNext.id !== activeSong.id && (
          <div className="absolute bottom-3 right-3 max-w-[60%] rounded-lg border border-zinc-800 bg-black/70 backdrop-blur px-3 py-2 flex items-center gap-2.5">
            <div className="text-[9px] uppercase tracking-[0.25em] text-zinc-500 shrink-0">Up Next</div>
            <div className="min-w-0">
              <div className="text-xs text-white truncate">{upNext.title}</div>
              <div className="text-[10px] text-zinc-500 truncate">{upNext.artist}</div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-zinc-900 bg-zinc-950/50 p-4 sm:p-5 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-zinc-500 tabular-nums w-10 text-right">{fmt(progress)}</span>
          <Slider
            value={[Math.min(progress, duration)]}
            max={Math.max(duration, 1)}
            step={1}
            disabled={!activeSong}
            onValueChange={(v) => {
              setSeeking(true);
              setProgress(v[0]);
            }}
            onValueCommit={(v) => {
              setProgress(v[0]);
              setSeeking(false);
              setSeekCommand({ time: v[0], nonce: Date.now() });
            }}
            className="flex-1"
          />
          <span className="text-[11px] font-mono text-zinc-500 tabular-nums w-10">{fmt(duration)}</span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconToggle active={shuffle} onClick={() => setShuffle(!shuffle)} title="Shuffle">
              <Shuffle className="h-4 w-4" />
            </IconToggle>
            <IconToggle active={repeatMode !== "off"} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>
              <RepeatIcon className="h-4 w-4" />
            </IconToggle>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={skipPrev} size="icon" variant="ghost" className="h-10 w-10 rounded-full hover:bg-white/5 text-zinc-400 hover:text-white">
              <SkipForward className="h-4 w-4 rotate-180" />
            </Button>
            <Button
              size="icon"
              onClick={() => setPlaying(!playing)}
              disabled={!activeSong}
              className="h-12 w-12 rounded-full bg-white text-black hover:bg-zinc-200 shadow-[0_0_30px_rgba(255,255,255,0.2)] disabled:opacity-30 disabled:shadow-none"
            >
              {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5 ml-0.5" fill="currentColor" />}
            </Button>
            <Button onClick={skipNext} size="icon" variant="ghost" className="h-10 w-10 rounded-full hover:bg-white/5 text-zinc-400 hover:text-white">
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <IconToggle active={autoplay} onClick={() => setAutoplay(!autoplay)} title="Autoplay next">
              <Sparkles className="h-4 w-4" />
            </IconToggle>
            <Button
              onClick={voteSkip}
              variant="ghost"
              size="sm"
              disabled={!activeSong}
              className="h-9 px-2.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-md gap-1.5"
              title="Vote to skip"
            >
              <Forward className="h-4 w-4" />
              <span className="text-[11px] font-mono tabular-nums hidden sm:inline">{skipVotes.size}/{votesNeeded}</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-900 flex items-center gap-3">
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
            className="max-w-[180px]"
          />
          <span className="text-[10px] font-mono text-zinc-600 tabular-nums w-7">{muted ? 0 : volume}</span>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
            <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
            Synced
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-900">
          <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 mb-1.5">Now Playing</div>
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <div className="text-base font-medium truncate">{activeSong?.title ?? ""}</div>
              <div className="text-sm text-zinc-400 truncate">{activeSong ? activeSong.artist : ""}</div>
            </div>
            {activeSong?.addedBy && (
              <div className="text-[10px] text-zinc-500 shrink-0 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: avatarColor(activeSong.addedBy) }} />
                {activeSong.addedBy}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
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
                    className={`px-3 py-2 rounded-2xl text-sm break-words ${
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
          ? "bg-white/[0.04] border-zinc-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]"
          : "border-transparent hover:bg-white/[0.02] hover:border-zinc-900"
      } ${dimmed ? "opacity-40" : ""}`}
    >
      {draggable && (
        <div className="text-zinc-700 group-hover:text-zinc-500 cursor-grab active:cursor-grabbing shrink-0">
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <div className="relative h-11 w-11 shrink-0 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden">
        {song.thumbnail ? (
          <img
            src={song.thumbnail}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
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
                className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.04] border border-zinc-800 text-[10px] text-zinc-400 shrink-0"
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
  code,
  setCode,
  username,
  setUsername,
  onJoin,
}: {
  code: string;
  setCode: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  onJoin: () => void;
}) {
  const canJoin = username.trim().length > 0 && code.trim().length > 0;
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
          <p className="text-sm text-zinc-500 text-center mt-2">Listen together. Perfectly in sync.</p>

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

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">Room Code</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="X7A9"
                maxLength={6}
                className="h-12 bg-black border-zinc-800 text-center font-mono text-lg tracking-[0.4em] placeholder:text-zinc-700 focus-visible:ring-1 focus-visible:ring-white/30 focus-visible:border-zinc-700"
              />
            </div>

            <Button
              type="submit"
              disabled={!canJoin}
              className="w-full h-12 bg-white text-black hover:bg-zinc-200 font-medium shadow-[0_0_40px_rgba(255,255,255,0.15)] disabled:opacity-40 disabled:shadow-none"
            >
              Join Room
            </Button>
          </form>

        </div>
      </div>
    </div>
  );
}
