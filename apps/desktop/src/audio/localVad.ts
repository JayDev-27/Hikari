/**
 * Local voice-activity detector for *barge-in only* (the core runs Silero VAD +
 * turn detection for real turn-taking). Works on 20 ms frames of the
 * echo-cancelled mic signal:
 *
 *  - noise floor by minimum statistics: the quietest frame RMS of the last
 *    ~1.5 s. Speech always has dips between words, steady noise (fans, hum)
 *    doesn't, so the floor follows the room but never learns the user's voice
 *  - a frame is "voiced" when RMS > max(floor × ratio, minRms)
 *  - speech run = voiced frames with short gaps tolerated (hangover)
 *
 * Barge-in policy (research 03 §6): duck her voice after `duckMs` of speech, cut
 * her off after `cutMs`; if the user stops before `cutMs`, un-duck.
 */
export type BargeAction = "none" | "duck" | "cut" | "unduck";

export interface VadOptions {
  frameMs?: number;
  ratio?: number;
  minRms?: number;
  duckMs?: number;
  cutMs?: number;
  hangoverMs?: number;
  floorWindowMs?: number;
}

export class LocalVad {
  private floor = 0.005;
  private recent: number[] = [];
  private runMs = 0;
  private gapMs = 0;
  private ducked = false;
  private cut = false;
  private wasSpeaking = false;
  readonly o: Required<VadOptions>;

  constructor(opts: VadOptions = {}) {
    this.o = { frameMs: 20, ratio: 3, minRms: 0.02, duckMs: 250, cutMs: 450, hangoverMs: 120, floorWindowMs: 1500, ...opts };
  }

  /** True if the last frame counted as speech. */
  voiced = false;

  /**
   * Feed one frame's RMS. `herSpeaking`: Hikari's audio is playing (barge-in only
   * matters then). Returns what the stage should do with her playback.
   */
  push(rms: number, herSpeaking: boolean): BargeAction {
    const { frameMs, ratio, minRms, duckMs, cutMs, hangoverMs } = this.o;
    this.voiced = rms > Math.max(this.floor * ratio, minRms);
    this.recent.push(rms);
    if (this.recent.length > Math.round(this.o.floorWindowMs / frameMs)) this.recent.shift();
    // Smooth toward the window minimum (falls fast, rises gently).
    const min = Math.max(0.001, Math.min(...this.recent));
    this.floor += (min - this.floor) * (min < this.floor ? 0.5 : 0.1);

    // Only speech that starts while she is talking counts as an interruption: the
    // tail of the user's own turn must not instantly "cut" her reply.
    if (herSpeaking && !this.wasSpeaking) {
      this.runMs = 0;
      this.gapMs = 0;
      this.cut = false;
      this.ducked = false;
    }
    this.wasSpeaking = herSpeaking;

    if (this.voiced) {
      this.runMs += frameMs;
      this.gapMs = 0;
    } else if (this.runMs > 0) {
      this.gapMs += frameMs;
      if (this.gapMs > hangoverMs) {
        this.runMs = 0;
        this.gapMs = 0;
        this.cut = false; // a new interruption may cut again
      }
    }

    if (!herSpeaking) {
      const wasDucked = this.ducked;
      this.ducked = false;
      this.cut = false;
      return wasDucked ? "unduck" : "none";
    }
    if (this.cut) return "none";
    if (this.runMs >= cutMs) {
      this.cut = true;
      this.ducked = false;
      return "cut";
    }
    if (this.runMs >= duckMs && !this.ducked) {
      this.ducked = true;
      return "duck";
    }
    if (this.runMs === 0 && this.ducked) {
      this.ducked = false;
      return "unduck";
    }
    return "none";
  }

  get noiseFloor(): number {
    return this.floor;
  }
}
