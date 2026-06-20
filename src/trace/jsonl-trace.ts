/**
 * Thin JSONL trace. The library stays sink-agnostic: write to a file path or an
 * injected callback.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PixelBbox, Point } from "../types.js";

export interface TraceEntry {
  t: number;
  kind: "locate" | "action" | "plan" | "assert" | "query";
  prompt?: string;
  actionType?: string;
  bbox?: PixelBbox;
  point?: Point;
  xpath?: string;
  modelThought?: string;
  cacheHit?: boolean;
  error?: string;
}

export type TraceSink = (entry: TraceEntry) => void;

export interface TraceConfig {
  path?: string;
  sink?: TraceSink;
}

export class Trace {
  private readonly buffer: TraceEntry[] = [];

  constructor(private readonly config?: TraceConfig | false) {}

  record(kind: TraceEntry["kind"], data: Omit<TraceEntry, "t" | "kind">): void {
    if (!this.config) return;
    const entry: TraceEntry = { t: Date.now(), kind, ...data };
    this.config.sink?.(entry);
    if (this.config.path) this.buffer.push(entry);
  }

  async flush(): Promise<void> {
    if (!this.config || !this.config.path || this.buffer.length === 0) return;
    mkdirSync(dirname(this.config.path), { recursive: true });
    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n");
    appendFileSync(this.config.path, `${lines}\n`, "utf8");
    this.buffer.length = 0;
  }
}
