import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { CLAP_OPEN, CLAP_SHUT, GESTURES, PoseSpring, envelope, fitClap, idlePose, resolveGesture, setClapTargets } from "./gestures";
import { LIMITS, REST, addPoses, clampPose, poseToBones, type Pose } from "./pose";

/**
 * Forward kinematics on a VRoid-proportioned normalized skeleton (≈1.5 m girl, T-pose facing +Z, metres).
 * Joint positions are offsets from the parent joint; torso rotations are applied too.
 */
const SKELETON = {
  spine: [0, 0.95, 0], chest: [0, 0.12, 0], neck: [0, 0.22, 0], head: [0, 0.08, 0],
  shoulder: [0.02, 0.18, 0], upperArm: [0.07, 0.01, 0], lowerArm: [0.21, 0, 0], hand: [0.2, 0, 0], tip: [0.15, 0, 0],
} as const;

type V = readonly number[];
const v3 = (a: V, mirror = false) => new Vector3(mirror ? -a[0] : a[0], a[1], a[2]);

/** World positions of the arm joints and fingertip for a pose. */
function fk(pose: Pose, side: "L" | "R") {
  const s = side === "L" ? "left" : "right", m = side === "R";
  const bones = poseToBones(pose);
  const q = new Quaternion();
  const p = v3(SKELETON.spine);
  const step = (offset: Vector3, rot?: Quaternion) => {
    p.add(offset.applyQuaternion(q));
    if (rot) q.multiply(rot);
    return p.clone();
  };
  q.multiply(bones.get("spine")!);
  step(v3(SKELETON.chest), bones.get("chest"));
  step(v3(SKELETON.shoulder, m), bones.get(`${s}Shoulder`));
  const upper = step(v3(SKELETON.upperArm, m), bones.get(`${s}UpperArm`));
  const elbow = step(v3(SKELETON.lowerArm, m), bones.get(`${s}LowerArm`));
  const wrist = step(v3(SKELETON.hand, m), bones.get(`${s}Hand`));
  const tip = step(v3(SKELETON.tip, m));
  return { upper, elbow, wrist, tip, palm: wrist.clone().lerp(tip, 0.4) };
}

/** Head-local landmarks (no head rotation). */
const NECK_Y = 0.95 + 0.12 + 0.22;
const CHIN = new Vector3(0, NECK_Y + 0.07, 0.12);
const BROW = new Vector3(0, NECK_Y + 0.16, 0.13);

const full = (g: string, t: number) => clampPose(addPoses(REST, GESTURES[g].pose(t)));
const peak = (g: string) => full(g, 0.5);

