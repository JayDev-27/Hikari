import type { CSSProperties } from "react";
import { IconPlay } from "../studio/icons";
import { meterLevel, toDb } from "./wav";
import { IconMic, IconPause, IconStop } from "./icons";
import type { RecorderState } from "./audio";

/** Read the clock in event handlers (kept out of render). */
export const wallClock = () => Date.now();

/** Input level, −60…0 dBFS, with the block peak as a tick and a warning when it clips. */
export function LevelMeter({ rms, peak, live }: { rms: number; peak: number; live: boolean }) {
  const clipping = live && peak >= 0.99;
  const db = toDb(rms);
  return (
    <div className={`vl-meter${live ? " live" : ""}${clipping ? " clip" : ""}`} role="meter" aria-label="Microphone level" aria-valuemin={-60} aria-valuemax={0}
      aria-valuenow={Number.isFinite(db) ? Math.max(-60, Math.round(db)) : -60}>
      <div className="vl-meter-track">
        <div className="vl-meter-fill" style={{ "--l": live ? meterLevel(rms) : 0 } as CSSProperties} />
        <div className="vl-meter-peak" style={{ "--l": live ? meterLevel(peak) : 0 } as CSSProperties} />
        <span className="vl-meter-zone" aria-hidden="true" />
      </div>
      <span className="vl-meter-label">{clipping ? "Too loud" : live ? (Number.isFinite(db) && db > -60 ? `${Math.round(db)} dB` : "Silent") : "Mic off"}</span>
    </div>
  );
}

/** The big round record button: red dot to record, square to stop. */
export function RecordButton({ state, onStart, onStop, label = "Record", disabled }: {
  state: RecorderState;
  onStart: () => void;
  onStop: () => void;
  label?: string;
  disabled?: boolean;
}) {
  const rec = state === "recording";
  return (
    <button className={`vl-rec${rec ? " on" : ""}`} disabled={disabled || (state !== "ready" && !rec)} onClick={rec ? onStop : onStart}
      aria-label={rec ? "Stop recording" : label} title={rec ? "Stop (Space)" : `${label} (Space)`}>
      <span className="vl-rec-dot">{rec ? <IconStop /> : <IconMic />}</span>
      <span className="vl-rec-label">{rec ? "Stop" : label}</span>
    </button>
  );
}

export function PlayButton({ playing, onPlay, onStop, label, disabled }: { playing: boolean; onPlay: () => void; onStop: () => void; label: string; disabled?: boolean }) {
  return (
    <button className={`st-btn vl-play${playing ? " on" : ""}`} disabled={disabled} onClick={playing ? onStop : onPlay} aria-label={playing ? `Stop ${label}` : `Play ${label}`}>
      {playing ? <IconPause /> : <IconPlay />} {label}
    </button>
  );
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
