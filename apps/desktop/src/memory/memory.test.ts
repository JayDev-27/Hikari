import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryItem } from "@hikari/protocol";
import { ALL_CHARACTERS, buildQuery, debounce, sameFilter } from "./query";
import { hasMore, initialMemState, isPending, loadingState, memoryErrorKind, memReducer, visibleItems, visibleTotal, type MemAction, type MemState } from "./store";
import { confidenceLabel, countLabel, editedItem, importanceBars, memoryDate, toMs } from "./format";
import { FakeMemoryCore } from "./devCore";

const item = (id: string, text = id, over: Partial<MemoryItem> = {}): MemoryItem => ({ id, kind: "fact", text, ...over });
const run = (actions: MemAction[], s: MemState = initialMemState) => actions.reduce(memReducer, s);

describe("memory query building", () => {
  it("leaves out empty filters and maps the pickers to protocol fields", () => {
    expect(buildQuery({ text: "  ", kind: "all", namespace: ALL_CHARACTERS })).toEqual({ limit: 40, offset: 0 });
    expect(buildQuery({ text: "  chai   ginger ", kind: "fact", namespace: "hiyori", offset: 40, limit: 20 }))
      .toEqual({ q: "chai ginger", kind: "fact", namespace: "hiyori", offset: 40, limit: 20 });
  });

  it("compares filters without paging", () => {
    const a = buildQuery({ text: "x", kind: "self", namespace: "reze" });
    expect(sameFilter(a, { ...a, offset: 80 })).toBe(true);
    expect(sameFilter(a, { ...a, q: "y" })).toBe(false);
    expect(sameFilter(a, { ...a, kind: undefined })).toBe(false);
  });
});

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs only the last call of a burst, after the pause", () => {
    const fn = vi.fn();
    const d = debounce(fn, 250);
    d("c"); vi.advanceTimersByTime(100);
    d("ca"); vi.advanceTimersByTime(100);
    d("caf");
    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("caf");
  });

  it("cancels and flushes", () => {
    const fn = vi.fn();
    const d = debounce(fn, 250);
    d(1); d.cancel(); vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    d(2); d.flush();
    expect(fn).toHaveBeenCalledWith(2);
    d.flush(); // nothing pending: no second call
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("memory list reducer", () => {
  const page1 = [item("a"), item("b"), item("c")];

  it("replaces on a first page and appends next pages without duplicates", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 3 }]);
    expect(loadingState(s)).toBe("first");
    s = run([{ type: "results", items: page1, total: 5 }], s);
    expect(visibleItems(s).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(hasMore(s)).toBe(true);
    s = run([{ type: "query", seq: 2, gen: 1, offset: 3, limit: 3 }], s);
    expect(loadingState(s)).toBe("more");
    s = run([{ type: "results", items: [item("c"), item("d"), item("e")], total: 5 }], s);
    expect(visibleItems(s).map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(hasMore(s)).toBe(false);
    expect(loadingState(s)).toBe("none");
  });

  it("drops a slow answer for a filter the user has moved on from", () => {
    const s = run([
      { type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, // "caf"
      { type: "query", seq: 2, gen: 2, offset: 0, limit: 40 }, // "cafe"
      { type: "results", items: [item("old")], total: 1 },
    ]);
    expect(visibleItems(s)).toEqual([]);
    expect(loadingState(s)).toBe("first");
    const s2 = memReducer(s, { type: "results", items: [item("new")], total: 1 });
    expect(visibleItems(s2).map((i) => i.id)).toEqual(["new"]);
  });

  it("pages by fullness when the core sends no total", () => {
    const s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 2 }, { type: "results", items: [item("a"), item("b")] }]);
    expect(hasMore(s)).toBe(true);
    const s2 = run([{ type: "query", seq: 2, gen: 1, offset: 2, limit: 2 }, { type: "results", items: [item("c")] }], s);
    expect(hasMore(s2)).toBe(false);
  });

  it("shows an edit at once, and rolls it back on failure", () => {
    const loaded = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "results", items: page1, total: 3 }]);
    const edited = memReducer(loaded, { type: "op", op: { opId: 1, seq: 2, kind: "edit", item: item("b", "B!"), prev: item("b") } });
    expect(visibleItems(edited).find((i) => i.id === "b")?.text).toBe("B!");
    expect(isPending(edited, "b")).toBe(true);
    const rolled = memReducer(edited, { type: "opFailed", opId: 1 });
    expect(visibleItems(rolled).find((i) => i.id === "b")?.text).toBe("b");
    expect(isPending(rolled, "b")).toBe(false);
  });

  it("commits an edit once a later query is answered, even if that answer is stale", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "results", items: page1, total: 3 }]);
    s = run([
      { type: "op", op: { opId: 1, seq: 2, kind: "edit", item: item("b", "B!"), prev: item("b") } },
      { type: "query", seq: 3, gen: 1, offset: 0, limit: 40 },
      // The core's answer came from a replica that hadn't caught up: the item still reads "b"…
      { type: "results", items: page1, total: 3 },
    ], s);
    // …the op is settled (no longer pending), and the list shows what the core said.
    expect(s.pending).toEqual([]);
    expect(visibleItems(s).find((i) => i.id === "b")?.text).toBe("b");
  });

  it("keeps an op pending if the answer is to a query sent before it", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }]);
    s = run([{ type: "op", op: { opId: 1, seq: 2, kind: "delete", ids: ["a"] } }, { type: "results", items: page1, total: 3 }], s);
    expect(s.pending).toHaveLength(1);
    expect(visibleItems(s).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("deletes several at once, adjusts the total, and restores them on failure", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "results", items: page1, total: 10 }]);
    s = memReducer(s, { type: "op", op: { opId: 7, seq: 2, kind: "delete", ids: ["a", "c", "not-loaded"] } });
    expect(visibleItems(s).map((i) => i.id)).toEqual(["b"]);
    expect(visibleTotal(s)).toBe(8); // only loaded ids count
    const failed = memReducer(s, { type: "opFailed" });
    expect(visibleItems(failed).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(visibleTotal(failed)).toBe(10);
  });

  it("folds a committed delete into later pages too", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 2 }, { type: "results", items: [item("a"), item("b")], total: 4 }]);
    s = run([
      { type: "op", op: { opId: 1, seq: 2, kind: "delete", ids: ["a"] } },
      { type: "query", seq: 3, gen: 1, offset: 2, limit: 2 },
      { type: "results", items: [item("c"), item("d")], total: 3 },
    ], s);
    expect(s.pending).toEqual([]);
    expect(visibleItems(s).map((i) => i.id)).toEqual(["b", "c", "d"]);
  });

  it("rolls back the oldest op of the kind the core's error names", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "results", items: page1, total: 3 }]);
    s = run([
      { type: "op", op: { opId: 1, seq: 2, kind: "delete", ids: ["a"] } },
      { type: "op", op: { opId: 2, seq: 3, kind: "edit", item: item("b", "B1"), prev: item("b") } },
      { type: "op", op: { opId: 3, seq: 4, kind: "edit", item: item("c", "C1"), prev: item("c") } },
      { type: "opFailed", opKind: "edit" },
    ], s);
    expect(visibleItems(s).map((i) => i.text)).toEqual(["b", "C1"]);
  });

  it("rolls back unconfirmed ops when the core goes away", () => {
    let s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "results", items: page1, total: 3 }]);
    s = run([{ type: "op", op: { opId: 1, seq: 2, kind: "delete", ids: ["a"] } }, { type: "query", seq: 3, gen: 1, offset: 0, limit: 40 }, { type: "offline" }], s);
    expect(visibleItems(s)).toHaveLength(3);
    expect(s.outstanding).toEqual([]);
  });

  it("marks a failed query", () => {
    const s = run([{ type: "query", seq: 1, gen: 1, offset: 0, limit: 40 }, { type: "queryFailed" }]);
    expect(s.failed).toBe(true);
    expect(loadingState(s)).toBe("none");
    expect(hasMore(s)).toBe(false);
  });

  it("accepts an unsolicited refresh from the core", () => {
    const s = run([{ type: "op", op: { opId: 1, seq: 1, kind: "delete", ids: ["x"] } }, { type: "results", items: page1, total: 3 }]);
    expect(s.pending).toEqual([]);
    expect(visibleItems(s)).toHaveLength(3);
  });

  it("reads memory error codes", () => {
    expect(memoryErrorKind("memory.upsert_failed")).toBe("upsert");
    expect(memoryErrorKind("memory_delete_failed")).toBe("delete");
    expect(memoryErrorKind("memory.query_failed")).toBe("query");
    expect(memoryErrorKind("memory.locked")).toBe("other");
    expect(memoryErrorKind("llm.timeout")).toBeNull();
  });
});

