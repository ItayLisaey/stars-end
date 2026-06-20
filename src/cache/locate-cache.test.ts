import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocateCache } from "./locate-cache.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stars-end-cache-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed(id: string, entries: Array<{ prompt: string; xpaths: string[] }>) {
  const file = join(dir, `${id}.cache.yaml`);
  const data = {
    version: 1,
    cacheId: id,
    caches: entries.map((e) => ({
      type: "locate",
      prompt: e.prompt,
      xpaths: e.xpaths,
    })),
  };
  writeFileSync(file, JSON.stringify(data)); // YAML is a superset of JSON
}

describe("LocateCache", () => {
  it("hit: matches an existing prompt", () => {
    seed("c1", [{ prompt: "the cart button", xpaths: ["//button[1]"] }]);
    const cache = new LocateCache({ id: "c1", dir });
    expect(cache.matchLocate("the cart button")?.xpaths).toEqual(["//button[1]"]);
  });

  it("miss: unknown prompt returns undefined", () => {
    seed("c1", [{ prompt: "a", xpaths: ["//a"] }]);
    const cache = new LocateCache({ id: "c1", dir });
    expect(cache.matchLocate("b")).toBeUndefined();
  });

  it("does not match entries written during this run", () => {
    const cache = new LocateCache({ id: "fresh", dir });
    cache.writeLocate("the new prompt", ["//div[2]"]);
    // originalLength was 0, so the freshly-written entry is not matchable
    expect(cache.matchLocate("the new prompt")).toBeUndefined();
  });

  it("a repeated prompt matches each original entry only once", () => {
    seed("dup", [
      { prompt: "p", xpaths: ["//x[1]"] },
      { prompt: "p", xpaths: ["//x[2]"] },
    ]);
    const cache = new LocateCache({ id: "dup", dir });
    expect(cache.matchLocate("p")?.xpaths).toEqual(["//x[1]"]);
    expect(cache.matchLocate("p")?.xpaths).toEqual(["//x[2]"]);
    expect(cache.matchLocate("p")).toBeUndefined();
  });

  it("miss then write appends a new entry", () => {
    const cache = new LocateCache({ id: "c2", dir });
    cache.writeLocate("new", ["//new"]);
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0]).toEqual({
      type: "locate",
      prompt: "new",
      xpaths: ["//new"],
    });
  });

  it("stale entry is REPLACED IN PLACE, not appended", () => {
    seed("stale", [{ prompt: "the button", xpaths: ["//bad-xpath"] }]);
    const cache = new LocateCache({ id: "stale", dir });

    // run consumes the cached entry...
    expect(cache.matchLocate("the button")?.xpaths).toEqual(["//bad-xpath"]);
    // ...the action fails and we replan -> mark stale...
    cache.markStale("the button");
    // ...next locate of the same prompt writes the corrected xpath.
    cache.writeLocate("the button", ["//good-xpath"]);

    // exactly one entry, replaced in place (not duplicated)
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0].xpaths).toEqual(["//good-xpath"]);
  });

  it("without markStale, a re-write appends (does not clobber)", () => {
    seed("noreplace", [{ prompt: "x", xpaths: ["//a"] }]);
    const cache = new LocateCache({ id: "noreplace", dir });
    cache.matchLocate("x");
    cache.writeLocate("x", ["//b"]);
    expect(cache.entries).toHaveLength(2);
  });

  it("read mode never writes to disk", () => {
    const cache = new LocateCache({ id: "ro", mode: "read", dir });
    cache.writeLocate("x", ["//x"]);
    cache.flush();
    expect(() => readFileSync(join(dir, "ro.cache.yaml"), "utf8")).toThrow();
  });

  it("flush persists v1 YAML", () => {
    const cache = new LocateCache({ id: "persist", dir });
    cache.writeLocate("x", ["//x"]);
    cache.flush();
    const parsed = parseYaml(readFileSync(join(dir, "persist.cache.yaml"), "utf8"));
    expect(parsed.version).toBe(1);
    expect(parsed.caches[0]).toEqual({
      type: "locate",
      prompt: "x",
      xpaths: ["//x"],
    });
  });

  it("version-gates: refuses a pre-v1 file and starts fresh", () => {
    writeFileSync(
      join(dir, "old.cache.yaml"),
      JSON.stringify({
        version: 0,
        caches: [{ type: "locate", prompt: "x", xpaths: ["//x"] }],
      }),
    );
    const cache = new LocateCache({ id: "old", dir });
    expect(cache.matchLocate("x")).toBeUndefined();
    expect(cache.entries).toHaveLength(0);
  });
});
