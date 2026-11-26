import { useEffect, useMemo, useRef, useState } from "react";
import type { Emotion, GestureTag } from "@hikari/protocol";
import { listPacks } from "../avatar/packs";
import type { CharacterPack } from "../avatar/characters";
import { ZERO_VISEMES, type AvatarState, type Visemes } from "../avatar/types";
import { AVATAR_STATES, type LayerFrame } from "../avatar/layers/animator";
import { EMOTIONS } from "../avatar/layers/emotion";
import { DEFAULT_TUNING, POSTURE_KEYS, diffTuning, type Tuning } from "../avatar/layers/tuning";
import { PHRASES } from "./phrases";
import { TunerSession } from "./session";
import "./tuner.css";

/**
 * Animation tuner (dev only, `#/tuner`): load any character, trigger states / gestures / emotions / visemes, tune
 * the layer numbers live (layers/tuning.ts) and copy the changed numbers out. Overrides persist per character in
 * localStorage only, and only dev builds read them back (loadTuning).
 */

const GESTURE_TAGS: GestureTag[] = ["wave", "shrug", "facepalm", "laugh", "shy_look_away", "think_chin", "clap", "point", "pout", "cross_arms", "head_pat_react", "nod", "head_tilt", "bow"];
const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;

/** Slider range per tuning field: [min, max, step]. Postures share one table. */
const RANGES: Record<string, [number, number, number]> = {
  "blink.mean": [1, 10, 0.1], "blink.min": [0.3, 5, 0.1], "blink.max": [3, 20, 0.5], "blink.double": [0, 0.6, 0.01],
  "blink.close": [0.03, 0.2, 0.005], "blink.open": [0.05, 0.4, 0.005], "blink.gazeShift": [0.05, 1, 0.01], "blink.gazeShiftChance": [0, 1, 0.05],
  "saccade.amplitude": [0, 0.2, 0.005], "saccade.min": [0.1, 3, 0.05], "saccade.max": [0.5, 6, 0.1],
  "lookAway.min": [1, 30, 0.5], "lookAway.max": [2, 60, 0.5], "lookAway.holdMin": [0.2, 4, 0.1], "lookAway.holdMax": [0.3, 6, 0.1],
  "lookAway.amplitude": [0, 1, 0.01], "lookAway.weight": [0, 1, 0.01],
  "breath.rate": [0.3, 2, 0.05], "breath.depth": [0, 2, 0.05], "sway.amplitude": [0, 2, 0.05], "sway.tempo": [0.2, 2, 0.05],
  "weightShift.min": [2, 30, 0.5], "weightShift.max": [3, 40, 0.5], "weightShift.amplitude": [0, 1, 0.01], "weightShift.ease": [0.2, 4, 0.05],
  "state.transition": [0.05, 2, 0.01], "state.sleep": [0.2, 4, 0.05], "state.wakeDuration": [0.5, 8, 0.1], "state.scale": [0, 2, 0.05], "state.cueDelay": [0, 6, 0.1],
  "emotion.attack": [0.02, 2, 0.01], "emotion.release": [0.05, 3, 0.01], "emotion.hold": [0, 30, 0.5], "emotion.halfLife": [0.3, 20, 0.1],
  "emotion.threshold": [0.02, 0.5, 0.01], "emotion.scale": [0, 1.5, 0.05],
  "gesture.intensity": [0, 1.5, 0.05], "gesture.speed": [0.4, 2, 0.05], "gesture.duck": [0, 1, 0.05], "gesture.settle": [0, 5, 0.1], "gesture.settleTime": [0.3, 4, 0.05],
  "face.mouthGain": [0, 2, 0.05], "face.emotionFace": [0, 2, 0.05],
  "lipsync.attack": [0.005, 0.2, 0.005], "lipsync.release": [0.01, 0.3, 0.005],
};
const POSTURE_RANGES: Record<string, [number, number, number]> = {
  headYaw: [-20, 20, 0.5], headPitch: [-20, 20, 0.5], headRoll: [-15, 15, 0.5], bodyYaw: [-10, 10, 0.5], bodyLean: [-8, 8, 0.25],
  bodyRoll: [-8, 8, 0.25], shoulders: [-8, 8, 0.5], gazeX: [-1, 1, 0.01], gazeY: [-1, 1, 0.01], gazeWeight: [0, 1, 0.01],
  eyeOpen: [-1, 0.3, 0.01], brow: [-1, 1, 0.05], breathRate: [0, 2, 0.05], breathDepth: [0, 2, 0.05], sway: [0, 2, 0.05],
  blinkRate: [0, 4, 0.05], lookAway: [0, 3, 0.05], saccade: [0, 3, 0.05], chinHand: [0, 1, 0.05],
};
const GROUPS = ["blink", "saccade", "lookAway", "breath", "sway", "weightShift", "state", "emotion", "gesture", "face", "lipsync"] as const;

