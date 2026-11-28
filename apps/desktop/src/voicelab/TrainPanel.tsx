import { IconCheck, IconWarn } from "../studio/icons";
import { usePlayer } from "./audio";
import { PlayButton } from "./controls";
import { HikariFlower } from "../ui/HikariFlower";
import { canTrain, formatMetric, meetsTarget, OPS, type EvalReport, type Take, type TrainProgress, type Voice } from "./ops";
import { Empty } from "./VoiceLab";
import type { SendOp } from "./VoiceLab";

const stageText: Record<TrainProgress["stage"], string> = {
  queued: "Waiting to start", preparing: "Preparing your recordings", training: "Training", evaluating: "Evaluating",
  done: "Finished", failed: "Training failed", cancelled: "Cancelled",
};

function eta(sec?: number) {
  if (sec === undefined) return "";
  if (sec < 60) return `about ${Math.max(1, Math.round(sec))} s left`;
  return `about ${Math.round(sec / 60)} min left`;
}

/** Start training (`train.start`) and follow `train.progress`. */
export function TrainPanel({ voice, takes, progress, error, sendOp, onEvaluate, onRecord }: {
  voice: Voice;
  takes?: Record<string, Take>;
  progress?: TrainProgress;
  error?: { message: string; about?: string };
  sendOp: SendOp;
  onEvaluate: () => void;
  onRecord: () => void;
}) {
  const saved = Math.max(voice.clips, Object.values(takes ?? {}).filter((t) => t.status === "saved").length);
  const running = voice.status === "training" || (!!progress && ["queued", "preparing", "training", "evaluating"].includes(progress.stage));
  const p = progress?.progress ?? voice.progress ?? 0;

  return (
    <div className="vl-card vl-train">
      {running ? (
        <>
          <h2>{stageText[progress?.stage ?? "training"]}…</h2>
          <div className="vl-bar vl-bar-lg" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}><i style={{ width: `${p * 100}%` }} /></div>
          <p className="vl-train-stats">
            <b>{Math.round(p * 100)}%</b>
            {progress?.step !== undefined && progress.totalSteps && <span>Step {progress.step} of {progress.totalSteps}</span>}
            {progress?.loss !== undefined && <span>Loss {progress.loss.toFixed(3)}</span>}
            {progress?.etaSec !== undefined && <span>{eta(progress.etaSec)}</span>}
          </p>
          {progress?.message && <p className="vl-note">{progress.message}</p>}
          <p className="vl-fine">You can close this window; training carries on in the core.</p>
          <button className="st-btn" onClick={() => void sendOp(OPS.trainCancel, voice.id)}>Cancel Training</button>
        </>
      ) : voice.status === "ready" ? (
        <>
          <span className="vl-granted-icon"><IconCheck /></span>
          <h2>{voice.owner === "other" ? `${voice.speakerName ? `${voice.speakerName}'s` : "The"} voice is trained` : "Your voice is trained"}</h2>
          <p className="vl-note">Trained on {saved} lines{voice.minutes ? `, ${voice.minutes.toFixed(1)} minutes` : ""}. Check the report, then compare it blind against the base voice.</p>
          <div className="vl-row-actions">
            <button className="st-btn st-btn-primary" onClick={onEvaluate}>See the Report</button>
            <button className="st-btn" onClick={() => void sendOp(OPS.trainStart, voice.id)}>Train Again</button>
          </div>
        </>
      ) : (
        <>
          <span className="vl-granted-icon vl-icon-soft"><HikariFlower /></span>
          <h2>{voice.status === "failed" || progress?.stage === "failed" ? "Training didn't finish" : "Train the voice"}</h2>
          <p className="vl-note">
            {saved >= voice.minClips
              ? `${saved} lines recorded. Training runs on this Mac and takes a while; Hikari keeps working meanwhile.`
              : `Record at least ${voice.minClips} lines first (${saved} so far). More lines make a better voice: the full script has ${voice.targetClips}.`}
          </p>
          {progress?.stage === "failed" && progress.message && <p className="vl-error">{progress.message}</p>}
          <div className="vl-row-actions">
            <button className="st-btn st-btn-primary" disabled={!canTrain(voice, takes)} onClick={() => void sendOp(OPS.trainStart, voice.id)}>Start Training</button>
            {saved < voice.targetClips && <button className="st-btn" onClick={onRecord}>Record More</button>}
          </div>
        </>
      )}
      {error && <p className="vl-error" role="alert"><IconWarn /> {error.message}</p>}
    </div>
  );
}

/** The core's `eval.report`: metrics against their targets, and samples to listen to. */
export function EvalReportView({ report, onRerun }: { report?: EvalReport; onRerun: () => void }) {
  const player = usePlayer();
  if (!report) return <Empty icon={<HikariFlower />} title="No report yet">The core writes one when training finishes.</Empty>;
  return (
    <div className="vl-report">
      {report.summary && <p className="vl-summary">{report.summary}</p>}
      <div className="vl-metrics">
        {report.metrics.map((m) => {
          const ok = meetsTarget(m);
          return (
            <div key={m.key} className={`vl-metric${ok === true ? " pass" : ok === false ? " fail" : ""}`}>
              <span className="vl-metric-label">{m.label}</span>
              <b className="vl-metric-value">{formatMetric(m)}</b>
              <span className="vl-metric-target">
                {m.target !== undefined ? <>{ok ? "Meets" : "Misses"} target {m.better === "higher" ? "≥" : "≤"} {formatMetric(m, m.target)}</> : m.better === "higher" ? "Higher is better" : "Lower is better"}
              </span>
              {m.note && <span className="vl-fine">{m.note}</span>}
            </div>
          );
        })}
      </div>
      {report.samples.length > 0 && (
        <>
          <h3 className="vl-h3">Listen</h3>
          <ul className="vl-samples">
            {report.samples.map((s) => (
              <li key={s.id}>
                <PlayButton label={s.label} playing={player.playing === s.id} onPlay={() => player.play(s.id, { base64: s.audio })} onStop={player.stop} />
                {s.text && <span className="vl-sample-text">{s.text}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="vl-row-actions">
        <button className="st-btn" onClick={onRerun}>Evaluate Again</button>
        {report.at && <span className="vl-fine">Report from {new Date(report.at < 1e12 ? report.at * 1000 : report.at).toLocaleString()}</span>}
      </div>
    </div>
  );
}
