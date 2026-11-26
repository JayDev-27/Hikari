import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri, onCore, sendToCore, useCoreStatus } from "../ui/coreBridge";
import { Subscriptions } from "../util/subscriptions";
import { ActionGuard } from "./guard";
import { appendAudit } from "./auditStore";
import { ARM_DELAY_MS, CONFIRM_TIMEOUT_S, HOLD_MS, holdToAllow, keyArgs } from "./model";
import { TierBadge } from "./TierBadge";
import type { Pending } from "./queue";
import "../ui/tokens.css";
import "./activity.css";

/**
 * "Hikari wants to act": the confirm window. Tauri creates it hidden at startup, so this code is always running:
 * it owns the ActionGuard (decisions, the audit log's single writer, the "working" hint for the stage), shows itself
 * when a request needs a yes, and hides when nothing is left. Deny is the default (Return / Escape); Allow needs a
 * deliberate click after a short arming delay, and a press-and-hold for sensitive requests. Unanswered → denied.
 */

const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);

/** Stage hook (owner: stage/avatar, see DECISIONS M7): `activity://working {working, tool?}` to the stage window. */
function signalWorking(working: boolean, tool?: string) {
  if (inTauri()) void emitTo("stage", "activity://working", { working, ...(tool ? { tool } : {}) });
  else window.dispatchEvent(new CustomEvent("activity://working", { detail: { working, tool } }));
}

const clock = () => Date.now();
function createGuard(changed: () => void): ActionGuard {
  return new ActionGuard({
    now: clock,
    confirm: (m) => void sendToCore("tool.confirm", m),
    audit: (r) => void appendAudit(r),
    working: signalWorking,
    changed,
  });
}

function useGuard() {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const guard = useMemo(() => createGuard(render), []);

  useEffect(() => {
    const subs = new Subscriptions();
    subs.add(
      onCore(["tool.request", "tool.result"], (e) => {
        if (e.type === "tool.request") guard.onRequest(e.payload as Parameters<ActionGuard["onRequest"]>[0], e.turnId);
        else guard.onResult(e.payload as Parameters<ActionGuard["onResult"]>[0]);
      }),
    );
    if (inTauri()) {
      subs.add(listen("hotkey://panic", () => guard.panic()));
      // Red close button = Deny for everything waiting (Rust hides the window; it never really closes).
      subs.add(getCurrentWindow().listen("tauri://close-requested", () => guard.denyAll("window_closed")));
    } else if (import.meta.env.DEV) {
      (window as unknown as { hikariPanic: () => void }).hikariPanic = () => guard.panic();
    }
    // Sweep stale "working" calls even while no dialog is up.
    const sweep = window.setInterval(() => guard.sweep(), 15_000);
    subs.add(() => window.clearInterval(sweep));
    return () => subs.dispose();
  }, [guard]);

  // Core gone: nobody is waiting for these answers any more.
  const status = useCoreStatus();
  const wasConnected = useRef(false);
  useEffect(() => {
    if (wasConnected.current && !status.connected) guard.denyAll("disconnected");
    wasConnected.current = status.connected;
  }, [guard, status.connected]);

  return guard;
}

export function Confirm() {
  const guard = useGuard();
  const current = guard.queue.current;
  const waiting = guard.queue.size;
  const [now, setNow] = useState(() => Date.now());

  // Countdown: tick while something is on screen (auto-deny happens in guard.tick).
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => {
      guard.tick();
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(t);
  }, [guard, waiting]);

  // Show + focus on the first request, hide when the queue empties.
  const shown = useRef(false);
  useEffect(() => {
    if (!inTauri()) return;
    const w = getCurrentWindow();
    if (waiting && !shown.current) {
      shown.current = true;
      void w.show().then(() => w.setFocus());
    } else if (!waiting && shown.current) {
      shown.current = false;
      void w.hide();
    }
  }, [waiting]);

  const answer = useCallback((approved: boolean) => current && guard.answer(current.req.callId, approved, "click"), [guard, current]);
  // Escape = Deny, wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !current) return;
      e.preventDefault();
      answer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, current]);

  return (
    <div className={`ac ac-confirm hk${unifiedTitlebar() ? " ac-unified" : ""}`}>
      {unifiedTitlebar() && <div className="ac-titlebar" data-tauri-drag-region />}
      {current ? <Request key={current.req.callId} p={current} now={now} waiting={waiting} onAnswer={answer} /> : <p className="ac-idle">Nothing is waiting for your OK.</p>}
    </div>
  );
}

