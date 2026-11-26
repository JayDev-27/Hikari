import type { MemoryItem } from "@hikari/protocol";

/**
 * The memory list as a reducer: what the core last told us (`base`) plus the user's in-flight edits and deletes
 * (`pending`), which are shown immediately and rolled back if the core reports a failure.
 *
 * Correlation without ids: the panel bridge doesn't carry envelope ids, so `memory.results` are matched to
 * `memory.query`s in the order they were sent (the core answers in order). Every query and every edit/delete gets a
 * sequence number from one counter; a reply to a query sent after an op proves the core saw that op, so the op is
 * committed (folded into `base`). A reply for an older filter (`gen`) is dropped, so a slow answer to "caf" can't
 * replace the results for "cafe".
 */
export type MemOp =
  | { opId: number; seq: number; kind: "edit"; item: MemoryItem; prev: MemoryItem }
  | { opId: number; seq: number; kind: "delete"; ids: string[] };

interface Outstanding {
  seq: number;
  gen: number;
  offset: number;
  limit: number;
}

export interface MemState {
  base: MemoryItem[];
  /** Server total for the current filter, when the core reports one. */
  total?: number;
  /** Was the last page full? (paging hint when the core sends no total) */
  lastPageFull: boolean;
  /** Filter generation: bumps whenever search, kind or namespace change. */
  gen: number;
  outstanding: Outstanding[];
  pending: MemOp[];
  /** Has the current filter been answered at least once? */
  answered: boolean;
  failed: boolean;
}

export type MemAction =
  | { type: "query"; seq: number; gen: number; offset: number; limit: number }
  | { type: "results"; items: MemoryItem[]; total?: number }
  | { type: "queryFailed" }
  | { type: "op"; op: MemOp }
  /** Roll back one op (by id), the oldest op of a kind (the core's error names only the kind), or all. */
  | { type: "opFailed"; opId?: number; opKind?: MemOp["kind"] }
  | { type: "offline" };

export const initialMemState: MemState = { base: [], lastPageFull: false, gen: 0, outstanding: [], pending: [], answered: false, failed: false };

function fold(items: MemoryItem[], op: MemOp): MemoryItem[] {
  if (op.kind === "edit") return items.map((i) => (i.id === op.item.id ? op.item : i));
  const gone = new Set(op.ids);
  return items.filter((i) => !gone.has(i.id));
}

/** Fold every op the core has seen (seq below `seq`) into `base` and drop it from `pending`. */
function commitBefore(s: MemState, seq: number): MemState {
  const done = s.pending.filter((o) => o.seq < seq);
  if (!done.length) return s;
  return { ...s, base: done.reduce(fold, s.base), pending: s.pending.filter((o) => o.seq >= seq) };
}

function appendUnique(base: MemoryItem[], more: MemoryItem[]): MemoryItem[] {
  const seen = new Set(base.map((i) => i.id));
  return [...base, ...more.filter((i) => !seen.has(i.id))];
}

export function memReducer(s: MemState, a: MemAction): MemState {
  switch (a.type) {
    case "query": {
      const q = { seq: a.seq, gen: a.gen, offset: a.offset, limit: a.limit };
      if (a.gen !== s.gen) return { ...s, gen: a.gen, outstanding: [...s.outstanding, q], answered: false, failed: false };
      return { ...s, outstanding: [...s.outstanding, q], failed: false };
    }
    case "results": {
      const [head, ...rest] = s.outstanding;
      if (!head) {
        // Unsolicited (the core pushed a refresh): treat as a fresh first page; everything before it is settled.
        const settled = commitBefore(s, Number.POSITIVE_INFINITY);
        return { ...settled, base: a.items, total: a.total, lastPageFull: false, answered: true, failed: false };
      }
      const next = commitBefore({ ...s, outstanding: rest }, head.seq);
      if (head.gen !== s.gen) return next; // answer for a filter the user has moved on from
      const base = head.offset === 0 ? a.items : appendUnique(next.base, a.items);
      return { ...next, base, total: a.total, lastPageFull: a.items.length >= head.limit, answered: true, failed: false };
    }
    case "queryFailed": {
      const [head, ...rest] = s.outstanding;
      if (!head) return s;
      return head.gen === s.gen ? { ...s, outstanding: rest, answered: true, failed: true } : { ...s, outstanding: rest };
    }
    case "op":
      return { ...s, pending: [...s.pending, a.op] };
    case "opFailed": {
      const victim = a.opId !== undefined ? s.pending.find((o) => o.opId === a.opId) : a.opKind ? s.pending.find((o) => o.kind === a.opKind) : undefined;
      if (a.opId === undefined && !a.opKind) return { ...s, pending: [] };
      return victim ? { ...s, pending: s.pending.filter((o) => o !== victim) } : s;
    }
    case "offline":
      // Unconfirmed edits are rolled back; the next answer after reconnecting shows the truth.
      return { ...s, outstanding: [], pending: [] };
  }
}

/** What the list shows: the server's view with in-flight edits and deletes applied. */
export function visibleItems(s: MemState): MemoryItem[] {
  return s.pending.reduce(fold, s.base);
}

/** Total for the header ("128 memories"), less what's being deleted. Undefined when the core sent no total. */
export function visibleTotal(s: MemState): number | undefined {
  if (s.total === undefined) return undefined;
  const ids = new Set(s.base.map((i) => i.id));
  const deleting = new Set(s.pending.flatMap((o) => (o.kind === "delete" ? o.ids.filter((id) => ids.has(id)) : [])));
  return Math.max(0, s.total - deleting.size);
}

/** Is there another page to fetch? */
export function hasMore(s: MemState): boolean {
  if (!s.answered || s.failed) return false;
  return s.total !== undefined ? s.base.length < s.total : s.lastPageFull;
}

/** Is a query for the current filter in flight? `first` = nothing shown yet for it, `more` = fetching a next page. */
export function loadingState(s: MemState): "none" | "first" | "more" {
  const mine = s.outstanding.filter((q) => q.gen === s.gen);
  if (!mine.length) return "none";
  if (!s.answered) return "first";
  return mine.some((q) => q.offset > 0) ? "more" : "none"; // a silent refresh after an edit isn't "loading"
}

/** Are any of these ids waiting on the core? (dims the row) */
export function isPending(s: MemState, id: string): boolean {
  return s.pending.some((o) => (o.kind === "edit" ? o.item.id === id : o.ids.includes(id)));
}

/**
 * Which memory request an `error` is about, from its code. The core is asked (DECISIONS.md) to use
 * `memory.query_failed`, `memory.upsert_failed`, `memory.delete_failed`; underscores in place of the dot are accepted.
 * Null when the error isn't about memory.
 */
export function memoryErrorKind(code: string): "query" | "upsert" | "delete" | "other" | null {
  const m = /^memory[._](\w+)/.exec(code);
  if (!m) return null;
  const what = m[1].split("_")[0];
  return what === "query" || what === "upsert" || what === "delete" ? what : "other";
}

/** `memory.results` items arrive from another process: keep only well-formed ones. */
export function cleanItems(items: unknown): MemoryItem[] {
  if (!Array.isArray(items)) return [];
  const kinds = new Set(["fact", "episode", "self", "summary"]);
  return items.filter((i): i is MemoryItem => !!i && typeof i === "object" && typeof i.id === "string" && typeof i.text === "string" && kinds.has(i.kind));
}
