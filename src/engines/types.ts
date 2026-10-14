/** Engine contract shared by all retrieval adapters. */
import type { HttpClient } from "../http/client.ts";
import type { Cooldown, RateBucket } from "../http/limits.ts";
import type { CacheStore } from "../http/cache.ts";

export interface EngineHit {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  author?: string;
}

export interface SearchOpts {
  timeRange?: string; // "day" | "week" | "month" | "year" | "12h" | "3d" ...
  maxResults?: number;
  signal?: AbortSignal;
}

export interface Engine {
  id: string;
  timeRange: boolean;
  search(query: string, opts?: SearchOpts): Promise<EngineHit[]>;
}

export interface EngineDeps {
  http: HttpClient;
  cooldown: Cooldown;
  cache?: CacheStore;
  bucket?: RateBucket;
}

export class QuotaError extends Error {
  constructor(readonly engineId: string, message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export interface EngineConfig {
  enabled: string[];
  searxngInstances: string[];
  proxyByTarget?: Record<string, string>;
}
