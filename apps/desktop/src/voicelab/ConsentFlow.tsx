import { useMemo, useState } from "react";
import { IconCheck } from "../studio/icons";
import { attestations, canAdvance, consentRecord, consentStatement, RELATIONSHIPS, STATEMENT_MIN_MS, stepLabel, stepsFor, type ConsentEvent, type ConsentState } from "./consent";
import { finishTake, usePlayer, useRecorder } from "./audio";
import { LevelMeter, PlayButton, RecordButton, seconds, wallClock } from "./controls";
import { IconPeople, IconPerson, IconRedo, IconShield } from "./icons";
import { OPS, type Voice } from "./ops";
import type { SendOp } from "./VoiceLab";

/**
 * The consent flow for one voice. Recording is unlocked only when the core confirms the record it was sent
 * (state.ts turns the core's `consent.check` into `granted`); this component never grants anything itself.
 */
export function ConsentFlow({ voice, state, dispatch, sendOp, onRecord }: {
  voice: Voice;
  state: ConsentState;
  dispatch: (e: ConsentEvent) => void;
  sendOp: SendOp;
  onRecord: () => void;
}) {
  const today = useMemo(() => new Date(wallClock()), []);
  const statementText = consentStatement(state.speakerName || "…", today);
  const rec = useRecorder(state.step === "statement");
  const player = usePlayer();
  const [statementUrl, setStatementUrl] = useState<string>();
  const steps = stepsFor(state.owner);
  const at = steps.indexOf(state.step === "submitting" ? "attest" : state.step);

  const stopStatement = () => {
    const { samples, rate } = rec.stop();
    const take = finishTake(samples, rate, { minMs: 1000, maxMs: 90_000 });
    setStatementUrl(take.url);
    dispatch({ type: "statement", clip: { wavBase64: take.wavBase64, sampleRate: take.sampleRate, durationMs: take.stats.durationMs, peak: take.stats.peak } });
  };

  const submit = () => {
    const record = consentRecord(state, state.owner === "other" ? statementText : undefined, wallClock());
    dispatch({ type: "submit" });
    sendOp(OPS.consentRecord, voice.id, record).catch((e: unknown) => dispatch({ type: "refused", reason: `Couldn't reach the core: ${String(e)}` }));
  };

  if (state.step === "granted") {
    return (
      <div className="vl-card vl-granted">
        <span className="vl-granted-icon"><IconShield /></span>
        <h2>Consent on record</h2>
        <p>
          {state.owner === "other" ? `${state.speakerName || voice.speakerName || "The speaker"} agreed to their voice being used for Hikari` : "You confirmed this is your own voice"}
          {state.grantedAt ? `, ${new Date(state.grantedAt < 1e12 ? state.grantedAt * 1000 : state.grantedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : ""}.
        </p>
        {state.consentId && <p className="vl-fine">Record {state.consentId}</p>}
        <button className="st-btn st-btn-primary" onClick={onRecord}>Start Recording</button>
        <p className="vl-fine">To withdraw consent, delete this voice: its recordings and the trained voice go with it.</p>
      </div>
    );
  }

  return (
    <div className="vl-card vl-consent">
      <ol className="vl-steps" aria-label="Consent steps">
        {steps.map((s, i) => (
          <li key={s} className={i < at ? "done" : i === at ? "on" : ""}>
            <span className="vl-step-dot">{i < at ? <IconCheck /> : i + 1}</span>{stepLabel[s]}
          </li>
        ))}
      </ol>

      {state.step === "owner" && (
        <section className="vl-step" aria-labelledby="vl-owner-h">
          <h2 id="vl-owner-h">Whose voice is this?</h2>
          <div className="vl-options" role="radiogroup">
            <button role="radio" aria-checked={state.owner === "self"} className={`vl-option${state.owner === "self" ? " on" : ""}`} onClick={() => dispatch({ type: "owner", owner: "self" })}>
              <IconPerson /><b>My own voice</b><span>You'll read the script yourself.</span>
            </button>
            <button role="radio" aria-checked={state.owner === "other"} className={`vl-option${state.owner === "other" ? " on" : ""}`} onClick={() => dispatch({ type: "owner", owner: "other" })}>
              <IconPeople /><b>Someone else's voice</b><span>They read a consent statement first, in their own voice. They need to be with you.</span>
            </button>
          </div>
          <p className="vl-note">Only make a voice with the clear permission of the person it belongs to. Celebrities, public figures and anyone who can't agree for themselves are off limits.</p>
        </section>
      )}

      {state.step === "speaker" && (
        <section className="vl-step" aria-labelledby="vl-speaker-h">
          <h2 id="vl-speaker-h">Who is the speaker?</h2>
          <label className="vl-field">
            <span>Their name</span>
            <input value={state.speakerName} autoFocus maxLength={60} placeholder="Full name" onChange={(e) => dispatch({ type: "speaker", speakerName: e.target.value })} />
          </label>
          <label className="vl-field">
            <span>They are your…</span>
            <select value={state.relationship} onChange={(e) => dispatch({ type: "speaker", relationship: e.target.value })}>
              <option value="" disabled>Choose</option>
              {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <p className="vl-note">Next, {state.speakerName.trim() || "they"} will read a short statement aloud. Changing the name later means recording it again.</p>
        </section>
      )}

      {state.step === "statement" && (
        <section className="vl-step" aria-labelledby="vl-statement-h">
          <h2 id="vl-statement-h">{state.speakerName.trim()} reads this aloud</h2>
          <blockquote className="vl-statement">{statementText}</blockquote>
          <div className="vl-statement-controls">
            <RecordButton state={rec.state} label={state.statement ? "Record Again" : "Record Statement"} onStart={() => { player.stop(); rec.start(); }} onStop={stopStatement} />
            <LevelMeter rms={rec.level.rms} peak={rec.level.peak} live={rec.state === "ready" || rec.state === "recording"} />
          </div>
          {rec.error && <p className="vl-error">{rec.error}</p>}
          {rec.fake && <p className="vl-fine">Preview: using a synthetic microphone.</p>}
          {state.statement && rec.state !== "recording" && (
            <div className="vl-take-row">
              <PlayButton label={`Statement · ${seconds(state.statement.durationMs)}`} playing={player.playing === "statement"} disabled={!statementUrl}
                onPlay={() => statementUrl && player.play("statement", { url: statementUrl })} onStop={player.stop} />
              <button className="st-btn st-btn-plain" onClick={() => { player.stop(); dispatch({ type: "clearStatement" }); }}><IconRedo /> Discard</button>
              {!canAdvance(state) && (
                <span className="vl-warn">{state.statement.durationMs < STATEMENT_MIN_MS ? "That's too short for the whole statement. Record it again." : "That was too quiet to hear. Record it again."}</span>
              )}
            </div>
          )}
          <p className="vl-note">The recording is kept with the voice as proof of consent.</p>
        </section>
      )}

      {(state.step === "attest" || state.step === "submitting") && state.owner && (
        <section className="vl-step" aria-labelledby="vl-attest-h">
          <h2 id="vl-attest-h">Confirm</h2>
          <div className="vl-attest">
            {attestations(state.owner, state.speakerName).map((a) => (
              <label key={a.key} className="vl-check">
                <input type="checkbox" checked={state.attest[a.key] === true} disabled={state.step === "submitting"} onChange={(e) => dispatch({ type: "attest", key: a.key, value: e.target.checked })} />
                <span>{a.text}</span>
              </label>
            ))}
          </div>
          {state.error && <p className="vl-error" role="alert">{state.error}</p>}
        </section>
      )}

      <footer className="vl-step-nav">
        {at > 0 && <button className="st-btn" disabled={state.step === "submitting" || rec.state === "recording"} onClick={() => dispatch({ type: "back" })}>Back</button>}
        <span className="vl-spacer" />
        {state.step === "submitting" ? (
          <span className="vl-saving"><span className="st-spinner" /> Saving the consent record…</span>
        ) : state.step === "attest" ? (
          <button className="st-btn st-btn-primary" disabled={!canAdvance(state)} onClick={submit}>Agree and Continue</button>
        ) : (
          <button className="st-btn st-btn-primary" disabled={!canAdvance(state) || rec.state === "recording"} onClick={() => dispatch({ type: "next" })}>Continue</button>
        )}
      </footer>
    </div>
  );
}
