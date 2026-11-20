import { msg, type Phoneme } from "@hikari/protocol";
import { encodePcm16 } from "../audio/playback";
import { analyzeSync, ctxToPerfMs, type FrameSample } from "../lipsync/avsync";
import type { StageRuntime } from "../stage/runtime";

/**
 * In-app A/V sync probe (dev: VITE_AVSYNC=1). Plays a calibrated turn — sharp
 * "a" bursts separated by silence — through the real path (protocol → playback
 * queue → lip sync → renderer), records the mouth opening on every rendered
 * frame, and compares each burst's *heard* onset (AudioContext output timestamp,
 * which includes the output device's latency) with the first displayed frame
 * where the mouth is half open. Logs one `AVSYNC {json}` line.
 *
 * Ground truth is WebAudio's own output-latency estimate, not a microphone, so
 * this validates our scheduling and compensation; acoustic truth needs a
 * loopback device or mic.
 */
const SR = 24000;
const BURSTS = 10;
const GAP_MS = 450;
const VOWEL_MS = 150;

interface Sample extends FrameSample {
  ctx: number;
  perf: number;
}

function buildTurn(): { pcm: Float32Array; phonemes: Phoneme[]; onsetsMs: number[] } {
  const phonemes: Phoneme[] = [];
  const onsetsMs: number[] = [];
  let t = 0;
  for (let i = 0; i < BURSTS; i++) {
    phonemes.push({ p: "sil", start: t, end: t + GAP_MS });
    t += GAP_MS;
    onsetsMs.push(t);
    phonemes.push({ p: "a", start: t, end: t + VOWEL_MS });
    t += VOWEL_MS;
  }
  phonemes.push({ p: "sil", start: t, end: t + GAP_MS });
  t += GAP_MS;
  const pcm = new Float32Array(Math.ceil((t / 1000) * SR));
  for (const on of onsetsMs) {
    const s0 = Math.round((on / 1000) * SR);
    const n = Math.round((VOWEL_MS / 1000) * SR);
    for (let i = 0; i < n; i++) {
      // Sharp onset (1 ms ramp): a buzz with energy around the /a/ formants.
      const env = Math.min(1, i / 24, (n - i) / 240);
      let v = 0;
      for (let h = 1; h <= 12; h++) v += Math.sin((2 * Math.PI * 200 * h * i) / SR) * Math.exp(-(((200 * h - 800) / 500) ** 2));
      pcm[s0 + i] = 0.25 * env * v;
    }
  }
  return { pcm, phonemes, onsetsMs };
}

export async function runAvSyncProbe(rt: StageRuntime): Promise<void> {
  const { pcm, phonemes, onsetsMs } = buildTurn();
  const samples: Sample[] = [];
  const ctx = rt.playback.ctx;
  rt.onFrame = (t, open) => {
    const ts = ctx.getOutputTimestamp();
    samples.push({ t, open, ctx: ts.contextTime ?? 0, perf: ts.performanceTime ?? 0 });
  };

  const turnId = "avsync";
  rt.core.inject(msg("turn.start", { reason: "text" }, { turnId }));
  rt.core.inject(
    msg("tts.chunk", { seq: 0, sampleRate: SR, encoding: "pcm_s16le", pcm: encodePcm16(pcm), text: "A/V sync probe", phonemes, phonemeSource: "tts" }, { turnId }),
  );
  const chunk = rt.playback.scheduled.find((c) => c.seq === 0);
  if (!chunk) throw new Error("probe chunk was not scheduled");
  const totalMs = (pcm.length / SR) * 1000;
  await new Promise((r) => setTimeout(r, totalMs + 800));
  rt.onFrame = undefined;

  // Heard onset of each burst on the performance clock, using the output
  // timestamp captured at the frame nearest that moment (clock drift-safe).
  const valid = samples.filter((s) => s.perf > 0);
  if (!valid.length) {
    console.warn(`AVSYNC ${JSON.stringify({ pass: false, error: "no output timestamps (AudioContext not running?)", frames: samples.length, ctxState: ctx.state })}`);
    return;
  }
  const audioOnsets = onsetsMs.map((ms) => {
    const ctxOnset = chunk.ctxStart + ms / 1000;
    const near = valid.reduce((best, s) => (Math.abs(s.ctx - ctxOnset) < Math.abs(best.ctx - ctxOnset) ? s : best), valid[0]);
    return ctxToPerfMs(ctxOnset, { contextTime: near.ctx, performanceTime: near.perf });
  });
  const dts = samples.slice(1).map((s, i) => s.t - samples[i].t).sort((a, b) => a - b);
  const frameMs = dts[Math.floor(dts.length / 2)] ?? 16.7;
  const raw = analyzeSync(audioOnsets, samples);
  const displayed = analyzeSync(audioOnsets, samples, { displayLatencyMs: frameMs });
  const round = (x: number) => Math.round(x * 10) / 10;
  const report = {
    pass: displayed.pass,
    toleranceMs: displayed.toleranceMs,
    offsetsMs: displayed.offsets.map(round),
    meanMs: round(displayed.meanMs),
    minMs: round(displayed.minMs),
    maxMs: round(displayed.maxMs),
    jitterMs: round(displayed.jitterMs),
    missed: displayed.missed,
    rawMeanMs: round(raw.meanMs),
    frameMs: round(frameMs),
    frames: samples.length,
    outputLatencyMs: round((ctx.outputLatency || 0) * 1000),
    baseLatencyMs: round((ctx.baseLatency || 0) * 1000),
    sampleRate: ctx.sampleRate,
  };
  console.warn(`AVSYNC ${JSON.stringify(report)}`);
}