describe("VRM gesture kinematics (no broken shoulders or elbows)", () => {
  it("rest: hands hang beside the hips, a little in front of the body, not inside it", () => {
    for (const side of ["L", "R"] as const) {
      const { wrist, elbow } = fk(REST, side);
      expect(Math.abs(wrist.x)).toBeGreaterThan(0.14);
      expect(Math.abs(wrist.x)).toBeLessThan(0.3);
      expect(wrist.y).toBeLessThan(0.95);
      expect(wrist.z).toBeGreaterThan(0);
      expect(elbow.y).toBeLessThan(1.15);
    }
  });

  it("left and right mirror each other (rest and symmetric gestures)", () => {
    for (const p of [REST, peak("clap"), peak("shrug"), peak("bow")]) {
      const l = fk(p, "L").tip, r = fk(p, "R").tip;
      expect(l.x).toBeCloseTo(-r.x, 5);
      expect(l.y).toBeCloseTo(r.y, 5);
      expect(l.z).toBeCloseTo(r.z, 5);
    }
  });

  it("wave raises the hand beside the head, palm toward the viewer, forearm upright", () => {
    const { wrist, elbow } = fk(peak("wave"), "R");
    expect(wrist.y).toBeGreaterThan(NECK_Y + 0.02);
    expect(wrist.y - elbow.y).toBeGreaterThan(0.12);
    expect(wrist.x).toBeLessThan(-0.08); // her right side, beside the head (inside a narrow stage window)
    expect(wrist.x).toBeGreaterThan(-0.3);
    expect(wrist.z).toBeGreaterThan(-0.05);
  });

  it("think_chin brings the right hand to the chin", () => {
    const { palm } = fk(peak("think_chin"), "R");
    expect(palm.distanceTo(CHIN)).toBeLessThan(0.08);
  });

  it("facepalm brings the right palm to the brow", () => {
    // The head bows into the hand; check the hand against the upright brow minus that bow.
    const { palm } = fk(peak("facepalm"), "R");
    expect(palm.distanceTo(BROW)).toBeLessThan(0.11);
  });

  it("clap: palms meet in front of the chest at the beat, and open a hand apart between beats", () => {
    let closest = Infinity, widest = 0;
    for (let t = 0.3; t <= 0.7; t += 0.005) {
      const p = full("clap", t);
      const d = fk(p, "L").palm.distanceTo(fk(p, "R").palm);
      closest = Math.min(closest, d);
      widest = Math.max(widest, d);
      const { palm } = fk(p, "L");
      expect(palm.z).toBeGreaterThan(0.12); // in front of the chest, not inside it
      expect(palm.y).toBeGreaterThan(1.0);
      expect(palm.y).toBeLessThan(NECK_Y);
    }
    expect(closest).toBeLessThan(0.05);
    expect(widest).toBeGreaterThan(0.1);
    expect(widest).toBeLessThan(0.3);
  });

  it("cross_arms folds both forearms across the chest without the hands passing through the body", () => {
    const p = peak("cross_arms");
    const l = fk(p, "L"), r = fk(p, "R");
    expect(l.wrist.x).toBeLessThan(0.02); // left hand crosses to her right side
    expect(r.wrist.x).toBeGreaterThan(-0.02);
    for (const a of [l, r]) {
      expect(a.wrist.z).toBeGreaterThan(0.1);
      expect(a.wrist.y).toBeGreaterThan(1.0);
      expect(a.wrist.y).toBeLessThan(1.25);
    }
  });

  it("point reaches forward toward the viewer at chest height", () => {
    const { tip, upper } = fk(peak("point"), "R");
    expect(tip.z - upper.z).toBeGreaterThan(0.4);
    expect(Math.abs(tip.y - upper.y)).toBeLessThan(0.15);
  });

  it("shrug turns the forearms out and up with the elbows at the sides", () => {
    const { wrist, elbow } = fk(peak("shrug"), "R");
    expect(wrist.x).toBeLessThan(elbow.x - 0.05);
    expect(wrist.z).toBeGreaterThan(elbow.z + 0.05);
    expect(Math.abs(elbow.x)).toBeLessThan(0.25);
  });

  it("every gesture stays inside the joint limits and starts and ends at rest", () => {
    for (const [name, g] of Object.entries(GESTURES)) {
      for (const t of [0, 1]) {
        for (const [k, v] of Object.entries(g.pose(t))) expect(Math.abs(v), `${name} ${k} at ${t}`).toBeLessThan(1e-6);
      }
      for (let t = 0; t <= 1; t += 0.01) {
        const p = addPoses(REST, g.pose(t));
        for (const [k, v] of Object.entries(p)) {
          const lim = LIMITS[k];
          if (lim) {
            expect(v, `${name} ${k} at ${t.toFixed(2)}`).toBeGreaterThanOrEqual(lim[0] - 1e-6);
            expect(v, `${name} ${k} at ${t.toFixed(2)}`).toBeLessThanOrEqual(lim[1] + 1e-6);
          }
        }
      }
    }
  });

  it("gesture curves are smooth: no frame-to-frame jumps at 60 fps", () => {
    for (const [name, g] of Object.entries(GESTURES)) {
      const step = 1 / (g.dur * 60);
      let prev = g.pose(0);
      for (let t = step; t <= 1; t += step) {
        const cur = g.pose(t);
        for (const k of new Set([...Object.keys(cur), ...Object.keys(prev)])) {
          // Degrees per frame; 6°/frame = 360°/s, faster than any natural limb motion here.
          expect(Math.abs((cur[k] ?? 0) - (prev[k] ?? 0)), `${name} ${k} at ${t.toFixed(3)}`).toBeLessThan(k.startsWith("index") ? 0.2 : 6);
        }
        prev = cur;
      }
    }
  });
});

