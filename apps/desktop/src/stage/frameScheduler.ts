/**
 * Render-rate policy for the stage (§9 / §9.5):
 *  - active  60 fps — speaking, gestures, hover/drag, listening/thinking, eyes catching up
 *  - idle    30 fps — breathing + blinking stay smooth, but half the GPU/CPU work
 *  - paused   0 fps — stage hidden: no requestAnimationFrame at all
 *
 * Runs inside requestAnimationFrame and skips ticks to hit the target rate, so it
 * stays vsync-aligned on 60 Hz and 120 Hz (ProMotion) displays. When macOS Low
 * Power Mode caps rAF at 30 fps, both tiers simply get every tick.
 */
export type FrameTier = "active" | "idle" | "paused";
export const TIER_FPS: Record<FrameTier, number> = { active: 60, idle: 30, paused: 0 };

export class FrameScheduler {
  private lastRender = Number.NEGATIVE_INFINITY;
  private activeUntil = Number.NEGATIVE_INFINITY;

  /** @param tailMs keep the active rate this long after the last activity (envelopes/blends settle). */
  constructor(private readonly tailMs = 800) {}

  /** Mark activity now (cursor moved, gesture fired, audio playing…). */
  poke(now: number): void {
    this.activeUntil = Math.max(this.activeUntil, now + this.tailMs);
  }

  tier(now: number, visible: boolean, busy: boolean): FrameTier {
    if (!visible) return "paused";
    if (busy) this.poke(now);
    return now < this.activeUntil ? "active" : "idle";
  }

  /** Call on every rAF tick; returns true when a frame should be rendered. */
  shouldRender(now: number, tier: FrameTier): boolean {
    const fps = TIER_FPS[tier];
    if (fps === 0) return false;
    // 2 ms slack absorbs rAF jitter so 30 fps on a 60 Hz display is every other tick.
    if (now - this.lastRender < 1000 / fps - 2) return false;
    this.lastRender = now;
    return true;
  }

  /** Forget timing after a pause so the first frame back isn't skipped. */
  reset(): void {
    this.lastRender = Number.NEGATIVE_INFINITY;
  }
}
