import type { ToolRequest, ToolResult } from "@hikari/protocol";

/**
 * Pure logic for the agent's safety surface (M7): which requests need a person's yes, what the audit log records,
 * and how the Activity window folds those records into a timeline. No Tauri, no DOM: everything here is unit-tested.
 */

export type Tier = ToolRequest["tier"];

/** Ask the person first? The core's flag, *or* any tier that changes something (defence in depth: a core bug that
 *  forgets the flag on an `act`/`sensitive` call still gets a dialog). */
export function needsConfirm(req: Pick<ToolRequest, "tier" | "needsConfirmation">): boolean {
  return req.needsConfirmation === true || req.tier === "act" || req.tier === "sensitive";
}

/** Sensitive calls need a press-and-hold on Allow, not a click. */
export const holdToAllow = (tier: Tier) => tier === "sensitive";

export const TIER_LABEL: Record<Tier, string> = { read: "Read only", act: "Takes action", sensitive: "Sensitive" };

/** Seconds before an unanswered request is denied on its own. */
export const CONFIRM_TIMEOUT_S = 60;
/** Allow is disabled this long after a request appears, so a keystroke or click meant for another app can't land on it. */
export const ARM_DELAY_MS = 1000;
/** How long Allow must be held for a sensitive request. */
export const HOLD_MS = 1500;
/** A running action with no result is no longer considered live after the same cap used by the avatar. */
export const ACTION_RESULT_STALE_MS = 3 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// Argument display + redaction

const SECRET_KEY = /pass(word|phrase)?|secret|token|api[-_]?key|auth|credential|cookie|session|otp|pin\b|cvv|card[-_]?number|ssn/i;
export const REDACTED = "••••••";

/** Copy of `v` with secret-looking keys masked and long strings / big arrays cut, so the log never holds a password
 *  and one huge result can't blow the size cap. */
