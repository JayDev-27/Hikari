import { describe, expect, it } from "vitest";
import type { ToolConfirm, ToolRequest } from "@hikari/protocol";
import { ConfirmQueue } from "./queue";
import { ActionGuard, WORKING_STALE_MS } from "./guard";
import {
  REDACTED,
  buildTimeline,
  decisionRecord,
  filterEntries,
  formatDuration,
  holdToAllow,
  keyArgs,
  needsConfirm,
  panicRecord,
  redact,
  requestRecord,
  resultRecord,
  DEFAULT_FILTER,
  type AuditRecord,
} from "./model";

const req = (callId: string, tier: ToolRequest["tier"] = "act", extra: Partial<ToolRequest> = {}): ToolRequest => ({
  callId,
  tool: "app.open",
  tier,
  summary: `Open VS Code (${callId})`,
  args: { app: "Visual Studio Code" },
  ...extra,
});

describe("tier rules", () => {
  it("asks for act and sensitive, and whenever the core asks", () => {
    expect(needsConfirm({ tier: "read" })).toBe(false);
    expect(needsConfirm({ tier: "read", needsConfirmation: true })).toBe(true);
    expect(needsConfirm({ tier: "act" })).toBe(true);
    // A core that forgets the flag on an action still gets a dialog.
    expect(needsConfirm({ tier: "act", needsConfirmation: false })).toBe(true);
    expect(needsConfirm({ tier: "sensitive", needsConfirmation: false })).toBe(true);
    expect(holdToAllow("sensitive")).toBe(true);
    expect(holdToAllow("act")).toBe(false);
  });
});

describe("redaction and key args", () => {
  it("masks secret-looking keys at any depth and cuts long values", () => {
    const r = redact({ user: "j", password: "hunter2", nested: { apiKey: "sk-1", list: [{ token: "t" }] }, long: "x".repeat(600) }) as { user: string; password: string; long: string; nested: { apiKey: string; list: { token: string }[] } };
    expect(r.password).toBe(REDACTED);
    expect(r.nested.apiKey).toBe(REDACTED);
    expect(r.nested.list[0].token).toBe(REDACTED);
    expect(r.user).toBe("j");
    expect(r.long).toMatch(/… \(600 chars\)$/);
    expect((redact(Array.from({ length: 30 }, (_, i) => i)) as unknown[]).length).toBe(21);
  });

  it("shows the first few args, redacted, with a +N more", () => {
    const a = keyArgs({ a: 1, b: "two", secret: "s", d: { x: 1 }, e: "five", f: "" });
    expect(a).toEqual([
      { key: "a", value: "1" },
      { key: "b", value: "two" },
      { key: "secret", value: REDACTED },
      { key: "d", value: '{"x":1}' },
      { key: "", value: "+1 more" },
    ]);
    expect(keyArgs({ path: "y".repeat(200) })[0].value.length).toBe(80);
  });
});

describe("ConfirmQueue", () => {
  it("counts down only the front request and auto-denies it at the deadline", () => {
    const q = new ConfirmQueue(60_000);
    q.add(req("a"), 0);
    q.add(req("b"), 5_000);
    expect(q.add(req("a"), 6_000)).toBe(false); // duplicate
    expect(q.size).toBe(2);
    expect(q.secondsLeft(30_500)).toBe(30);
    expect(q.expire(59_999)).toEqual([]);
    const gone = q.expire(60_000);
    expect(gone.map((p) => p.req.callId)).toEqual(["a"]);
    // b's countdown starts when it reaches the front, not when it arrived.
    expect(q.current?.req.callId).toBe("b");
    expect(q.current?.shownAt).toBe(60_000);
    expect(q.secondsLeft(60_000)).toBe(60);
  });

  it("removing the front starts the next one's clock", () => {
    const q = new ConfirmQueue(10_000);
    q.add(req("a"), 0);
    q.add(req("b"), 0);
    q.remove("a", 4_000);
    expect(q.current?.deadline).toBe(14_000);
    expect(q.remove("zzz", 5_000)).toBeUndefined();
    expect(q.clear().length).toBe(1);
    expect(q.secondsLeft(0)).toBe(0);
  });
});

function harness(timeoutMs = 60_000) {
  let now = 1_000;
  const sent: ToolConfirm[] = [];
  const log: AuditRecord[] = [];
  const working: [boolean, string?][] = [];
  let changes = 0;
  const g = new ActionGuard(
    {
      now: () => now,
      confirm: (m) => sent.push(m),
      audit: (r) => log.push({ ...r, ts: now } as AuditRecord),
      working: (on, tool) => working.push([on, tool]),
      changed: () => changes++,
    },
    timeoutMs,
  );
  return { g, sent, log, working, now: () => now, advance: (ms: number) => (now += ms), changes: () => changes };
}

