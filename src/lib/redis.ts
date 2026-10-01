import { Redis } from "@upstash/redis";

// Define Room state structure
export type Song = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail?: string;
  addedBy?: string;
};

export type RoomState = {
  code: string;
  hostUsername: string;
  hostSessionId: string;
  createdAt: number;
  queue: Song[];
  activeId: string;
  playing: boolean;
  progress: number;
  lastSyncTime: number;
  repeatMode: "off" | "all" | "one";
  shuffle: boolean;
};

// In-memory fallback store when Upstash credentials are not provided
class InMemoryStore {
  private store = new Map<string, { value: string; expiresAt?: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    try {
      return JSON.parse(item.value) as T;
    } catch {
      return item.value as unknown as T;
    }
  }

  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<"OK"> {
    const expiresAt = opts?.ex ? Date.now() + opts.ex * 1000 : undefined;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    this.store.set(key, { value: serialized, expiresAt });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

// Check for Upstash configuration
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Global singleton across hot-reloads in Next.js development
const globalForRedis = globalThis as unknown as {
  redisClient?: Redis | InMemoryStore;
};

export const redis =
  globalForRedis.redisClient ??
  (url && token
    ? new Redis({ url, token })
    : new InMemoryStore());

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redisClient = redis;
}

// Room-specific helper functions
const ROOM_TTL_SECONDS = 60 * 60 * 24; // 24 hours

export async function getRoom(code: string): Promise<RoomState | null> {
  try {
    return await redis.get<RoomState>(`room:${code.toUpperCase()}`);
  } catch (error) {
    console.error(`Error fetching room ${code} from Redis:`, error);
    return null;
  }
}

export async function setRoom(code: string, state: RoomState): Promise<void> {
  try {
    await redis.set(`room:${code.toUpperCase()}`, state, { ex: ROOM_TTL_SECONDS });
  } catch (error) {
    console.error(`Error saving room ${code} to Redis:`, error);
  }
}

export async function deleteRoom(code: string): Promise<void> {
  try {
    await redis.del(`room:${code.toUpperCase()}`);
  } catch (error) {
    console.error(`Error deleting room ${code} from Redis:`, error);
  }
}

// Search cache helper functions (24 hour TTL)
const SEARCH_TTL_SECONDS = 60 * 60 * 24;

export async function getCachedSearch(query: string): Promise<Song[] | null> {
  try {
    const normalized = query.trim().toLowerCase();
    return await redis.get<Song[]>(`search:${normalized}`);
  } catch (error) {
    console.error(`Error fetching search cache for "${query}":`, error);
    return null;
  }
}

export async function setCachedSearch(query: string, results: Song[]): Promise<void> {
  try {
    const normalized = query.trim().toLowerCase();
    await redis.set(`search:${normalized}`, results, { ex: SEARCH_TTL_SECONDS });
  } catch (error) {
    console.error(`Error saving search cache for "${query}":`, error);
  }
}
