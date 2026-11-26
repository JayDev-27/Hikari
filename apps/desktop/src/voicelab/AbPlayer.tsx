import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlay } from "../studio/icons";
import { canChoose, choose, makeTrial, tally, trialRng, verdict, type AbChoice, type AbPair, type AbResult } from "./ab";
import { usePlayer } from "./audio";
import { wallClock } from "./controls";
import { IconPause } from "./icons";
import { OPS, type Voice } from "./ops";
import type { SendOp } from "./VoiceLab";

/** Secret per window session; mixed with each pair id to decide which sample plays as A. */
const SESSION_SEED = Math.floor(Math.random() * 2 ** 32);
const systemName = (s: string) => ({ base: "Base voice", adapter: "Trained voice", reference: "Real recording" })[s] ?? s;

/**
 * Blind A/B: two renderings of one line, order shuffled per pair; both must be heard before choosing; the systems
 * are revealed after the choice. Each result goes back as `ab.result` (with the running tally).
 */
export function AbPlayer({ voice, pair, sendOp }: { voice: Voice; pair?: AbPair; sendOp: SendOp }) {
  const [heard, setHeard] = useState<{ pairId: string; A: boolean; B: boolean; firstPlay?: number }>({ pairId: "", A: false, B: false });
  const [results, setResults] = useState<AbResult[]>([]);
  const [revealed, setRevealed] = useState<AbResult | null>(null);
  const trial = useMemo(() => (pair ? makeTrial(pair, trialRng(SESSION_SEED, pair.pairId)) : undefined), [pair]);
  const listened = trial && heard.pairId === trial.pairId ? heard : { A: false, B: false, firstPlay: undefined };
  const player = usePlayer((id) => {
    if (!trial) return;
    const side = id === `${trial.pairId}:A` ? "A" : id === `${trial.pairId}:B` ? "B" : null;
    if (side) setHeard((h) => (h.pairId === trial.pairId ? { ...h, [side]: true } : { pairId: trial.pairId, A: side === "A", B: side === "B" }));
  });
  const asked = useRef(false);

  // Ask for the first pair when the tab opens.
  useEffect(() => {
    if (pair || asked.current) return;
    asked.current = true;
    void sendOp(OPS.abNext, voice.id).catch(() => undefined);
  }, [pair, sendOp, voice.id]);

  const t = tally(results);
  const answered = revealed && trial && revealed.pairId === trial.pairId;

  const play = (side: "A" | "B") => {
    if (!trial) return;
    const id = `${trial.pairId}:${side}`;
    if (player.playing === id) return player.stop();
    setHeard((h) => (h.pairId === trial.pairId ? { ...h, firstPlay: h.firstPlay ?? wallClock() } : { pairId: trial.pairId, A: false, B: false, firstPlay: wallClock() }));
    player.play(id, { base64: trial[side].audio });
  };

  const pick = (c: AbChoice) => {
    if (!trial || !canChoose(listened)) return;
    player.stop();
    const r = choose(trial, c, { A: listened.A, B: listened.B }, wallClock() - (listened.firstPlay ?? wallClock()));
    const all = [...results, r];
    setResults(all);
    setRevealed(r);
    void sendOp(OPS.abResult, voice.id, { ...r, tally: tally(all) }).catch(() => undefined);
  };

  const next = () => {
    player.stop();
    setRevealed(null);
    void sendOp(OPS.abNext, voice.id).catch(() => undefined);
  };

  if (!trial) return <div className="vl-center"><span className="st-spinner" aria-label="Loading a pair" /></div>;
  const ready = canChoose(listened);

  return (
    <div className="vl-ab">
      <p className="vl-note vl-centered">Listen to both, then pick the one that sounds more like {voice.owner === "other" ? voice.speakerName ?? "the speaker" : "you"} and more natural. You won't know which is which until you choose.</p>
      {trial.text && <p className="vl-ab-text">“{trial.text}”</p>}
      <div className="vl-ab-tiles">
        {(["A", "B"] as const).map((side) => {
          const on = player.playing === `${trial.pairId}:${side}`;
          return (
            <button key={side} className={`vl-ab-tile${on ? " on" : ""}${listened[side] ? " heard" : ""}`} onClick={() => play(side)} aria-label={`${on ? "Stop" : "Play"} sample ${side}`}>
              <span className="vl-ab-letter">{side}</span>
              <span className="vl-ab-play">{on ? <IconPause /> : <IconPlay />}</span>
              <span className="vl-ab-state">{answered ? systemName(trial[side].system) : listened[side] ? "Heard" : "Not heard yet"}</span>
            </button>
          );
        })}
      </div>
      {answered ? (
        <div className="vl-ab-after">
          <p>
            {revealed.preferred ? <>You preferred <b>{systemName(revealed.preferred)}</b>.</> : "No preference this time."}
          </p>
          <button className="st-btn st-btn-primary" onClick={next}>Next Pair</button>
        </div>
      ) : (
        <div className="vl-ab-choices">
          <button className="st-btn" disabled={!ready} onClick={() => pick("A")}>A is better</button>
          <button className="st-btn st-btn-plain" disabled={!ready} onClick={() => pick("same")}>About the same</button>
          <button className="st-btn" disabled={!ready} onClick={() => pick("B")}>B is better</button>
        </div>
      )}
      {!ready && !answered && <p className="vl-fine vl-centered">Play both to the end to choose.</p>}
      <div className="vl-ab-tally" aria-live="polite">
        <span>{verdict(t, systemName)}</span>
        {t.trials > 0 && <span className="vl-fine">{t.trials} {t.trials === 1 ? "pair" : "pairs"} · {t.ties} ties{t.trials - t.ties >= 6 && Math.abs(t.aShare - 0.5) > 0.3 ? ` · you picked A ${Math.round(t.aShare * 100)}% of the time` : ""}</span>}
      </div>
    </div>
  );
}