function Request({ p, now, waiting, onAnswer }: { p: Pending; now: number; waiting: number; onAnswer: (approved: boolean) => void }) {
  const { req } = p;
  const sensitive = holdToAllow(req.tier);
  const args = keyArgs(req.args);
  const left = p.deadline ? Math.max(0, Math.ceil((p.deadline - now) / 1000)) : CONFIRM_TIMEOUT_S;
  const armed = p.shownAt !== undefined && now - p.shownAt >= ARM_DELAY_MS;
  const deny = useRef<HTMLButtonElement>(null);
  useEffect(() => deny.current?.focus(), []);

  return (
    <div className={`ac-req tier-${req.tier}`} role="alertdialog" aria-labelledby="ac-summary" aria-describedby="ac-details">
      <div className="ac-req-head">
        <span className="ac-kicker">Hikari wants to act</span>
        <TierBadge tier={req.tier} />
      </div>
      <h1 id="ac-summary" className="ac-summary">{req.summary || req.tool}</h1>
      <div id="ac-details" className="ac-details">
        <code className="ac-tool">{req.tool}</code>
        {args.map((a, i) => (
          <span key={i} className="ac-arg">
            {a.key && <span className="ac-arg-k">{a.key}</span>}
            <span className="ac-arg-v">{a.value}</span>
          </span>
        ))}
      </div>
      <div className="ac-foot">
        <Countdown left={left} total={CONFIRM_TIMEOUT_S} />
        <span className="ac-foot-text">
          Denies in {left} s{waiting > 1 ? ` · ${waiting - 1} more waiting` : ""}
        </span>
        <span className="ac-spacer" />
        {sensitive ? (
          <HoldButton armed={armed} onDone={() => onAnswer(true)} />
        ) : (
          <button type="button" className="ac-btn" disabled={!armed} onClick={() => onAnswer(true)}>
            Allow
          </button>
        )}
        <button ref={deny} type="button" className="ac-btn ac-btn-default" onClick={() => onAnswer(false)}>
          Deny
        </button>
      </div>
    </div>
  );
}

function Countdown({ left, total }: { left: number; total: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ac-ring${left <= 10 ? " low" : ""}`} viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} className="ac-ring-track" />
      <circle cx="9" cy="9" r={r} className="ac-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - left / total)} transform="rotate(-90 9 9)" />
    </svg>
  );
}

/** Press and hold (pointer, or Space held while focused) for HOLD_MS. Letting go early cancels. */
function HoldButton({ armed, onDone }: { armed: boolean; onDone: () => void }) {
  // Completion is a timer (not frame-driven, so a throttled window can't stretch or skip it); the fill is a CSS transition.
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  const begin = () => {
    if (!armed || timer.current !== undefined) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onDone();
    }, HOLD_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="ac-btn ac-btn-hold"
      disabled={!armed}
      style={{ "--hold-ms": `${holding ? HOLD_MS : 150}ms` } as CSSProperties}
      data-holding={holding || undefined}
      onPointerDown={(e: ReactPointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key !== " ") return;
        e.preventDefault();
        if (!e.repeat) begin();
      }}
      onKeyUp={(e: ReactKeyboardEvent) => {
        if (e.key === " ") stop();
      }}
      // Return / a plain click never approves a sensitive request.
      onClick={(e) => e.preventDefault()}
      aria-label="Hold to allow"
    >
      <span className="ac-hold-fill" aria-hidden="true" />
      <span className="ac-hold-label">{holding ? "Keep holding…" : "Hold to Allow"}</span>
    </button>
  );
}