export function redact(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 500 ? `${v.slice(0, 500)}… (${v.length} chars)` : v;
  if (v === null || typeof v !== "object") return v;
  if (depth >= 4) return Array.isArray(v) ? `[${v.length} items]` : "{…}";
  if (Array.isArray(v)) {
    const out = v.slice(0, 20).map((x) => redact(x, depth + 1));
    if (v.length > 20) out.push(`… ${v.length - 20} more`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(x, depth + 1);
  return out;
}

/** One-line rendering of an argument value. */
export function argText(v: unknown, max = 80): string {
  const s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The few arguments worth showing in the dialog (redacted, in the order the core sent them). */
export function keyArgs(args: Record<string, unknown> | undefined, limit = 4): { key: string; value: string }[] {
  const safe = redact(args ?? {}) as Record<string, unknown>;
  const entries = Object.entries(safe).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const shown = entries.slice(0, limit).map(([key, v]) => ({ key, value: argText(v) }));
  if (entries.length > limit) shown.push({ key: "", value: `+${entries.length - limit} more` });
  return shown;
}

// ---------------------------------------------------------------------------------------------------------------
// Audit records (one JSON object per line; the Rust side stamps `ts` itself and refuses anything else)

export type Decision = "approved" | "denied" | "auto_denied" | "panic" | "cancelled";
export type DecisionVia = "click" | "voice" | "timeout" | "panic" | "window_closed" | "disconnected";

interface Base {
  /** Milliseconds since the epoch, stamped by `audit.rs` when the line is written. */
  ts?: number;
}
export interface RequestRecord extends Base {
  kind: "request";
  callId: string;
  tool: string;
  tier: Tier;
  summary: string;
  args: unknown;
  /** Did this UI ask the person (see `needsConfirm`)? */
  confirm: boolean;
  turnId?: string;
}
export interface DecisionRecord extends Base {
  kind: "decision";
  callId: string;
  decision: Decision;
  via: DecisionVia;
  /** Time the dialog was in front of the person before they answered. */
  waitedMs?: number;
}
export interface ResultRecord extends Base {
  kind: "result";
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
export interface PanicRecord extends Base {
  kind: "panic";
  /** Calls that were waiting for an answer or still running when the panic fired. */
  pending: string[];
  running: string[];
}
/** Written by Rust only, after a clear the person confirmed in a native dialog. */
export interface ClearedRecord extends Base {
  kind: "cleared";
}
export type AuditRecord = RequestRecord | DecisionRecord | ResultRecord | PanicRecord | ClearedRecord;

export function requestRecord(req: ToolRequest, turnId?: string): RequestRecord {
  return {
    kind: "request",
    callId: req.callId,
    tool: req.tool,
    tier: req.tier,
    summary: req.summary,
    args: redact(req.args ?? {}),
    confirm: needsConfirm(req),
    ...(turnId ? { turnId } : {}),
  };
}

export function decisionRecord(callId: string, decision: Decision, via: DecisionVia, waitedMs?: number): DecisionRecord {
  return { kind: "decision", callId, decision, via, ...(waitedMs !== undefined ? { waitedMs: Math.round(waitedMs) } : {}) };
}

export function resultRecord(res: ToolResult): ResultRecord {
  return {
    kind: "result",
    callId: res.callId,
    ok: res.ok,
    ...(res.result !== undefined ? { result: redact(res.result) } : {}),
    ...(res.error ? { error: String(res.error).slice(0, 2000) } : {}),
  };
}

export function panicRecord(pending: string[], running: string[]): PanicRecord {
  return { kind: "panic", pending, running };
}

// ---------------------------------------------------------------------------------------------------------------
// Timeline (Activity window)

export type Status = "awaiting" | "running" | "no_result" | "succeeded" | "failed" | "denied" | "auto_denied" | "stopped" | "unknown";

export const STATUS_LABEL: Record<Status, string> = {
  awaiting: "Waiting for you",
  running: "Running",
  no_result: "No result",
  succeeded: "Done",
  failed: "Failed",
  denied: "Denied",
  auto_denied: "Timed out",
  stopped: "Stopped",
  unknown: "No request seen",
};

export interface Entry {
  callId: string;
  tool: string;
  tier?: Tier;
  summary: string;
  args?: unknown;
  status: Status;
  /** First time this call was seen (request, or the earliest record for it). */
  at: number;
  decision?: DecisionRecord;
  result?: ResultRecord;
  /** Approval (or request, for calls that didn't need one) to result. */
  durationMs?: number;
}

export interface TimelineMark {
  kind: "panic" | "cleared";
  at: number;
  detail: string;
}

/** Inputs used only to derive display state; none of this is written back to the audit log. */
export interface TimelineOptions {
  now?: number;
  /** Set when this Activity window has observed the core disconnect. */
  coreDisconnected?: boolean;
}

/** Fold the log into one entry per call (newest first), plus panic / clear marks. */
export function buildTimeline(records: AuditRecord[], options: TimelineOptions = {}): { entries: Entry[]; marks: TimelineMark[] } {
  const byId = new Map<string, Entry & { startedAt?: number }>();
  const marks: TimelineMark[] = [];
  const get = (callId: string, ts: number) => {
    let e = byId.get(callId);
    if (!e) {
      e = { callId, tool: "(unknown tool)", summary: "", status: "unknown", at: ts };
      byId.set(callId, e);
    }
    return e;
  };
  for (const r of records) {
    const ts = r.ts ?? 0;
    switch (r.kind) {
      case "request": {
        const e = get(r.callId, ts);
        Object.assign(e, { tool: r.tool, tier: r.tier, summary: r.summary, args: r.args, at: Math.min(e.at, ts) });
        if (e.status === "unknown") e.status = r.confirm ? "awaiting" : "running";
        if (!r.confirm) e.startedAt = ts;
        break;
      }
      case "decision": {
        const e = get(r.callId, ts);
        e.decision = r;
        if (e.result) break;
        if (r.decision === "approved") {
          e.status = "running";
          e.startedAt = ts;
        } else e.status = r.decision === "denied" ? "denied" : r.decision === "auto_denied" ? "auto_denied" : "stopped";
        break;
      }
      case "result": {
        const e = get(r.callId, ts);
        e.result = r;
        e.status = r.ok ? "succeeded" : "failed";
        if (e.startedAt !== undefined) e.durationMs = Math.max(0, ts - e.startedAt);
        break;
      }
      case "panic":
        for (const id of [...r.pending, ...r.running]) {
          const e = byId.get(id);
          if (e && (e.status === "awaiting" || e.status === "running")) e.status = "stopped";
        }
        marks.push({ kind: "panic", at: ts, detail: panicDetail(r) });
        break;
      case "cleared":
        marks.push({ kind: "cleared", at: ts, detail: "Log cleared" });
        break;
    }
  }
  // A missing result is a presentation state, not an audit event. Keep the source records untouched so
  // the log remains a record of events that actually happened.
  for (const e of byId.values()) {
    if (e.status !== "running") continue;
    const startedAt = e.decision?.decision === "approved" ? (e.decision.ts ?? e.at) : e.at;
    const stale = options.now !== undefined && options.now - startedAt > ACTION_RESULT_STALE_MS;
    if (options.coreDisconnected || stale) e.status = "no_result";
  }

  const entries: Entry[] = [...byId.values()]
    .map((e) => {
      delete e.startedAt;
      return e;
    })
    .sort((a, b) => b.at - a.at);
  return { entries, marks: marks.sort((a, b) => b.at - a.at) };
}

function panicDetail(r: PanicRecord): string {
  const n = r.pending.length + r.running.length;
  return n ? `Stop all actions: ${n} call${n === 1 ? "" : "s"} stopped` : "Stop all actions (nothing was running)";
}

export interface Filter {
  status: "all" | "active" | "done" | "failed" | "denied";
  tier: "all" | Tier;
  query: string;
}
export const DEFAULT_FILTER: Filter = { status: "all", tier: "all", query: "" };

const STATUS_GROUP: Record<Status, Filter["status"]> = {
  awaiting: "active",
  running: "active",
  no_result: "done",
  succeeded: "done",
  failed: "failed",
  unknown: "done",
  denied: "denied",
  auto_denied: "denied",
  stopped: "denied",
};

export function filterEntries(entries: Entry[], f: Filter): Entry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.status !== "all" && STATUS_GROUP[e.status] !== f.status) return false;
    if (f.tier !== "all" && e.tier !== f.tier) return false;
    if (!q) return true;
    const hay = [e.tool, e.summary, e.callId, e.result?.error ?? "", JSON.stringify(e.args ?? "")].join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/** "820 ms", "4.2 s", "3 min 05 s". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")} s`;
}
