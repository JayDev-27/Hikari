import { useCallback, useEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ErrorInfo, Language, VoiceLabEvent } from "@hikari/protocol";
import { inTauri, onCore } from "../ui/coreBridge";
import { usePanelLink } from "../memory/link";
import { characterHue, initials, languageName } from "../studio/format";
import { IconCheck, IconPlus, IconTrash, IconWarn } from "../studio/icons";
import { canRecord } from "./consent";
import { canTrain, newVoiceId, OPS, voiceStatusLabel, type Voice } from "./ops";
import { consentOf, initialUi, uiReducer } from "./state";
import { FakeVoiceLabCore } from "./devCore";
import { ConsentFlow } from "./ConsentFlow";
import { RecordSession } from "./RecordSession";
import { EvalReportView, TrainPanel } from "./TrainPanel";
import { AbPlayer } from "./AbPlayer";
import { IconLock, IconMic, IconWave } from "./icons";
import "../ui/tokens.css";
import "../studio/studio.css";
import "./voicelab.css";

type Tab = "consent" | "record" | "train" | "evaluate" | "compare";
const TABS: { id: Tab; label: string }[] = [
  { id: "consent", label: "Consent" }, { id: "record", label: "Record" }, { id: "train", label: "Train" }, { id: "evaluate", label: "Evaluate" }, { id: "compare", label: "Compare" },
];
type Toast = { id: number; kind: "ok" | "error"; title: string; detail?: string };
export type SendOp = (op: string, voiceId?: string, data?: unknown) => Promise<void>;

const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const makeStandIn = (emit: ConstructorParameters<typeof FakeVoiceLabCore>[0]) => new FakeVoiceLabCore(emit);

/**
 * Voice Lab: make a voice for the companion from recordings. Consent first (nothing is recorded for a voice until
 * the core confirms a consent record), then a guided recording session, training, an evaluation report and a blind
 * A/B comparison. The core does the work (ops.ts documents the `voice_lab.event` ops); this window drives it.
 */
