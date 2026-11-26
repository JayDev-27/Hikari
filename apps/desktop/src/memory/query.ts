import type { MemoryItem, MemoryQuery } from "@hikari/protocol";

export type MemoryKind = MemoryItem["kind"];
/** The kind filter in the sidebar: one kind, or every kind. */
export type KindFilter = MemoryKind | "all";

export const KINDS: { id: KindFilter; label: string; hint: string }[] = [
  { id: "all", label: "All Memories", hint: "Everything she remembers" },
  { id: "fact", label: "Facts", hint: "Things she knows about you" },
  { id: "episode", label: "Episodes", hint: "Moments you shared" },
  { id: "self", label: "About Her", hint: "What she has learned about herself" },
  { id: "summary", label: "Summaries", hint: "Condensed conversations" },
];
export const kindLabel: Record<MemoryKind, string> = { fact: "Fact", episode: "Episode", self: "About her", summary: "Summary" };

/** Namespace picker value meaning "every character" (the query then has no namespace). */
export const ALL_CHARACTERS = "*";
export const PAGE_SIZE = 40;
/** Typing pause before a search is sent. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface QueryInput {
  text: string;
  kind: KindFilter;
  namespace: string;
  offset?: number;
  limit?: number;
}

/** The `memory.query` payload for what the user picked. Empty fields are left out, so the core sees "no filter". */
export function buildQuery({ text, kind, namespace, offset = 0, limit = PAGE_SIZE }: QueryInput): MemoryQuery {
  const q: MemoryQuery = { limit, offset };
  const t = text.trim().replace(/\s+/g, " ");
  if (t) q.q = t;
  if (kind !== "all") q.kind = kind;
  if (namespace && namespace !== ALL_CHARACTERS) q.namespace = namespace;
  return q;
}

/** Same filter (ignoring paging)? A change means the list starts over. */
export function sameFilter(a: MemoryQuery, b: MemoryQuery): boolean {
  return (a.q ?? "") === (b.q ?? "") && a.kind === b.kind && a.namespace === b.namespace;
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Drop a pending call. */
  cancel(): void;
  /** Run a pending call now. */
  flush(): void;
}

/** Trailing-edge debounce: only the last call in a burst runs, `ms` after the burst ends. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: A | undefined;
  const run = () => {
    timer = undefined;
    const args = last;
    last = undefined;
    if (args) fn(...args);
  };
  const d = ((...args: A) => {
    last = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, ms);
  }) as Debounced<A>;
  d.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    last = undefined;
  };
  d.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  return d;
}
