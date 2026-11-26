import { useEffect, useMemo, useReducer, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { activeCharacterId, setActiveCharacterId, type CharacterPack } from "../avatar/characters";
import { builtinPacks } from "../avatar/packs";
import { inTauri, useCoreStatus, type CoreStatus } from "../ui/coreBridge";
import { Subscriptions } from "../util/subscriptions";
import { characterHue, initials } from "../studio/format";
import { openPermissionSettings, relaunchApp, requestPermission, usePermissions } from "./permissions";
import {
  PERMISSIONS,
  STEPS,
  STEP_TITLES,
  flow,
  permissionSummary,
  permissionView,
  permissionsContinueLabel,
  restoreFlow,
  stepIndex,
  tagline,
  type PermissionId,
  type PermissionInfo,
  type PermissionReport,
  type StepId,
} from "./steps";
import "../ui/tokens.css";
import "./onboarding.css";

const SAVED = "hikari.onboarding";
const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const devPreview = () => import.meta.env.DEV && !inTauri();
const stepEyebrow = (s: StepId) => `Step ${stepIndex(s) + 1} of ${STEPS.length}`;
const hueStyle = (id: string) => ({ "--hue": characterHue(id) }) as CSSProperties;

function loadFlow() {
  try {
    return restoreFlow(localStorage.getItem(SAVED));
  } catch {
    return restoreFlow(null);
  }
}

/** First-run welcome: meet a character, grant permissions (checked live), brain status, push-to-talk, done. */
export function Onboarding() {
  const [state, dispatch] = useReducer(flow, undefined, loadFlow);
  const { step } = state;
  const { report } = usePermissions(step === "permissions");
  const realCore = useCoreStatus();
  const [devCore, setDevCore] = useState<CoreStatus | null>(null);
  const core = devCore ?? realCore;
  const packs = useMemo(() => builtinPacks().filter((p) => p.modelUrl), []);
  const [characterId, setCharacterId] = useState(activeCharacterId);
  const character = packs.find((p) => p.id === characterId) ?? packs[0];

  // Resume where the user left off (e.g. after "Reopen Hikari" for Screen Recording).
  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  // Settings' "Show Welcome Again" (Rust `onboarding_open`) restarts from the top.
  useEffect(() => {
    if (!inTauri()) return;
    const subs = new Subscriptions();
    subs.add(listen("onboarding://restart", () => dispatch({ type: "restart" })));
    return () => subs.dispose();
  }, []);

  const pick = (p: CharacterPack) => {
    setCharacterId(p.id);
    setActiveCharacterId(p.id);
    if (inTauri()) void emitTo("stage", "character://select", p.id);
  };

  const finish = async () => {
    if (inTauri()) await invoke("onboarding_finish");
    try {
      localStorage.removeItem(SAVED);
    } catch {
      /* ignore */
    }
    dispatch({ type: "restart" });
  };

  const next = () => (step === "done" ? void finish() : dispatch({ type: "next" }));
  const primary: Record<StepId, string> = {
    welcome: "Get Started",
    character: `Continue with ${character?.displayName ?? "Her"}`,
    permissions: permissionsContinueLabel(report),
    brain: "Continue",
    talk: "Continue",
    done: "Start Using Hikari",
  };

  // ↩ continues, ⌘[ goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.repeat && !(e.target instanceof HTMLButtonElement)) next();
      else if (e.metaKey && e.key === "[") dispatch({ type: "back" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={`hk ob${unifiedTitlebar() ? " ob-unified" : ""}`}>
      <div className="ob-titlebar" data-tauri-drag-region />
      <aside className="ob-side">
        <div className="ob-brand">
          <Sakura />
          <span>Hikari</span>
        </div>
        <ol className="ob-steps">
          {STEPS.map((s) => {
            const i = stepIndex(s);
            const cls = s === step ? "cur" : i <= stepIndex(state.reached) ? "seen" : "";
            const done = i < stepIndex(state.reached) && s !== step;
            return (
              <li key={s}>
                <button className={`ob-step ${cls}`} disabled={i > stepIndex(state.reached)} onClick={() => dispatch({ type: "goto", step: s })}>
                  <span className="ob-step-dot">{done ? <IconCheck /> : i + 1}</span>
                  {STEP_TITLES[s]}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="ob-side-foot">You can open this again from Settings.</p>
      </aside>

      <main className="ob-main">
        <section className="ob-page" key={step}>
          {step === "welcome" && <Welcome packs={packs} />}
          {step === "character" && <Character packs={packs} selected={character?.id} onPick={pick} />}
          {step === "permissions" && <Permissions report={report} />}
          {step === "brain" && <Brain core={core} />}
          {step === "talk" && <Talk />}
          {step === "done" && <Done character={character} report={report} core={core} />}
        </section>
        <footer className="ob-foot">
          {step !== "welcome" && (
            <button className="ob-btn ob-btn-plain" onClick={() => dispatch({ type: "back" })}>
              Back
            </button>
          )}
          <span className="ob-grow" />
          {devPreview() && (
            <button className="ob-btn ob-btn-plain ob-dev" onClick={() => setDevCore((c) => (c?.connected ? { connected: false, reason: "core not running" } : { connected: true }))}>
              Preview: brain {core.connected ? "online" : "offline"}
            </button>
          )}
          <button className="ob-btn ob-btn-primary" onClick={next} autoFocus>
            {primary[step]}
          </button>
        </footer>
      </main>
    </div>
  );
}

function Header({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="ob-head">
      {eyebrow && <p className="ob-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {children && <p className="ob-lede">{children}</p>}
    </header>
  );
}

function Avatar({ p, size }: { p: CharacterPack; size: number }) {
  const [broken, setBroken] = useState(false);
  const img = p.avatarUrl && !broken;
  return (
    <span className={`ob-avatar${img ? " has-img" : ""}`} style={{ ...hueStyle(p.id), width: size, height: size, fontSize: size * 0.36 }}>
      {img ? <img src={p.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} /> : initials(p.displayName)}
    </span>
  );
}

// ---------- steps ----------

function Welcome({ packs }: { packs: CharacterPack[] }) {
  const cast = packs.slice(0, 5);
  return (
    <>
      <div className="ob-hero">
        <div className="ob-cast">
          {cast.map((p, i) => (
            <span key={p.id} style={{ "--i": i, "--n": cast.length } as CSSProperties}>
              <Avatar p={p} size={i === Math.floor(cast.length / 2) ? 92 : 72} />
            </span>
          ))}
        </div>
      </div>
      <Header title="Welcome to Hikari">A companion who lives on your desktop, talks with you, and remembers what matters.</Header>
      <ul className="ob-features">
        <Feature icon={<IconSpark />} title="On your desktop">
          She stands beside your windows and stays out of the way. Clicks go through to whatever is behind her.
        </Feature>
        <Feature icon={<IconWave />} title="Talk or type">
          Hold <kbd>⌥</kbd> <kbd>Space</kbd> to talk, or chat from the menu bar.
        </Feature>
        <Feature icon={<IconLock />} title="Private by default">
          Voice, memories and her brain run on this Mac unless you add a cloud provider.
        </Feature>
      </ul>
    </>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="ob-feature-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <span className="ob-sub">{children}</span>
      </span>
    </li>
  );
}

function Character({ packs, selected, onPick }: { packs: CharacterPack[]; selected?: string; onPick: (p: CharacterPack) => void }) {
  const taglines = useMemo(() => new Map(packs.map((p) => [p.id, tagline(p.personaText)])), [packs]);
  return (
    <>
      <Header eyebrow={stepEyebrow("character")} title="Meet your companion">
        They appear on your desktop right away. Switch any time in Character Studio.
      </Header>
      <div className="ob-cards" role="radiogroup" aria-label="Character">
        {packs.map((p) => (
          <button key={p.id} role="radio" aria-checked={p.id === selected} className={`ob-card${p.id === selected ? " sel" : ""}`} style={hueStyle(p.id)} onClick={() => onPick(p)}>
            <Avatar p={p} size={44} />
            <span className="ob-card-text">
              <strong>{p.displayName}</strong>
              <span className="ob-sub">{taglines.get(p.id)}</span>
            </span>
            {p.id === selected && (
              <span className="ob-card-check">
                <IconCheck />
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function Permissions({ report }: { report: PermissionReport | null }) {
  return (
    <>
      <Header eyebrow={stepEyebrow("permissions")} title="A few permissions">
        Hikari only needs the microphone to talk. The other two are for Mac control, where she works other apps for you, and you can skip them.
      </Header>
      <div className="ob-group">
        {PERMISSIONS.map((p) => (
          <PermissionRow key={p.id} info={p} status={report?.[p.id]} />
        ))}
      </div>
      <p className="ob-note">
        <span className="ob-pulse" /> Checked live: allow Hikari in System Settings and this page updates by itself.
      </p>
    </>
  );
}

function PermIcon({ id }: { id: PermissionId }) {
  return id === "microphone" ? <IconMic /> : id === "accessibility" ? <IconAccess /> : <IconScreen />;
}

function PermissionRow({ info, status }: { info: PermissionInfo; status?: PermissionReport[PermissionId] }) {
  const view = status ? permissionView(info.id, status) : null;
  const [asked, setAsked] = useState(false);
  const act = () => {
    if (!view?.action) return;
    setAsked(true);
    void (view.action === "request" ? requestPermission(info.id) : openPermissionSettings(info.id));
  };
  const relaunch = info.id === "screenRecording" && status === "denied" && asked;
  return (
    <div className={`ob-perm ob-perm-${info.id}`}>
      <span className="ob-perm-icon"><PermIcon id={info.id} /></span>
      <span className="ob-perm-text">
        <span className="ob-perm-name">
          {info.name}
          <span className={`ob-tag${info.optional ? "" : " req"}`}>{info.optional ? "Optional · Mac control" : "Needed to talk"}</span>
        </span>
        <span className="ob-sub">{info.why}</span>
        {view?.hint && <span className={`ob-hint ${view.tone}`}>{view.hint}</span>}
      </span>
      <span className="ob-perm-side">
        {view ? (
          <span className={`ob-pill ${view.tone}`} aria-live="polite">
            {view.tone === "ok" && <IconCheck />}
            {view.label}
          </span>
        ) : (
          <span className="ob-pill muted">Checking…</span>
        )}
        {relaunch ? (
          <button className="ob-btn" onClick={() => void relaunchApp()}>
            Reopen Hikari
          </button>
        ) : (
          view?.action && (
            <button className="ob-btn" onClick={act}>
              {view.actionLabel}
            </button>
          )
        )}
      </span>
    </div>
  );
}

function Brain({ core }: { core: CoreStatus }) {
  return (
    <>
      <Header eyebrow={stepEyebrow("brain")} title="Her brain">
        Listening, thinking and her voice run in a separate service on this Mac, Hikari's core.
      </Header>
      <div className={`ob-status ${core.connected ? "on" : "off"}`} aria-live="polite">
        <span className="ob-status-dot" />
        <span>
          <strong>{core.connected ? "Connected" : "Not running yet"}</strong>
          <span className="ob-sub">{core.connected ? "The core is running on this Mac. She's ready to talk." : "That's fine. This updates by itself as soon as the core starts."}</span>
        </span>
      </div>
      {!core.connected && (
        <ul className="ob-list">
          <li>She still lives on your desktop and reacts when you pat or drag her.</li>
          <li>Double-click her, or press and release <kbd>⌥</kbd> <kbd>Space</kbd>, to hear a short demo reply.</li>
          <li>Once the core runs she answers for real, and remembers what you tell her.</li>
        </ul>
      )}
    </>
  );
}

function Talk() {
  const [down, setDown] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let held = false;
    const press = (pressed: boolean) => {
      if (held && !pressed) setTries((n) => n + 1);
      held = pressed;
      setDown(pressed);
    };
    const subs = new Subscriptions();
    // The global hotkey (works even when this window is in front).
    if (inTauri()) subs.add(listen<{ pressed: boolean }>("hotkey://ptt", (e) => press(e.payload.pressed)));
    // Browser preview: the same chord pressed in this page.
    const kd = (e: KeyboardEvent) => e.altKey && e.code === "Space" && !inTauri() && (e.preventDefault(), press(true));
    const ku = (e: KeyboardEvent) => (e.code === "Space" || e.key === "Alt") && !inTauri() && press(false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      subs.dispose();
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);
  const status = down ? "Listening… speak, then let go." : tries ? "Nice. Every time you let go, she answers." : "Try it now: hold ⌥Space.";
  return (
    <>
      <Header eyebrow={stepEyebrow("talk")} title="Hold to talk">
        Hold the shortcut while you speak and let go when you're done. It works from any app.
      </Header>
      <div className={`ob-keys${down ? " down" : ""}${tries ? " tried" : ""}`}>
        <span className="ob-key">
          <span className="ob-key-glyph">⌥</span>
          <span className="ob-key-label">option</span>
        </span>
        <span className="ob-plus">+</span>
        <span className="ob-key ob-key-wide">
          <span className="ob-key-label">space</span>
        </span>
      </div>
      <p className={`ob-try${tries ? " ok" : ""}`} aria-live="polite">
        {tries > 0 && !down && <IconCheck />}
        {status}
      </p>
      <div className="ob-shortcuts">
        <Shortcut keys={["⌥", "Space"]} label="Press while she talks to interrupt" />
        <Shortcut keys={["⌘", "⇧", "M"]} label="Mute the microphone" />
        <Shortcut keys={["⌘", "⇧", "Esc"]} label="Stop everything she's doing" />
      </div>
    </>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="ob-shortcut">
      <span className="ob-shortcut-keys">
        {keys.map((k) => (
          <kbd key={k}>{k}</kbd>
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

function Done({ character, report, core }: { character?: CharacterPack; report: PermissionReport | null; core: CoreStatus }) {
  return (
    <>
      <div className="ob-done-mark">
        <IconCheck />
      </div>
      <Header title="You're all set">Find Hikari in the menu bar: Chat, Character Studio and Settings live there.</Header>
      <div className="ob-group ob-summary">
        {character && (
          <div className="ob-summary-row">
            <Avatar p={character} size={30} />
            <span>
              <strong>{character.displayName}</strong>
              <span className="ob-sub">On your desktop</span>
            </span>
          </div>
        )}
        <div className="ob-summary-row">
          <span className="ob-summary-icon">
            <IconMic />
          </span>
          <span>
            <strong>Permissions</strong>
            <span className="ob-sub">{permissionSummary(report) || "Checking…"}</span>
          </span>
        </div>
        <div className="ob-summary-row">
          <span className={`ob-summary-icon ${core.connected ? "on" : ""}`}>
            <IconSpark />
          </span>
          <span>
            <strong>Brain</strong>
            <span className="ob-sub">{core.connected ? "Connected" : "Offline for now. She plays demo replies until the core runs."}</span>
          </span>
        </div>
      </div>
    </>
  );
}

// ---------- icons (SF Symbols spirit: round caps, currentColor) ----------

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const IconCheck = () => (
  <svg {...base}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);
const IconMic = () => (
  <svg {...base}>
    <rect x="5.5" y="1.8" width="5" height="8" rx="2.5" />
    <path d="M3.2 7.6a4.8 4.8 0 0 0 9.6 0M8 12.4v2" />
  </svg>
);
const IconAccess = () => (
  <svg {...base}>
    <circle cx="8" cy="2.9" r="1.3" fill="currentColor" stroke="none" />
    <path d="M2.8 5.4c1.7.5 3.4.8 5.2.8s3.5-.3 5.2-.8M8 6.2v3.3m0 0-2.2 4.8M8 9.5l2.2 4.8" />
  </svg>
);
const IconScreen = () => (
  <svg {...base}>
    <rect x="1.8" y="2.6" width="12.4" height="8.6" rx="1.6" />
    <path d="M5.6 14h4.8M8 11.2V14" />
    <circle cx="8" cy="6.9" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
const IconSpark = () => (
  <svg {...base}>
    <path d="M8 1.8c.4 3.1 1.6 4.3 4.7 4.7-3.1.4-4.3 1.6-4.7 4.7-.4-3.1-1.6-4.3-4.7-4.7C6.4 6.1 7.6 4.9 8 1.8Z" />
    <path d="M12.6 10.6c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2Z" />
  </svg>
);
const IconWave = () => (
  <svg {...base}>
    <path d="M2 8h.01M4.7 5.6v4.8M7.4 3v10M10.1 5v6M12.8 6.8v2.4" />
  </svg>
);
const IconLock = () => (
  <svg {...base}>
    <rect x="3" y="7" width="10" height="7" rx="1.8" />
    <path d="M5.3 7V5.1a2.7 2.7 0 0 1 5.4 0V7" />
  </svg>
);
/** Five-petal sakura, Hikari's mark. */
const Sakura = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    {[0, 72, 144, 216, 288].map((r) => (
      <path key={r} transform={`rotate(${r} 12 12)`} d="M12 12c-2.6-1.6-3.6-4.4-2.6-7 .6-1.4 1.6-2 2.6-1.2 1-.8 2-.2 2.6 1.2 1 2.6 0 5.4-2.6 7Z" fill="var(--st-accent)" />
    ))}
    <circle cx="12" cy="12" r="1.6" fill="#fff" opacity="0.9" />
  </svg>
);