export function VoiceLab() {
  const link = usePanelLink(makeStandIn);
  const { connected, send } = link;
  const [ui, dispatch] = useReducer(uiReducer, initialUi);
  const { lab } = ui;
  const [selId, setSelId] = useState<string | null>(null);
  const [tabFor, setTabFor] = useState<Record<string, Tab>>({});
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Voice | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "error" ? 8000 : 4000);
  }, []);

  const sendOp: SendOp = useCallback((op, voiceId, data) => send("voice_lab.event", { op, voiceId, data: data ?? {} }), [send]);

  useEffect(
    () =>
      onCore(["voice_lab.event", "error"], (e) => {
        if (e.type === "voice_lab.event") {
          const ev = e.payload as VoiceLabEvent;
          dispatch({ type: "core", event: ev });
          if (ev.op === OPS.error) toast({ kind: "error", title: "Voice Lab", detail: String((ev.data as { message?: string })?.message ?? "Something went wrong.") });
        } else {
          const err = e.payload as ErrorInfo;
          if (/^voice_lab[._]/.test(err.code)) toast({ kind: "error", title: "Voice Lab", detail: err.message });
        }
      }),
    [toast],
  );

  useEffect(() => {
    if (connected) void sendOp(OPS.voicesList).catch(() => undefined);
    else dispatch({ type: "offline" });
  }, [connected, sendOp]);

  const voice = lab.voices.find((v) => v.id === selId) ?? lab.voices[0];
  const consent = voice ? consentOf(ui, voice.id) : undefined;
  const granted = !!consent && canRecord(consent);
  const takes = voice ? lab.takes[voice.id] : undefined;

  // Opening a voice: ask the core where it stands (consent, script, report). Consent is never assumed from the list.
  const voiceId = voice?.id;
  const ready = voice?.status === "ready";
  useEffect(() => {
    if (!connected || !voiceId) return;
    void sendOp(OPS.consentCheck, voiceId).catch(() => undefined);
  }, [connected, voiceId, sendOp]);
  useEffect(() => {
    if (connected && voiceId && granted) void sendOp(OPS.scriptGet, voiceId, { language: voice?.language }).catch(() => undefined);
    // Only when the voice or its consent changes, not on every language re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, voiceId, granted, sendOp]);
  useEffect(() => {
    if (connected && voiceId && ready) void sendOp(OPS.evalGet, voiceId).catch(() => undefined);
  }, [connected, voiceId, ready, sendOp]);

  const enabled = (t: Tab): boolean => {
    if (!voice) return false;
    if (t === "consent") return true;
    if (t === "record" || t === "train") return granted;
    if (t === "evaluate") return voice.status === "ready" || !!lab.evals[voice.id];
    return voice.status === "ready";
  };
  const defaultTab = (): Tab => {
    if (!voice || !granted) return "consent";
    if (voice.status === "training") return "train";
    if (voice.status === "ready") return "evaluate";
    return "record";
  };
  const picked = voice ? tabFor[voice.id] : undefined;
  const tab: Tab = picked && enabled(picked) ? picked : defaultTab();
  const setTab = (t: Tab) => voice && setTabFor((m) => ({ ...m, [voice.id]: t }));

  const create = (name: string, language: Language) => {
    setCreating(false);
    const id = newVoiceId(name);
    setSelId(id);
    sendOp(OPS.voiceCreate, id, { name, language }).catch((e: unknown) => toast({ kind: "error", title: "Couldn't create the voice.", detail: String(e) }));
  };
  const remove = (v: Voice) => {
    setDeleting(null);
    sendOp(OPS.voiceDelete, v.id).then(
      () => toast({ kind: "ok", title: `Deleted “${v.name}” and its recordings.` }),
      (e: unknown) => toast({ kind: "error", title: "Couldn't delete the voice.", detail: String(e) }),
    );
  };

  let main: ReactNode;
  if (!connected) {
    main = (
      <Empty icon={<IconWave />} title="Voice Lab needs Hikari's core">
        Recording, training and evaluation run in the core, on this Mac. Start it and your voices show up here.
        {link.reason && <span className="vl-fine">{link.reason}</span>}
      </Empty>
    );
  } else if (!lab.listed) {
    main = <div className="vl-center"><span className="st-spinner" aria-label="Loading voices" /></div>;
  } else if (!voice) {
    main = (
      <Empty icon={<IconMic />} title="Give your companion a voice">
        Record a few dozen lines, in your own voice or with someone's clear consent, and Hikari trains a voice from them. It all stays on this Mac.
        <button className="st-btn st-btn-primary" onClick={() => setCreating(true)}><IconPlus /> New Voice</button>
      </Empty>
    );
  } else {
    main = (
      <div className="vl-detail" key={voice.id}>
        <header className="vl-head">
          <div className="vl-head-text">
            <h1>{voice.name}</h1>
            <p className="vl-sub">
              {voice.owner === "other" ? `${voice.speakerName ?? "Someone else"}'s voice` : voice.owner === "self" ? "Your voice" : "Owner not confirmed yet"}
              {voice.language && ` · ${languageName(voice.language)}`} · {voiceStatusLabel(voice, takes)}
            </p>
          </div>
          <button className="st-btn st-btn-plain st-icon-btn vl-del" aria-label="Delete voice" title="Delete voice…" onClick={() => setDeleting(voice)}><IconTrash /></button>
        </header>
        <div className="st-tabs vl-tabs" role="tablist" style={{ "--i": TABS.findIndex((t) => t.id === tab) } as CSSProperties}>
          <span className="st-tabs-pill vl-tabs-pill" aria-hidden="true" />
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} disabled={!enabled(t.id)} onClick={() => setTab(t.id)}
              title={!enabled(t.id) ? (t.id === "record" || t.id === "train" ? "Complete consent first" : "Train the voice first") : undefined}>
              {!enabled(t.id) && <IconLock />}{t.label}
            </button>
          ))}
        </div>
        <div className="vl-pane">
          {tab === "consent" && consent && (
            <ConsentFlow voice={voice} state={consent} dispatch={(event) => dispatch({ type: "consent", voiceId: voice.id, event })} sendOp={sendOp}
              onRecord={() => setTab("record")} />
          )}
          {tab === "record" && granted && (
            <RecordSession voice={voice} lines={lab.scripts[voice.id]} takes={takes ?? {}} sendOp={sendOp}
              setTake={(lineId, take) => dispatch({ type: "take", voiceId: voice.id, lineId, take })}
              onTrain={canTrain(voice, takes) ? () => setTab("train") : undefined} />
          )}
          {tab === "train" && granted && (
            <TrainPanel voice={voice} takes={takes} progress={lab.training[voice.id]} error={lab.errors[voice.id]} sendOp={sendOp}
              onEvaluate={() => setTab("evaluate")} onRecord={() => setTab("record")} />
          )}
          {tab === "evaluate" && <EvalReportView report={lab.evals[voice.id]} onRerun={() => void sendOp(OPS.evalGet, voice.id, { rerun: true })} />}
          {tab === "compare" && <AbPlayer voice={voice} pair={lab.ab[voice.id]} sendOp={sendOp} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`st vl hk${unifiedTitlebar() ? " st-unified" : ""}`}>
      {unifiedTitlebar() && <div className="st-titlebar" data-tauri-drag-region />}
      <aside className="st-sidebar">
        <nav className="st-list" aria-label="Voices">
          <h3 className="st-group">Voices</h3>
          {lab.voices.map((v) => (
            <button key={v.id} className={`st-row${v.id === voice?.id ? " sel" : ""}`} aria-current={v.id === voice?.id} onClick={() => setSelId(v.id)}>
              <span className="vl-avatar" style={{ "--hue": characterHue(v.id) } as CSSProperties} aria-hidden="true">{v.owner === "self" ? <IconMic /> : initials(v.speakerName || v.name)}</span>
              <span className="st-row-text">
                <span className="st-row-name">{v.name}</span>
                <span className="st-row-sub">{voiceStatusLabel(v, lab.takes[v.id])}</span>
              </span>
              {v.status === "training" && <span className="vl-row-ring" style={{ "--p": v.progress ?? 0 } as CSSProperties} aria-hidden="true" />}
              {v.status === "ready" && <span className="st-live" title="Ready" />}
            </button>
          ))}
          {connected && lab.listed && !lab.voices.length && <p className="vl-side-empty">No voices yet.</p>}
        </nav>
        <div className="st-sidebar-foot">
          <button className="st-btn st-btn-plain" disabled={!connected} onClick={() => setCreating(true)}><IconPlus /> New Voice</button>
          <p className="vl-mode"><span className={`vl-dot${connected ? " on" : ""}`} aria-hidden="true" />{connected ? (link.mode === "app" ? "Connected to Hikari's core" : link.mode === "fake" ? "Preview · stand-in core" : "Preview · drive with hikariCore") : "Core not running"}</p>
        </div>
      </aside>

      <main className="st-main vl-main">{main}</main>

      <div className="st-toasts vl-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`st-toast ${t.kind}`}>
            <span className="st-toast-icon">{t.kind === "ok" ? <IconCheck /> : <IconWarn />}</span>
            <div><p>{t.title}</p>{t.detail && <p className="st-toast-detail">{t.detail}</p>}</div>
          </div>
        ))}
      </div>

      {creating && <NewVoiceSheet onCancel={() => setCreating(false)} onCreate={create} />}
      {deleting && (
        <Sheet onDismiss={() => setDeleting(null)}>
          <div className="st-sheet-icon"><IconTrash /></div>
          <h2>Delete “{deleting.name}”?</h2>
          <p>The recordings, the consent record and the trained voice are all removed. This can't be undone.</p>
          <div className="st-sheet-actions">
            <button className="st-btn" autoFocus onClick={() => setDeleting(null)}>Cancel</button>
            <button className="st-btn st-btn-danger" onClick={() => remove(deleting)}>Delete</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function NewVoiceSheet({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, language: Language) => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Language>("hinglish");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <Sheet onDismiss={onCancel}>
      <form className="vl-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim(), language); }} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
        <div className="st-sheet-icon vl-sheet-icon"><IconMic /></div>
        <h2>New Voice</h2>
        <p>Next you'll confirm whose voice it is. Recording starts only after that.</p>
        <label className="vl-field">
          <span>Name</span>
          <input ref={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My voice" maxLength={40} />
        </label>
        <label className="vl-field">
          <span>Script language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="hinglish">Hinglish (mixed)</option>
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
          </select>
        </label>
        <div className="st-sheet-actions">
          <button type="button" className="st-btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="st-btn st-btn-primary vl-sheet-primary" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </Sheet>
  );
}

export function Sheet({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="st-sheet-backdrop" onClick={onDismiss} onKeyDown={(e) => e.key === "Escape" && onDismiss()}>
      <div className="st-sheet" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="vl-empty">
      <span className="vl-empty-icon">{icon}</span>
      <p className="vl-empty-title">{title}</p>
      <div className="vl-empty-sub">{children}</div>
    </div>
  );
}