describe("gesture helpers", () => {
  it("envelope rises, holds and falls", () => {
    expect(envelope(0)).toBe(0);
    expect(envelope(0.5)).toBe(1);
    expect(envelope(1)).toBe(0);
    expect(envelope(0.1)).toBeGreaterThan(0);
    expect(envelope(0.1)).toBeLessThan(1);
  });

  it("resolves protocol tags, motionMap aliases and stage taps", () => {
    expect(resolveGesture("wave")).toBe("wave");
    expect(resolveGesture("hello", { hello: { group: "nod" } })).toBe("nod");
    expect(resolveGesture("tap_head")).toBe("head_pat_react");
    expect(resolveGesture("no_such_motion")).toBeNull();
  });

  it("idle life is small: breathing and sway never move a joint more than a few degrees", () => {
    for (let t = 0; t < 60; t += 0.37) {
      for (const [k, v] of Object.entries(idlePose(t, 1))) expect(Math.abs(v), k).toBeLessThan(6);
    }
  });

  it("the pose spring reaches its target without overshoot and blends a cut-short gesture", () => {
    const s = new PoseSpring(11);
    let x = 0;
    for (let i = 0; i < 120; i++) {
      x = s.step({ elbowR: 90 }, 1 / 60).elbowR;
      expect(x).toBeLessThanOrEqual(90 + 1e-6);
    }
    expect(x).toBeGreaterThan(89.5);
    // Target removed (gesture cut): it eases back rather than snapping.
    const next = s.step({}, 1 / 60).elbowR;
    expect(next).toBeGreaterThan(85);
    // Large dt stays stable.
    const big = s.step({ elbowR: 0 }, 5);
    expect(Math.abs(big.elbowR ?? 0)).toBeLessThan(1);
  });
});

describe("Clap fitted to each model's proportions", () => {
  it("keeps the default angles when the palms already meet", () => {
    const fit = fitClap(() => ({ gap: 0.03, inFront: true }));
    expect(fit.shut).toBe(CLAP_SHUT);
    expect(fit.open).toBe(CLAP_OPEN);
  });

  it("on broad shoulders, picks the in-front pose that brings the palms closest", () => {
    // A stand-in skeleton: palms meet when the shoulder turns in 55° with the elbow at 125°; behind the chest past 70°.
    const fit = fitClap((t) => ({ gap: Math.abs(t.twist! - 55) * 0.01 + Math.abs(t.elbow! - 125) * 0.004, inFront: t.twist! <= 70 }));
    expect(fit.shut.twist).toBe(55);
    expect(fit.shut.elbow).toBe(125);
    expect(fit.gap).toBeLessThan(0.01);
    // The open pose eases back from it, so the hands part between beats.
    expect(fit.open.twist!).toBeLessThan(fit.shut.twist!);
  });

  it("never picks a pose with the palms behind the chest", () => {
    const fit = fitClap((t) => ({ gap: t.twist! > 60 ? 0 : 0.2, inFront: t.twist! <= 60 }));
    expect(fit.shut.twist!).toBeLessThanOrEqual(60);
  });

  it("the clap gesture uses the fitted angles, and resets to the defaults", () => {
    const shutAt = (p: Pose) => p.elbowL ?? 0;
    const before = shutAt(GESTURES.clap.pose(0.5));
    setClapTargets({ ...CLAP_SHUT, elbow: 140 }, { ...CLAP_OPEN, elbow: 135 });
    expect(shutAt(GESTURES.clap.pose(0.5))).toBeGreaterThan(before);
    setClapTargets();
    expect(shutAt(GESTURES.clap.pose(0.5))).toBeCloseTo(before, 6);
  });
});
