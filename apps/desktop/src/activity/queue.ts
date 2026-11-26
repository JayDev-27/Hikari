import type { ToolRequest } from "@hikari/protocol";
import { CONFIRM_TIMEOUT_S } from "./model";

/**
 * Requests waiting for a yes/no, one dialog at a time. Pure (time is passed in), so the countdown and auto-deny are
 * unit-tested without timers. The countdown of a request starts when it reaches the front, so a request queued behind
 * another still gets the full time in front of the person.
 */
export interface Pending {
  req: ToolRequest;
  turnId?: string;
  arrivedAt: number;
  /** Set when the request reaches the front of the queue. */
  shownAt?: number;
  deadline?: number;
}

export class ConfirmQueue {
  private items: Pending[] = [];
  constructor(private readonly timeoutMs = CONFIRM_TIMEOUT_S * 1000) {}

  /** Add a request. A repeated callId is ignored (returns false). */
  add(req: ToolRequest, now: number, turnId?: string): boolean {
    if (this.items.some((p) => p.req.callId === req.callId)) return false;
    this.items.push({ req, turnId, arrivedAt: now });
    this.front(now);
    return true;
  }

  get current(): Pending | undefined {
    return this.items[0];
  }
  get size(): number {
    return this.items.length;
  }
  get all(): readonly Pending[] {
    return this.items;
  }
  has(callId: string): boolean {
    return this.items.some((p) => p.req.callId === callId);
  }

  /** Remove one request (answered, or resolved elsewhere). The next one starts its countdown at `now`. */
  remove(callId: string, now: number): Pending | undefined {
    const i = this.items.findIndex((p) => p.req.callId === callId);
    if (i < 0) return undefined;
    const [p] = this.items.splice(i, 1);
    this.front(now);
    return p;
  }

  /** Empty the queue (panic, window closed, core gone). */
  clear(): Pending[] {
    const all = this.items;
    this.items = [];
    return all;
  }

  /** Whole seconds left on the front request (rounded up, never negative). */
  secondsLeft(now: number): number {
    const d = this.items[0]?.deadline;
    return d === undefined ? 0 : Math.max(0, Math.ceil((d - now) / 1000));
  }

  /** Requests whose time ran out, removed from the queue (the caller denies them). Only the front one can expire. */
  expire(now: number): Pending[] {
    const out: Pending[] = [];
    while (this.items[0]?.deadline !== undefined && now >= this.items[0].deadline) {
      out.push(this.items.shift()!);
      this.front(now);
    }
    return out;
  }

  private front(now: number): void {
    const p = this.items[0];
    if (p && p.shownAt === undefined) {
      p.shownAt = now;
      p.deadline = now + this.timeoutMs;
    }
  }
}