describe("memory formatting", () => {
  const now = new Date(2026, 10, 26, 15, 0).getTime();

  it("accepts seconds or milliseconds", () => {
    expect(toMs(1_764_000_000)).toBe(1_764_000_000_000);
    expect(toMs(1_764_000_000_000)).toBe(1_764_000_000_000);
    expect(toMs(undefined)).toBeUndefined();
    expect(toMs(0)).toBeUndefined();
  });

  it("dates like Finder", () => {
    expect(memoryDate(now - 3_600_000, now, "en-GB")).toMatch(/^Today, 14:00$/);
    expect(memoryDate(new Date(2026, 10, 25, 9).getTime(), now)).toBe("Yesterday");
    expect(memoryDate(new Date(2026, 10, 22).getTime(), now, "en-GB")).toBe("Sunday");
    expect(memoryDate(new Date(2026, 2, 3).getTime(), now, "en-GB")).toBe("3 Mar");
    expect(memoryDate(new Date(2025, 2, 3).getTime(), now, "en-GB")).toBe("3 Mar 2025");
    expect(memoryDate(undefined, now)).toBe("");
  });

  it("scales importance and confidence", () => {
    expect([undefined, 0, 0.2, 0.5, 0.9, 7].map(importanceBars)).toEqual([0, 1, 1, 2, 3, 3]);
    expect(confidenceLabel(0.92)).toEqual({ word: "Sure", pct: "92%", level: "high" });
    expect(confidenceLabel(0.3)?.level).toBe("low");
    expect(confidenceLabel(undefined)).toBeUndefined();
  });

  it("stamps an edit in the item's own time unit", () => {
    expect(editedItem(item("a", "x", { createdAt: 1_700_000_000 }), "  new ", 1_764_000_000_123)).toMatchObject({ text: "new", updatedAt: 1_764_000_000 });
    expect(editedItem(item("a", "x", { createdAt: 1_700_000_000_000 }), "new", 1_764_000_000_123).updatedAt).toBe(1_764_000_000_123);
  });

  it("counts", () => {
    expect(countLabel(3, 1, false)).toBe("1 memory");
    expect(countLabel(40, undefined, true)).toBe("40+ memories");
    expect(countLabel(40, 128, true)).toBe("128 memories");
  });
});

describe("dev preview memory core", () => {
  it("filters, pages and applies edits like the real one should", () => {
    const core = new FakeMemoryCore(Date.UTC(2026, 10, 26));
    const all = core.query({ namespace: "hiyori", limit: 40, offset: 0 });
    expect(all.items).toHaveLength(40);
    expect(all.total).toBeGreaterThan(40);
    expect(core.query({ q: "CHAI", kind: "fact", namespace: "hiyori" }).items.map((i) => i.id)).toEqual(["mem-3"]);
    core.handle("memory.delete", { ids: ["mem-3"] });
    expect(core.query({ q: "chai", kind: "fact" }).total).toBe(0);
    core.failNext = true;
    expect(core.handle("memory.upsert", item("mem-1", "x"))[0]).toMatchObject({ type: "error", payload: { code: "memory_upsert_failed" } });
  });
});

describe("incoming results", () => {
  it("keeps only well-formed items", async () => {
    const { cleanItems } = await import("./store");
    expect(cleanItems(undefined)).toEqual([]);
    expect(cleanItems([item("a"), { id: 3, text: "x", kind: "fact" }, { id: "b", text: "y", kind: "rumour" }, null]).map((i) => i.id)).toEqual(["a"]);
  });
});
