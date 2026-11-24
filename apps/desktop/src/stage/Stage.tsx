import { useEffect, useRef, useState } from "react";
import { MicCapture } from "../audio/capture";
import { useStage } from "../state/stage";
import { StageRuntime } from "./runtime";
import { EmptySlotError, loadAvatar } from "../avatar/loader";
import { DEFAULT_CHARACTER, activeCharacterId, setActiveCharacterId, type CharacterPack } from "../avatar/characters";
import { getPack } from "../avatar/packs";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "./runtime";
import { Subscriptions } from "../util/subscriptions";

export function Stage() {
  const host = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const rt = useRef<StageRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptySlot, setEmptySlot] = useState<CharacterPack | null>(null);
  const [characterId, setCharacterId] = useState(activeCharacterId);
  const [switching, setSwitching] = useState(false);
  // True when the current load came from a chat "switch to …" (not app start).
  const fromSwitch = useRef(false);
  const caption = useStage((s) => s.caption);

  // Runtime: one per stage window.
  useEffect(() => {
    const runtime = new StageRuntime();
    rt.current = runtime;
    runtime.start();
    // Empty-slot prompt stays clickable while there's no avatar to hit-test.
    runtime.fallbackHit = (x, y) => {
      const r = slotRef.current?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    runtime.onSwitchCharacter = (id) => {
      fromSwitch.current = true;
      setActiveCharacterId(id);
      setCharacterId(id);
    };
    const subs = new Subscriptions();
    if (inTauri) {
      subs.add(
        listen<string>("character://select", (e) => {
          setActiveCharacterId(e.payload);
          setCharacterId(e.payload);
        }),
      );
    }
    return () => {
      subs.dispose();
      runtime.destroy();
    };
  }, []);

  // Character: (re)load whenever the selection changes, with a short cross-fade.
  useEffect(() => {
    const runtime = rt.current;
    if (!runtime) return;
    let cancelled = false;
    setSwitching(true);
    setError(null);
    void (async () => {
      const pack = (await getPack(characterId)) ?? (await getPack(DEFAULT_CHARACTER));
      if (!pack || cancelled) return;
      runtime.setCharacter(pack);
      await new Promise((r) => setTimeout(r, 180)); // let the fade-out finish
      if (cancelled) return;
      runtime.detach();
      setEmptySlot(null);
      try {
        const avatar = await loadAvatar(host.current!, pack);
        if (cancelled) return avatar.destroy();
        runtime.attach(avatar);
        // Dev-only: VITE_AUTOPLAY_MOCK=1 pnpm dev → play the mock turn on load (visual lip-sync check).
        if (import.meta.env.DEV && import.meta.env.VITE_AUTOPLAY_MOCK) setTimeout(() => runtime.playMock(), 1500);
        // Dev-only: VITE_AVSYNC=1 pnpm dev → measure lip/audio sync, logs an AVSYNC line.
        if (import.meta.env.DEV && import.meta.env.VITE_AVSYNC) {
          setTimeout(() => void import("../dev/avSyncProbe").then((m) => m.runAvSyncProbe(runtime)).catch((e) => console.error("avsync probe failed:", e)), 2000);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof EmptySlotError) {
          setEmptySlot(e.pack);
          if (inTauri && fromSwitch.current) void invoke("show_window", { label: "studio" });
        }
        else {
          console.error("avatar load failed:", e);
          setError(String(e));
        }
      } finally {
        if (!cancelled) setSwitching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  return (
    <div
      className={`stage${switching ? " switching" : ""}`}
      ref={host}
      onMouseDown={(e) => {
        if (e.button === 0 && rt.current && !emptySlot) void rt.current.startDrag();
      }}
      onDoubleClick={() => rt.current?.playMock()}
    >
      <div className="bubble">{caption}</div>
      {error && <div className="empty-slot">Couldn't load the model: {error}</div>}
      {emptySlot && (
        <div className="empty-slot slot-prompt" ref={slotRef} onMouseDown={(e) => e.stopPropagation()}>
          <strong>{emptySlot.displayName}</strong>
          <p>Import your own model for this character: a Live2D or VRM model you bought, commissioned or made.</p>
          <button onClick={() => void invoke("show_window", { label: "studio" })}>Open Character Studio</button>
        </div>
      )}
      <DebugOverlay rt={rt} />
    </div>
  );
}

function DebugOverlay({ rt }: { rt: React.RefObject<StageRuntime | null> }) {
  const { debug, core, state, latency, fps, tier, audio } = useStage();
  if (!debug) return null;
  return (
    <div className="debug" onMouseDown={(e) => e.stopPropagation()}>
      <div>
        core <span className={core ? "ok" : "bad"}>{core ? "connected" : "offline"}</span> · {state} · {fps} fps ({tier})
      </div>
      <div>
        stt {latency.stt_final ?? "–"} · llm {latency.llm_first_token ?? "–"} · tts {latency.tts_first_chunk ?? "–"} ·
        audio {latency.audio_first_play ?? "–"} ms
      </div>
      <div>
        ctx {audio.ctx} · mouth {audio.mouth.toFixed(2)}
      </div>
      <MicRow rt={rt} />
      <button onClick={() => rt.current?.playMock()}>play mock turn</button>{" "}
      <button onClick={() => rt.current?.bargeIn()}>barge in</button>
    </div>
  );
}

function MicRow({ rt }: { rt: React.RefObject<StageRuntime | null> }) {
  const mic = useStage((s) => s.mic);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    // Device labels are only exposed after mic permission; refresh when the mic opens.
    void MicCapture.inputs().then(setDevices).catch(() => setDevices([]));
  }, [mic.open]);
  const status = mic.muted ? "muted" : mic.error ? `error: ${mic.error}` : mic.open ? "open" : "closed";
  return (
    <div className="mic-row">
      mic{" "}
      <select value={mic.mode} onChange={(e) => void rt.current?.setMicMode(e.target.value as "ptt" | "open")}>
        <option value="ptt">push-to-talk (⌥Space)</option>
        <option value="open">always listening</option>
      </select>{" "}
      <span className={mic.error ? "bad" : mic.open ? "ok" : ""}>{status}</span>
      <span className="meter" aria-label="mic level">
        <span style={{ width: `${Math.round(mic.level * 100)}%` }} className={mic.voiced ? "voiced" : ""} />
      </span>
      <br />
      <select
        className="device"
        value={rt.current?.voice.mic.deviceId ?? ""}
        onChange={(e) => void rt.current?.setMicDevice(e.target.value)}
      >
        <option value="">default input</option>
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || "microphone"}
          </option>
        ))}
      </select>
    </div>
  );
}
