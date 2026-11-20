import type { Emotion, GestureTag } from "@hikari/protocol";

/** VRM 1.0 viseme set (あいうえお). Live2D maps these to MouthOpenY/MouthForm. */
export interface Visemes {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}
export const ZERO_VISEMES: Visemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "working" | "sleeping" | "waking";

export type AvatarEvent =
  | { kind: "click"; area: string }
  | { kind: "drag-start" }
  | { kind: "drag-end" }
  | { kind: "poke"; area: string };

/**
 * Renderer-agnostic avatar API (§2). Live2D and VRM both implement it, so every
 * higher layer (lip sync, gestures, emotion) drives either renderer unchanged.
 */
export interface AvatarController {
  readonly renderer: "live2d" | "vrm";
  setExpression(emotion: Emotion, intensity: number): void;
  playMotion(name: GestureTag | string, opts?: { priority?: number }): void;
  /** Normalised -1..1 target in model space (0,0 = straight ahead). */
  lookAt(x: number, y: number): void;
  setVisemes(weights: Visemes): void;
  setState(state: AvatarState): void;
  idle(): void;
  react(event: AvatarEvent): void;
  /** Is the given canvas-space point on a visible part of the model? (click-through) */
  hitTest(x: number, y: number): string | null;
  /** True while a gesture/reaction motion plays (beyond idle life). */
  isBusy?(): boolean;
  /** Called once per frame by the stage loop with seconds since last frame. */
  update(dt: number): void;
  resize(width: number, height: number): void;
  destroy(): void;
}
