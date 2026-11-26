import type { LayerFrame } from "./animator";

/**
 * Layer frame → renderer parameters. Live2D and Iki share the Cubism parameter convention (ParamAngleX turn toward
 * the viewer's right, ParamAngleY up, ParamAngleZ / ParamBodyAngleZ top toward the viewer's right, ParamBodyAngleY
 * up / negative bows); VRM uses its own joint channels (vrm/pose.ts). Only offsets: each renderer adds them on top
 * of its base life and under its gestures.
 */

export type Offsets = Record<string, number>;

/** State posture + post-gesture settle as Cubism-style parameter offsets (degrees; brows -1..1). */
export function cubismOffsets(f: LayerFrame, scale = 1): Offsets {
  const p = f.posture, s = f.settle;
  return {
    ParamAngleX: (p.headYaw) * scale,
    ParamAngleY: (p.headPitch + s.pitch) * scale,
    ParamAngleZ: (p.headRoll + 0.6 * s.roll) * scale,
    ParamBodyAngleX: p.bodyYaw * scale,
    ParamBodyAngleY: (-p.bodyLean - s.lean) * scale,
    ParamBodyAngleZ: (p.bodyRoll + s.roll) * scale,
    ParamBrowLY: 0.5 * f.brow,
    ParamBrowRY: 0.5 * f.brow,
  };
}

/** The same posture on VRM joint channels (vrm/pose.ts: +headX nods down, +headY turns to the viewer's right,
 *  +headZ rolls toward the viewer's left, +spineX leans forward). */
export function vrmOffsets(f: LayerFrame): Offsets {
  const p = f.posture, s = f.settle;
  return {
    headX: -(p.headPitch + s.pitch),
    headY: p.headYaw,
    headZ: -(p.headRoll + 0.6 * s.roll),
    neckX: -0.3 * p.headPitch,
    spineX: 0.6 * (p.bodyLean + s.lean),
    chestX: 0.4 * (p.bodyLean + s.lean),
    chestY: p.bodyYaw,
    spineZ: -(p.bodyRoll + s.roll),
    shoulderL: p.shoulders,
    shoulderR: p.shoulders,
  };
}

/** Eye-open parameter value from what the rig/blink wrote: closed by `eyeClose`, widened a little by `eyeWiden`. */
export function eyeOpenValue(current: number, f: LayerFrame, max = 1): number {
  const v = current * (1 - f.eyeClose) + f.eyeWiden * (1 - f.eyeClose) * 0.5;
  return Math.max(0, Math.min(max, v));
}