describe("ActionGuard", () => {
  it("asks, records the approval, is working until the result", () => {
    const h = harness();
    h.g.onRequest(req("c1"));
    expect(h.g.queue.size).toBe(1);
    expect(h.working).toEqual([]);
    h.advance(2_500);
    h.g.answer("c1", true);
    expect(h.sent).toEqual([{ callId: "c1", approved: true, via: "click" }]);
    expect(h.working).toEqual([[true, "app.open"]]);
    h.advance(800);
    h.g.onResult({ callId: "c1", ok: true, result: { pid: 42 } });
    expect(h.working.at(-1)).toEqual([false, undefined]);
    expect(h.log.map((r) => r.kind)).toEqual(["request", "decision", "result"]);
    expect(h.log[1]).toMatchObject({ decision: "approved", via: "click", waitedMs: 2_500 });
    const { entries } = buildTimeline(h.log);
    expect(entries[0]).toMatchObject({ callId: "c1", status: "succeeded", durationMs: 800 });
  });

  it("runs read-tier calls without asking but still shows working and logs them", () => {
    const h = harness();
    h.g.onRequest(req("r1", "read"));
    expect(h.g.queue.size).toBe(0);
    expect(h.working).toEqual([[true, "app.open"]]);
    h.g.onRequest(req("r1", "read")); // duplicate delivery
    expect(h.log.filter((r) => r.kind === "request").length).toBe(1);
    h.advance(300);
    h.g.onResult({ callId: "r1", ok: false, error: "not found" });
    const e = buildTimeline(h.log).entries[0];
    expect(e).toMatchObject({ status: "failed", durationMs: 300 });
  });

  it("auto-denies after the timeout, one request at a time", () => {
    const h = harness(10_000);
    h.g.onRequest(req("a"));
    h.g.onRequest(req("b", "sensitive"));
    h.advance(10_000);
    h.g.tick();
    expect(h.sent).toEqual([{ callId: "a", approved: false, via: "click" }]);
    expect(h.g.queue.current?.req.callId).toBe("b");
    h.advance(9_000);
    h.g.tick();
    expect(h.sent.length).toBe(1);
    h.advance(1_000);
    h.g.tick();
    expect(h.sent.map((s) => s.callId)).toEqual(["a", "b"]);
    const statuses = buildTimeline(h.log).entries.map((e) => [e.callId, e.status]);
    expect(statuses).toEqual(expect.arrayContaining([["a", "auto_denied"], ["b", "auto_denied"]]));
  });

  it("panic drops the queue and running calls, records it, and stops working (no extra confirms: the stage sent '*')", () => {
    const h = harness();
    h.g.onRequest(req("run"));
    h.g.answer("run", true);
    h.g.onRequest(req("wait1"));
    h.g.onRequest(req("wait2"));
    h.g.panic();
    expect(h.g.queue.size).toBe(0);
    expect(h.sent.length).toBe(1); // only the approval
    expect(h.working.at(-1)?.[0]).toBe(false);
    const panic = h.log.find((r) => r.kind === "panic");
    expect(panic).toMatchObject({ pending: ["wait1", "wait2"], running: ["run"] });
    const { entries, marks } = buildTimeline(h.log);
    expect(entries.every((e) => e.status === "stopped")).toBe(true);
    expect(marks[0].detail).toMatch(/3 calls stopped/);
  });

  it("a result for a call still on screen closes its dialog", () => {
    const h = harness();
    h.g.onRequest(req("v"));
    h.g.onResult({ callId: "v", ok: true });
    expect(h.g.queue.size).toBe(0);
    expect(h.sent).toEqual([]);
  });

  it("closing the window denies everything; a lost core cancels without sending", () => {
    const h = harness();
    h.g.onRequest(req("x"));
    h.g.onRequest(req("y"));
    h.g.denyAll("window_closed");
    expect(h.sent.map((s) => [s.callId, s.approved])).toEqual([["x", false], ["y", false]]);
    h.g.onRequest(req("z"));
    h.g.denyAll("disconnected");
    expect(h.sent.length).toBe(2);
    expect(h.log.at(-1)).toMatchObject({ callId: "z", decision: "cancelled", via: "disconnected" });
  });

  it("stops counting a call with no result as working after the stale cap", () => {
    const h = harness();
    h.g.onRequest(req("slow", "read"));
    h.advance(WORKING_STALE_MS + 1);
    h.g.sweep();
    expect(h.working.at(-1)?.[0]).toBe(false);
    expect(buildTimeline(h.log, { now: h.now() }).entries[0].status).toBe("no_result");
    expect(h.log.map((r) => r.kind)).toEqual(["request"]); // display state is never appended to the audit log
  });

  it("shows an approved action as no result after the shared stale timeout without writing an audit event", () => {
    const h = harness();
    h.g.onRequest(req("approved-stale"));
    h.g.answer("approved-stale", true);
    const auditBefore = [...h.log];

    h.advance(WORKING_STALE_MS + 1);
    h.g.sweep();

    expect(buildTimeline(h.log, { now: h.now() }).entries[0]).toMatchObject({
      callId: "approved-stale",
      status: "no_result",
      decision: { decision: "approved" },
    });
    expect(h.log).toEqual(auditBefore);
    expect(h.log.map((r) => r.kind)).toEqual(["request", "decision"]);
  });

  it("shows a running action as no result immediately after core disconnect without changing the audit log", () => {
    const h = harness();
    h.g.onRequest(req("disconnected"));
    h.g.answer("disconnected", true);
    const auditBefore = [...h.log];

    const { entries } = buildTimeline(h.log, { now: h.now(), coreDisconnected: true });

    expect(entries[0]).toMatchObject({ callId: "disconnected", status: "no_result" });
    expect(h.log).toEqual(auditBefore);
    expect(h.log.some((record) => record.kind === "result")).toBe(false);
  });

  it("ignores answers for calls that are not waiting", () => {
    const h = harness();
    h.g.answer("ghost", true);
    expect(h.sent).toEqual([]);
    expect(h.log).toEqual([]);
  });
});