export function Tuner() {
  const [packs, setPacks] = useState<CharacterPack[]>([]);
  const [packId, setPackId] = useState(() => new URLSearchParams(location.hash.split("?")[1] ?? "").get("id") ?? "");
  const [status, setStatus] = useState("loading");
  const [session, setSession] = useState<TunerSession | null>(null);
  const [, setRev] = useState(0);
  const [state, setStateName] = useState<AvatarState>("idle");
  const [emotionK, setEmotionK] = useState(0.8);
  const [manual, setManual] = useState<Visemes>({ ...ZERO_VISEMES });
  const [manualOn, setManualOn] = useState(false);
  const [postureState, setPostureState] = useState<AvatarState>("thinking");
  const [follow, setFollow] = useState(true);
  const [frame, setFrame] = useState<LayerFrame | undefined>();
  const [copied, setCopied] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const pack = packs.find((p) => p.id === packId);
  const tuning: Tuning | undefined = session?.tuning;
  const bump = () => setRev((r) => r + 1);

  useEffect(() => {
    void listPacks().then((list) => {
      const usable = list.filter((p) => p.modelUrl);
      setPacks(usable);
      setPackId((id) => (usable.some((p) => p.id === id) ? id : usable[0]?.id ?? ""));
    });
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !pack) return;
    const s = new TunerSession(pack);
    s.onState = setStateName;
    let live = true;
    setStatus("loading");
    setFrame(undefined);
    setSession(null);
    void s.start(el).then(() => {
      if (!live) return;
      setStatus("ready");
      setStateName("idle");
      setSession(s);
    }).catch((e: unknown) => live && setStatus(`error: ${String(e)}`));
    const readout = window.setInterval(() => setFrame(s.frame), 120);
    return () => {
      live = false;
      clearInterval(readout);
      s.destroy();
    };
  }, [pack]);

  useEffect(() => {
    session?.setManual(manualOn, manual);
  }, [session, manualOn, manual]);

  const gestures = useMemo(() => {
    if (!pack) return [];
    const extra = [...(pack.signatureMotions ?? []), ...Object.keys(pack.motionMap ?? {})];
    return [...new Set([...GESTURE_TAGS, ...extra])];
  }, [pack]);

  const edit = (path: string, value: number) => {
    session?.edit(path, value);
    bump();
  };

  const copy = async () => {
    if (!tuning) return;
    const text = JSON.stringify(diffTuning(tuning), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Copied the changed numbers.");
    } catch {
      setCopied(text);
    }
  };

  const setState = (s: AvatarState) => {
    session?.chooseState(s);
    setStateName(s);
  };

  const speak = (id: string) => {
    if (!session) return;
    setManualOn(false);
    session.speak(id);
    setStateName("speaking");
  };

  const num = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const overrides = tuning ? Object.keys(diffTuning(tuning)).length : 0;

  return (
    <div className="tuner">
      <header>
        <strong>Animation tuner</strong>
        <select value={packId} onChange={(e) => setPackId(e.target.value)} aria-label="Character">
          {packs.map((p) => <option key={p.id} value={p.id}>{p.displayName} ({p.renderer})</option>)}
        </select>
        <span className="tn-status" role="status">{status}</span>
        <span className="tn-spacer" />
        <button onClick={() => void copy()} disabled={!tuning}>Copy tuned numbers</button>
        <button onClick={() => { session?.reset(); bump(); }} disabled={!tuning}>Reset to defaults</button>
        <span className="tn-muted">{overrides ? `${overrides} group(s) changed · saved in localStorage` : "defaults"}</span>
      </header>
      {copied && <pre className="tn-copied" onClick={() => setCopied("")}>{copied}</pre>}
      <main>
        <section className="tn-stage">
          <div
            className="tn-host"
            ref={host}
            onMouseMove={(e) => {
              if (!follow) return;
              const r = e.currentTarget.getBoundingClientRect();
              session?.avatar?.lookAt((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2);
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              session?.avatar?.react({ kind: "click", area: e.clientY - r.top < r.height * 0.25 ? "head" : "body" });
            }}
          />
          <label className="tn-check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Eyes follow the mouse</label>
          {frame && <Readout f={frame} />}
        </section>
        <section className="tn-controls">
          <fieldset>
            <legend>State (layer 2)</legend>
            <div className="tn-row">
              {AVATAR_STATES.map((s) => <button key={s} className={s === state ? "on" : ""} onClick={() => setState(s)}>{s}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Gesture (layer 3)</legend>
            <div className="tn-row">
              {gestures.map((g) => <button key={g} onClick={() => session?.avatar?.playMotion(g, { interrupt: true })}>{g}</button>)}
            </div>
          </fieldset>
          <fieldset>
            <legend>Emotion (layer 4) — decays unless re-sent</legend>
            <div className="tn-row">
              {EMOTIONS.map((e) => <button key={e} onClick={() => session?.avatar?.setExpression(e as Emotion, emotionK)}>{e}</button>)}
            </div>
            <Slider label="intensity" value={emotionK} range={[0, 1, 0.05]} onChange={setEmotionK} />
          </fieldset>
          <fieldset>
            <legend>Lip sync</legend>
            <div className="tn-row">
              {PHRASES.map((p) => <button key={p.id} title={p.ipa} onClick={() => speak(p.id)}>{p.label}</button>)}
            </div>
            <label className="tn-check"><input type="checkbox" checked={manualOn} onChange={(e) => setManualOn(e.target.checked)} /> Hold visemes</label>
            {manualOn && VISEMES.map((k) => <Slider key={k} label={k} value={manual[k]} range={[0, 1, 0.01]} onChange={(v) => setManual((m) => ({ ...m, [k]: v }))} />)}
          </fieldset>
          {tuning && (
            <>
              <fieldset>
                <legend>Posture of
                  <select value={postureState} onChange={(e) => setPostureState(e.target.value as AvatarState)}>
                    {AVATAR_STATES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </legend>
                {POSTURE_KEYS.map((k) => (
                  <Slider key={k} label={k} value={tuning.postures[postureState][k]} range={POSTURE_RANGES[k]}
                    changed={tuning.postures[postureState][k] !== DEFAULT_TUNING.postures[postureState][k]}
                    onChange={(v) => edit(`postures.${postureState}.${k}`, v)} />
                ))}
              </fieldset>
              {GROUPS.map((g) => (
                <fieldset key={g}>
                  <legend>{g}</legend>
                  {Object.entries(tuning[g]).map(([k, v]) => (
                    <Slider key={k} label={k} value={v as number} range={RANGES[`${g}.${k}`] ?? [0, 2, 0.01]}
                      changed={(v as number) !== (DEFAULT_TUNING[g] as Record<string, number>)[k]}
                      onChange={(nv) => edit(`${g}.${k}`, nv)} />
                  ))}
                </fieldset>
              ))}
            </>
          )}
        </section>
      </main>
      <footer className="tn-muted">Numbers: {num(frame?.t ?? 0)} s on the layer clock. Defaults live in src/avatar/layers/tuning.ts; paste copied numbers there to keep them.</footer>
    </div>
  );
}

function Slider({ label, value, range, onChange, changed }: { label: string; value: number; range: [number, number, number]; onChange: (v: number) => void; changed?: boolean }) {
  const [min, max, step] = range;
  return (
    <label className={`tn-slider${changed ? " changed" : ""}`}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(4))} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Bar({ label, v, lo = 0, hi = 1 }: { label: string; v: number; lo?: number; hi?: number }) {
  const pct = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div className="tn-bar"><span>{label}</span><i><b style={{ width: `${pct}%` }} /></i><em>{v.toFixed(2)}</em></div>
  );
}

function Readout({ f }: { f: LayerFrame }) {
  return (
    <div className="tn-readout" aria-label="Live layer values">
      <div className="tn-col">
        <h4>States</h4>
        {AVATAR_STATES.map((s) => <Bar key={s} label={s} v={f.stateWeights[s]} />)}
      </div>
      <div className="tn-col">
        <h4>Life · face</h4>
        <Bar label="blink" v={f.blink} />
        <Bar label="eyeClose" v={f.eyeClose} />
        <Bar label="breath" v={f.breath} />
        <Bar label="weight" v={f.weightShift} lo={-1} hi={1} />
        <Bar label="gesture" v={f.gesture} />
        <Bar label="gaze x" v={f.gaze.x} lo={-1} hi={1} />
        <Bar label="gaze y" v={f.gaze.y} lo={-1} hi={1} />
        <Bar label={f.emotion.name} v={f.emotion.weight} />
        <Bar label="smile" v={f.face.smile} lo={-1} hi={1} />
      </div>
    </div>
  );
}
