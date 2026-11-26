import type { ToolConfirm, ToolRequest, ToolResult } from "@hikari/protocol";
import { ConfirmQueue, type Pending } from "./queue";
import { decisionRecord, needsConfirm, panicRecord, requestRecord, resultRecord, type AuditRecord, type DecisionVia } from "./model";

/**
 * The one place that turns the core's tool traffic into decisions, audit lines and the "working" signal. It lives in
 * the Confirm window, which Tauri creates (hidden) at startup and keeps alive, so it always runs; it is the log's only
 * writer, which keeps one line per event even though every window sees the same messages. Side effects are injected,
 * so the whole flow is unit-tested with fakes.
 */
export interface GuardDeps {
  now(): number;
  /** tool.confirm to the core (through the stage). */
  confirm(msg: ToolConfirm): void;
  audit(r: AuditRecord): void;
  /** Avatar hint: true while at least one approved / unconfirmed call has no result yet. */
  working(on: boolean, tool?: string): void;
  /** The queue changed: show the dialog (something to ask) or hide it (nothing left). */
  changed(): void;
}

/** A call with no result after this long stops counting as "working" (the log still shows it as running). */
export const WORKING_STALE_MS = 3 * 60 * 1000;

export class ActionGuard {
  readonly queue: ConfirmQueue;
  /** callId → { tool, since } for calls that may be running. */
  private running = new Map<string, { tool: string; since: number }>();
  private wasWorking = false;

  constructor(private readonly d: GuardDeps, timeoutMs?: number) {
    this.queue = new ConfirmQueue(timeoutMs);
  }

  onRequest(req: ToolRequest, turnId?: string): void {
    if (this.queue.has(req.callId) || this.running.has(req.callId)) return; // duplicate delivery
    this.d.audit(requestRecord(req, turnId));
    if (needsConfirm(req)) {
      this.queue.add(req, this.d.now(), turnId);
      this.d.changed();
    } else {
      // Read-tier call the core runs without asking: it is already in flight.
      this.running.set(req.callId, { tool: req.tool, since: this.d.now() });
      this.syncWorking();
    }
  }

  onResult(res: ToolResult): void {
    this.d.audit(resultRecord(res));
    this.running.delete(res.callId);
    // A result for a call still on screen means the core settled it some other way (voice yes, its own timeout).
    if (this.queue.remove(res.callId, this.d.now())) this.d.changed();
    this.syncWorking();
  }

  /** The person answered the front dialog. */
  answer(callId: string, approved: boolean, via: Extract<DecisionVia, "click" | "voice"> = "click"): void {
    const p = this.queue.remove(callId, this.d.now());
    if (!p) return;
    this.d.confirm({ callId, approved, via });
    this.d.audit(decisionRecord(callId, approved ? "approved" : "denied", via, this.waited(p)));
    if (approved) this.running.set(callId, { tool: p.req.tool, since: this.d.now() });
    this.d.changed();
    this.syncWorking();
  }

  /** Called every second while the dialog is up: deny what ran out of time. */
  tick(): void {
    const now = this.d.now();
    const gone = this.queue.expire(now);
    for (const p of gone) {
      this.d.confirm({ callId: p.req.callId, approved: false, via: "click" });
      this.d.audit(decisionRecord(p.req.callId, "auto_denied", "timeout", this.waited(p)));
    }
    if (gone.length) this.d.changed();
    this.syncWorking();
  }

  /** ⌘⇧Esc / tray "Stop all actions". The stage already sent tool.confirm {callId:"*", approved:false}; this records it
   *  and drops everything local. */
  panic(): void {
    const pending = this.queue.clear();
    const running = [...this.running.keys()];
    this.running.clear();
    for (const p of pending) this.d.audit(decisionRecord(p.req.callId, "panic", "panic", this.waited(p)));
    this.d.audit(panicRecord(pending.map((p) => p.req.callId), running));
    this.d.changed();
    this.syncWorking();
  }

  /** The dialog was closed with its close button: deny everything still waiting. */
  denyAll(via: Extract<DecisionVia, "window_closed" | "disconnected">): void {
    const pending = this.queue.clear();
    for (const p of pending) {
      if (via === "window_closed") this.d.confirm({ callId: p.req.callId, approved: false, via: "click" });
      this.d.audit(decisionRecord(p.req.callId, via === "window_closed" ? "denied" : "cancelled", via, this.waited(p)));
    }
    if (via === "disconnected") this.running.clear();
    if (pending.length) this.d.changed();
    this.syncWorking();
  }

  get isWorking(): boolean {
    return this.wasWorking;
  }

  private waited(p: Pending): number | undefined {
    return p.shownAt === undefined ? undefined : this.d.now() - p.shownAt;
  }

  private syncWorking(): void {
    const now = this.d.now();
    for (const [id, r] of this.running) if (now - r.since > WORKING_STALE_MS) this.running.delete(id);
    const on = this.running.size > 0;
    if (on === this.wasWorking) return;
    this.wasWorking = on;
    this.d.working(on, on ? [...this.running.values()].at(-1)?.tool : undefined);
  }

  /** For a periodic sweep while nothing else happens (stale running calls). */
  sweep(): void {
    this.syncWorking();
  }
}