describe("audit records", () => {
  it("formats requests (redacted), decisions, results and panics", () => {
    expect(requestRecord(req("p", "sensitive", { args: { to: "mom", password: "x" } }), "t1")).toEqual({
      kind: "request",
      callId: "p",
      tool: "app.open",
      tier: "sensitive",
      summary: "Open VS Code (p)",
      args: { to: "mom", password: REDACTED },
      confirm: true,
      turnId: "t1",
    });
    expect(decisionRecord("p", "denied", "click", 1234.6)).toEqual({ kind: "decision", callId: "p", decision: "denied", via: "click", waitedMs: 1235 });
    expect(resultRecord({ callId: "p", ok: false, error: "nope" })).toEqual({ kind: "result", callId: "p", ok: false, error: "nope" });
    expect(resultRecord({ callId: "p", ok: true, result: { token: "abc" } })).toEqual({ kind: "result", callId: "p", ok: true, result: { token: REDACTED } });
    expect(panicRecord([], [])).toEqual({ kind: "panic", pending: [], running: [] });
  });

  it("builds a timeline from out-of-band records (result without request, clear marks)", () => {
    const log: AuditRecord[] = [
      { kind: "cleared", ts: 1 },
      { kind: "result", callId: "orphan", ok: true, ts: 5 },
      { ...requestRecord(req("n")), ts: 10 },
    ];
    const { entries, marks } = buildTimeline(log);
    expect(entries.map((e) => e.callId)).toEqual(["n", "orphan"]);
    expect(entries[1]).toMatchObject({ tool: "(unknown tool)", status: "succeeded" });
    expect(entries[0].status).toBe("awaiting");
    expect(marks).toEqual([{ kind: "cleared", at: 1, detail: "Log cleared" }]);
  });
});

describe("filters", () => {
  const log: AuditRecord[] = [
    { ...requestRecord(req("ok1", "read")), ts: 1 },
    { kind: "result", callId: "ok1", ok: true, ts: 2 },
    { ...requestRecord(req("bad", "act", { tool: "timer.set", summary: "Set a 25-min timer" })), ts: 3 },
    { kind: "decision", callId: "bad", decision: "approved", via: "click", ts: 4 },
    { kind: "result", callId: "bad", ok: false, error: "Clock app missing", ts: 5 },
    { ...requestRecord(req("no", "sensitive")), ts: 6 },
    { kind: "decision", callId: "no", decision: "auto_denied", via: "timeout", ts: 7 },
    { ...requestRecord(req("live", "act")), ts: 8 },
  ];
  const { entries } = buildTimeline(log);
  const ids = (f: Partial<typeof DEFAULT_FILTER>) => filterEntries(entries, { ...DEFAULT_FILTER, ...f }).map((e) => e.callId);

  it("by status group, tier and free text", () => {
    expect(ids({})).toEqual(["live", "no", "bad", "ok1"]);
    expect(ids({ status: "active" })).toEqual(["live"]);
    expect(ids({ status: "done" })).toEqual(["ok1"]);
    expect(ids({ status: "failed" })).toEqual(["bad"]);
    expect(ids({ status: "denied" })).toEqual(["no"]);
    expect(ids({ tier: "sensitive" })).toEqual(["no"]);
    expect(ids({ query: "timer" })).toEqual(["bad"]);
    expect(ids({ query: "clock app" })).toEqual(["bad"]); // matches the error text
    expect(ids({ query: "visual studio" })).toEqual(["live", "no", "bad", "ok1"]); // matches args
    expect(ids({ status: "failed", tier: "read" })).toEqual([]);
  });

  it("formats durations", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(820)).toBe("820 ms");
    expect(formatDuration(4210)).toBe("4.2 s");
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(185_000)).toBe("3 min 05 s");
  });
});
