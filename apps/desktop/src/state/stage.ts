import { create } from "zustand";
import type { LatencyMark } from "@hikari/protocol";
import type { AvatarState } from "../avatar/types";

interface StageStore {
  core: boolean;
  state: AvatarState;
  caption: string;
  latency: Partial<Record<LatencyMark["stage"], number>>;
  debug: boolean;
  fps: number;
  tier: string;
  /** Debug: AudioContext state and current mouth opening (0..1). */
  audio: { ctx: string; mouth: number };
  setAudio(a: { ctx: string; mouth: number }): void;
  /** Mic: mode, mute, open, live level (0..1) and device label. */
  mic: { mode: "ptt" | "open"; muted: boolean; open: boolean; level: number; voiced: boolean; label: string; error: string };
  setMic(m: Partial<StageStore["mic"]>): void;
  setCore(v: boolean): void;
  setState(s: AvatarState): void;
  setCaption(c: string): void;
  mark(stage: LatencyMark["stage"], ms: number): void;
  toggleDebug(): void;
  setFps(f: number, tier?: string): void;
}

export const useStage = create<StageStore>((set) => ({
  core: false,
  state: "idle",
  caption: "",
  latency: {},
  // Dev overlay on by default in dev; VITE_DEBUG_OVERLAY=0 hides it (clean captures).
  debug: import.meta.env.DEV && import.meta.env.VITE_DEBUG_OVERLAY !== "0",
  fps: 0,
  tier: "–",
  audio: { ctx: "–", mouth: 0 },
  setAudio: (audio) => set({ audio }),
  mic: { mode: "ptt", muted: false, open: false, level: 0, voiced: false, label: "", error: "" },
  setMic: (m) => set((s) => ({ mic: { ...s.mic, ...m } })),
  setCore: (core) => set({ core }),
  setState: (state) => set({ state }),
  setCaption: (caption) => set({ caption }),
  mark: (stage, ms) => set((s) => ({ latency: stage === "eos" ? { eos: ms } : { ...s.latency, [stage]: Math.round(ms) } })),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setFps: (fps, tier) => set(tier ? { fps, tier } : { fps }),
}));
