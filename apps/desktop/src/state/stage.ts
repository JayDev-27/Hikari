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
  setCore(v: boolean): void;
  setState(s: AvatarState): void;
  setCaption(c: string): void;
  mark(stage: LatencyMark["stage"], ms: number): void;
  toggleDebug(): void;
  setFps(f: number): void;
}

export const useStage = create<StageStore>((set) => ({
  core: false,
  state: "idle",
  caption: "",
  latency: {},
  debug: import.meta.env.DEV,
  fps: 0,
  setCore: (core) => set({ core }),
  setState: (state) => set({ state }),
  setCaption: (caption) => set({ caption }),
  mark: (stage, ms) => set((s) => ({ latency: stage === "eos" ? { eos: ms } : { ...s.latency, [stage]: Math.round(ms) } })),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setFps: (fps) => set({ fps }),
}));
