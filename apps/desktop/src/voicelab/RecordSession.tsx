import { useEffect, useState } from "react";
import { IconCheck } from "../studio/icons";
import { finishTake, usePlayer, useRecorder } from "./audio";
import { LevelMeter, PlayButton, RecordButton, seconds } from "./controls";
import { IconLeft, IconRight } from "./icons";
import { nextToRecord, OPS, sessionProgress, type ScriptLine, type Take, type Voice } from "./ops";
import { problemText } from "./wav";
import type { SendOp } from "./VoiceLab";

const langTag: Record<string, string> = { en: "English", hi: "हिंदी", hinglish: "Hinglish" };

/**
 * The recording session: one script line at a time, record → check → send (`clip.saved`, base64 WAV). Takes the UI
 * can tell are bad (too short, too quiet, clipped) aren't sent; the core may still reject a take (`clip.ack`).
 * Space records/stops, ←/→ move between lines.
 */
export function RecordSession({ voice, lines, takes, sendOp, setTake, onTrain }: {
  voice: Voice;
  lines?: ScriptLine[];
  takes: Record<string, Take>;
  sendOp: SendOp;
  setTake: (lineId: string, take: Take) => void;
  onTrain?: () => void;
}) {
  const rec = useRecorder(true);
  const player = usePlayer();
  const [picked, setPicked] = useState<number | null>(null);
  const list = lines ?? [];
  const index = Math.min(list.length - 1, picked ?? Math.max(0, nextToRecord(list, takes)));
  const line = list[index];
  const take = line ? takes[line.id] : undefined;
  const progress = sessionProgress(list, takes);
  const recording = rec.state === "recording";

  const go = (i: number) => {
    if (recording || !list.length) return;
    player.stop();
    setPicked((i + list.length) % list.length);
  };

  const start = () => {
    player.stop();
    rec.start();
  };

  const stop = () => {
    if (!line) return;
    const { samples, rate } = rec.stop();
    const t = finishTake(samples, rate);
    const n = (take?.take ?? 0) + 1;
    if (t.problems.length) {
      setTake(line.id, { status: "rejected", take: n, durationMs: t.stats.durationMs, reason: problemText[t.problems[0]], url: t.url });
      return;
    }
    setTake(line.id, { status: "saving", take: n, durationMs: t.stats.durationMs, url: t.url });
    sendOp(OPS.clipSaved, voice.id, {
      lineId: line.id, text: line.text, language: line.language, take: n,
      encoding: "wav", sampleRate: t.sampleRate, channels: 1, bitsPerSample: 16,
      durationMs: Math.round(t.stats.durationMs), peak: +t.stats.peak.toFixed(4), rms: +t.stats.rms.toFixed(4),
      audio: t.wavBase64,
    }).catch((e: unknown) => setTake(line.id, { status: "failed", take: n, durationMs: t.stats.durationMs, url: t.url, reason: `Couldn't send it to the core: ${String(e)}` }));
    // Move on to the next line still to record.
    const next = nextToRecord(list, { ...takes, [line.id]: { status: "saving", take: n } }, index);
    if (next >= 0) setPicked(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, button")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (recording) stop();
        else if (rec.state === "ready") start();
      } else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!lines) return <div className="vl-center"><span className="st-spinner" aria-label="Loading the script" /></div>;
  if (!line) return <p className="vl-note">The core sent an empty script.</p>;

  return (
    <div className="vl-session">
      <div className="vl-progress" aria-label="Session progress">
        <div className="vl-progress-text">
          <b>{progress.done} of {progress.total} lines</b>
          <span>{progress.minutes >= 0.1 ? `${progress.minutes.toFixed(1)} min recorded` : "Quiet room, same distance from the mic each time, read naturally."}</span>
          {progress.done < voice.minClips ? <span className="vl-fine">{voice.minClips - progress.done} more to train</span> : onTrain && <button className="st-btn" onClick={onTrain}>Train Voice…</button>}
        </div>
        <div className="vl-bar"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /><b style={{ left: `${(voice.minClips / Math.max(1, progress.total)) * 100}%` }} title="Enough to train" /></div>
      </div>

      <div className={`vl-line${recording ? " rec" : ""}`}>
        <div className="vl-line-head">
          <span>Line {index + 1}</span>
          {line.language && <span className="mm-tag">{langTag[line.language] ?? line.language}</span>}
          <span className={`vl-take-status ${take?.status ?? ""}`}>
            {take?.status === "saved" && <><IconCheck /> Saved</>}
            {take?.status === "saving" && "Saving…"}
            {(take?.status === "rejected" || take?.status === "failed") && "Try again"}
          </span>
        </div>
        <p className="vl-line-text" lang={line.language === "hi" ? "hi" : undefined}>{line.text}</p>
        {take?.reason && <p className="vl-warn">{take.reason}</p>}
      </div>

      <div className="vl-controls">
        <button className="st-btn st-icon-btn" aria-label="Previous line" disabled={recording} onClick={() => go(index - 1)}><IconLeft /></button>
        <RecordButton state={rec.state} label={take ? "Re-record" : "Record"} onStart={start} onStop={stop} />
        <button className="st-btn st-icon-btn" aria-label="Next line" disabled={recording} onClick={() => go(index + 1)}><IconRight /></button>
      </div>
      <div className="vl-controls-sub">
        <LevelMeter rms={rec.level.rms} peak={rec.level.peak} live={rec.state === "ready" || recording} />
        {take?.url && !recording && (
          <PlayButton label={`Take ${take.take}${take.durationMs ? ` · ${seconds(take.durationMs)}` : ""}`} playing={player.playing === line.id}
            onPlay={() => player.play(line.id, { url: take.url })} onStop={player.stop} />
        )}
      </div>
      {rec.state === "closed" && !rec.error && <p className="vl-fine vl-centered">Opening the microphone…</p>}
      {rec.error && <p className="vl-error vl-centered">{rec.error}</p>}
      {rec.fake && <p className="vl-fine vl-centered">Preview: using a synthetic microphone.</p>}
      <p className="vl-fine vl-centered">Space to record or stop · ← → to move between lines</p>
    </div>
  );
}
