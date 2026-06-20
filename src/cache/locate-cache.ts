/**
 * XPath-keyed locate cache, xpath strategy only.
 *
 * Behaviors:
 *  - key = exact prompt string
 *  - match only within the ORIGINAL on-load length, and mark consumed so a
 *    single run never re-matches an entry it just wrote
 *  - xpath validation against the live DOM is the caller's job
 *  - on replan failure, mark stale; the next write REPLACES it in place
 *    instead of appending — a bad entry must not poison reruns
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export type CacheMode = "read" | "write" | "read-write";

export interface LocateCacheEntry {
  type: "locate";
  prompt: string;
  xpaths: string[];
}

interface CacheFile {
  version: 1;
  cacheId: string;
  caches: LocateCacheEntry[];
}

export interface LocateCacheOptions {
  id: string;
  mode?: CacheMode;
  /** directory for the cache file; defaults to `<cwd>/.stars-end-cache` */
  dir?: string;
}

const CACHE_VERSION = 1;

export class LocateCache {
  private readonly id: string;
  private readonly mode: CacheMode;
  private readonly file: string;
  private caches: LocateCacheEntry[] = [];
  /** number of entries present at load — only these are matchable */
  private originalLength = 0;
  private dirty = false;

  /** prompt -> indexes already consumed this run (so we don't re-match) */
  private readonly consumed = new Map<string, Set<number>>();
  /** prompt -> stale indexes awaiting in-place replacement */
  private readonly staleIndices = new Map<string, number[]>();

  constructor(opts: LocateCacheOptions) {
    this.id = opts.id;
    this.mode = opts.mode ?? "read-write";
    const dir = opts.dir ?? join(process.cwd(), ".stars-end-cache");
    this.file = join(dir, `${opts.id}.cache.yaml`);
    this.load();
  }

  private get canRead(): boolean {
    return this.mode === "read" || this.mode === "read-write";
  }
  private get canWrite(): boolean {
    return this.mode === "write" || this.mode === "read-write";
  }

  private load(): void {
    if (!this.canRead || !existsSync(this.file)) {
      this.originalLength = 0;
      return;
    }
    const raw = parseYaml(readFileSync(this.file, "utf8")) as Partial<CacheFile> | null;
    if (!raw || raw.version !== CACHE_VERSION) {
      // version-gate: refuse pre-v1 formats (start fresh, don't crash)
      this.caches = [];
      this.originalLength = 0;
      return;
    }
    this.caches = (raw.caches ?? []).filter((c) => c?.type === "locate" && Array.isArray(c.xpaths));
    this.originalLength = this.caches.length;
  }

  /** Match a locate prompt within the original entries; marks it consumed. */
  matchLocate(prompt: string): LocateCacheEntry | undefined {
    if (!this.canRead) return undefined;
    const consumed = this.consumed.get(prompt) ?? new Set<number>();
    for (let i = 0; i < this.originalLength; i++) {
      const entry = this.caches[i];
      if (entry?.type === "locate" && entry.prompt === prompt && !consumed.has(i)) {
        consumed.add(i);
        this.consumed.set(prompt, consumed);
        return entry;
      }
    }
    return undefined;
  }

  /** Record a locate result, replacing a stale entry in place if one exists. */
  writeLocate(prompt: string, xpaths: string[] | undefined): void {
    if (!this.canWrite || !xpaths?.length) return;
    const record: LocateCacheEntry = { type: "locate", prompt, xpaths };

    const staleList = this.staleIndices.get(prompt);
    const staleIndex = staleList?.pop();
    if (staleIndex !== undefined && this.caches[staleIndex]) {
      this.caches[staleIndex] = record;
    } else {
      this.caches.push(record);
    }
    this.dirty = true;
  }

  /** Mark the most-recently-consumed entry for `prompt` stale, for in-place replace. */
  markStale(prompt: string): void {
    const consumed = this.consumed.get(prompt);
    if (!consumed || consumed.size === 0) return;
    const index = Math.max(...consumed);
    const list = this.staleIndices.get(prompt) ?? [];
    list.push(index);
    this.staleIndices.set(prompt, list);
  }

  /** Persist to disk (YAML). No-op in read-only mode or when unchanged. */
  flush(): void {
    if (!this.canWrite || !this.dirty) return;
    const data: CacheFile = {
      version: CACHE_VERSION,
      cacheId: this.id,
      caches: this.caches,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, stringifyYaml(data), "utf8");
    this.dirty = false;
  }

  /** test/introspection helper */
  get entries(): readonly LocateCacheEntry[] {
    return this.caches;
  }
}
