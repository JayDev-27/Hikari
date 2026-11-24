import { describe, expect, it } from "vitest";
import { CLAP_CONTACT, CLAP_OPEN, CLAP_OPEN_DEPTH, GESTURES, SpringSet, addPoses, applyOffsets, foldClap, idlePose, limitArmLift, resolveGesture, restoreBases, softLimit } from "./gestures";

/** Iki's standard full-body ranges (as auto-rigged), plus eye openness 0..1. */
const RANGE: Record<string, [number, number]> = {
  ParamArmL: [-8, 32], ParamArmR: [-8, 32], ParamElbowL: [-10, 90], ParamElbowR: [-10, 120], // Reze bends in to 110 before the flower
  ParamAngleX: [-30, 30], ParamAngleY: [-30, 30], ParamAngleZ: [-30, 30],
  ParamBodyAngleX: [-10, 10], ParamBodyAngleY: [-10, 10], ParamBodyAngleZ: [-10, 10],
  ParamEyeLOpen: [-1, 0], ParamEyeROpen: [-1, 0], ParamLegShift: [-1, 1],
  ParamHandsBehind: [0, 1],
  ParamOfferFlower: [0, 1],
  ParamOfferLift: [0, 1],
  ParamOfferReach: [0, 1],
  ParamMouthForm: [-1, 1],
  ParamGlassesReach: [0, 1],
  ParamGlassesPush: [0, 1],
  ParamRizeGhoul: [0, 1],
  ParamRizeBook: [0, 1],
  ParamChengClap: [0, 1],
  ParamChengClapDepth: [0, 1],
  ParamLuStudy: [0, 1],
  ParamLuThought: [0, 1],
  ParamLuFoldL: [0, 1],
  ParamLuFoldR: [0, 1],
  ParamEyeBallX: [-1, 1],
  ParamChengPalm: [0, 1],
  ParamMouthOpenY: [0, 1],
  ParamBrowLY: [-1, 1],
  ParamBrowRY: [-1, 1],
};

function store(init: Record<string, number> = {}) {
  const v = new Map(Object.entries(init));
  return {
    get: (id: string) => v.get(id) ?? 0,
    set: (id: string, x: number) => { const [lo, hi] = RANGE[id] ?? [-Infinity, Infinity]; v.set(id, Math.max(lo === -1 && id.startsWith("ParamEye") ? 0 : lo, Math.min(hi === 0 && id.startsWith("ParamEye") ? 1 : hi, x))); },
    has: (id: string) => id in RANGE,
  };
}

describe("Iki gestures", () => {
  it.each(Object.keys(GESTURES))("%s starts and ends at rest and stays inside the rig's ranges", (name) => {
    const g = GESTURES[name];
    // "-raised" variants run on models with extended ranges (arm to 150, elbow open to −170).
    const R = { ...RANGE };
    if (name === "wave-raised") R.ParamElbowR = [-170, 90];
    if (name === "signature-wink") R.ParamElbowR = [-170, 90];
    if (name.endsWith("-fold") || name === "signature-sheepish") R.ParamElbowR = [-170, 170];
    if (name === "signature-wave-shy") R.ParamElbowR = [-170, 170];
    // Cheng Xiaoshi's claps fold both elbows on his 170° rig.
    if (name === "clap-fold" || name === "signature-photo-dive") R.ParamElbowL = R.ParamElbowR = [-170, 170];
    for (const [id, v] of Object.entries(g.pose(0))) expect(Math.abs(v), `${id} at t=0`).toBeLessThan(1e-6);
    for (const [id, v] of Object.entries(g.pose(1))) expect(Math.abs(v), `${id} at t=1`).toBeLessThan(1e-6);
    for (let t = 0; t <= 1; t += 0.01) {
      for (const [id, v] of Object.entries(g.pose(t))) {
        expect(R[id], `${name} drives undeclared parameter ${id}`).toBeDefined();
        const [lo, hi] = R[id];
        expect(v, `${name} ${id} at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v, `${name} ${id} at t=${t.toFixed(2)}`).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });

  it("bends Reze's own arm in before the flower appears, then extends it while she smiles", () => {
    const flower = GESTURES["signature-flower"];
    expect(flower.pose(0.2).ParamElbowR).toBeGreaterThan(80);
    expect(flower.pose(0.2).ParamMouthForm).toBeLessThan(0.05);
    expect(flower.pose(0.5).ParamOfferLift ?? 0).toBe(0); // the upper arm is never squashed
    expect(flower.pose(0.2).ParamOfferFlower).toBe(0);
    expect(flower.pose(0.34).ParamOfferFlower).toBe(1);
    expect(flower.pose(0.34).ParamOfferReach).toBeLessThan(0.3);
    expect(flower.pose(0.34).ParamMouthForm).toBeGreaterThan(0.5);
    expect(flower.pose(0.55).ParamOfferReach).toBe(1);
    expect(flower.pose(0.55).ParamMouthForm).toBe(1);
    expect(flower.pose(0.79).ParamOfferReach).toBeLessThan(0.1);
    expect(flower.pose(0.79).ParamOfferFlower).toBeGreaterThan(0.99);
  });

  it("brings Rize's hand to the bridge before the push and smiles after contact", () => {
    const glasses = GESTURES["signature-glasses"].pose;
    expect(glasses(0.37).ParamGlassesReach).toBe(1);
    expect(glasses(0.37).ParamGlassesPush).toBe(0);
    expect(glasses(0.48).ParamGlassesPush).toBe(1);
    expect(glasses(0.50).ParamGlassesReach).toBe(1);
    expect(glasses(0.70).ParamMouthForm).toBeCloseTo(0.8);
  });

  it("poses both hands as Rize lowers her gaze for the book gesture", () => {
    const book = GESTURES["signature-book"].pose(0.5);
    expect(book.ParamElbowL).toBeGreaterThan(30);
    expect(book.ParamElbowR).toBeGreaterThan(30);
    expect(book.ParamAngleY).toBeLessThan(0);
    expect(book.ParamEyeLOpen).toBeCloseTo(-0.47);
    expect(book.ParamEyeROpen).toBeCloseTo(-0.47);
  });

  it("changes Rize's eyes under the blink, holds the ghoul reveal, and restores her eyes under a second blink", () => {
    const ghoul = GESTURES["signature-ghoul"].pose;
    expect(ghoul(0.25).ParamEyeLOpen).toBeCloseTo(-1);
    expect(ghoul(0.25).ParamEyeROpen).toBeCloseTo(-1);
    expect(ghoul(0.5).ParamRizeGhoul).toBeCloseTo(1);
    expect(ghoul(0.5).ParamEyeLOpen).toBeCloseTo(0);
    expect(ghoul(0.86).ParamEyeROpen).toBeCloseTo(-1);
    expect(ghoul(0.91).ParamRizeGhoul).toBeCloseTo(0);
  });

  it("shows Rize's book only while both hands hold it", () => {
    const book = GESTURES["signature-book"].pose;
    expect(book(0.1).ParamRizeBook).toBe(0); // hands still coming up
    expect(book(0.3).ParamRizeBook).toBe(1);
    expect(book(0.3).ParamElbowL).toBeGreaterThan(40); // cradled, not clasped low
    expect(book(0.7).ParamRizeBook).toBe(1);
    expect(book(0.85).ParamRizeBook).toBe(0); // gone before the hands drop
    expect(book(0.85).ParamElbowL).toBeGreaterThan(5);
  });

  it("claps Cheng Xiaoshi's palms together with his elbows only, never lifting the shoulders", () => {
    const dive = GESTURES["signature-photo-dive"];
    expect(dive.timed).toBe(true); // exact reach: springs or random amplitude would make the palms miss
    // Wind-up a hand apart, then palms pressed and held while his eyes are shut.
    expect(dive.pose(0.2).ParamElbowL).toBeCloseTo(CLAP_OPEN);
    expect(dive.pose(0.2).ParamChengClapDepth).toBeCloseTo(CLAP_OPEN_DEPTH);
    for (const t of [0.27, 0.4, 0.55]) {
      const p = dive.pose(t);
      expect(p.ParamElbowL).toBeCloseTo(CLAP_CONTACT, 0);
      expect(p.ParamElbowR).toBeCloseTo(CLAP_CONTACT, 0);
      expect(p.ParamChengClapDepth).toBeCloseTo(0, 1);
    }
    expect(dive.pose(0.4).ParamChengPalm).toBe(1); // palms, not the backs of the hands, meet
    expect(dive.pose(0.05).ParamChengPalm).toBe(0); // the hanging hands keep their painted side
    expect(dive.pose(0.4).ParamEyeLOpen).toBe(-1);
    expect(dive.pose(0.68).ParamEyeROpen).toBeCloseTo(-0.10);
    // The shoulders stay within the raglan's safe swing all the way, and the old shoulder-rotating clap is gone.
    for (let t = 0; t <= 1; t += 0.01) {
      const p = dive.pose(t);
      expect(Math.abs(p.ParamArmL)).toBeLessThanOrEqual(12.01);
      expect(p.ParamChengClap).toBeUndefined();
    }
    expect(dive.pose(1).ParamElbowL).toBeCloseTo(0);
  });

  it("rises with the forearms foreshortened, so the hands never sweep across each other", () => {
    for (let up = 0.3; up < 0.75; up += 0.05) {
      const p = foldClap(up, 1);
      expect(p.ParamChengClapDepth).toBeGreaterThan(0.9);
      expect(p.ParamArmL).toBeGreaterThan(5);
    }
  });

  it("claps three times on Cheng Xiaoshi's elbow-fold rig", () => {
    expect(resolveGesture("clap", 150, -170, 170, true)).toBe("clap-fold");
    expect(resolveGesture("clap", 150, -170, 170)).toBe("clap");
    const clap = GESTURES["clap-fold"].pose;
    for (const t of [0.35, 0.5, 0.65]) expect(clap(t).ParamElbowL).toBeCloseTo(CLAP_CONTACT, 0);
    for (const t of [0.275, 0.425, 0.575]) expect(clap(t).ParamElbowL).toBeGreaterThan(CLAP_CONTACT + 1.5);
  });

  it("gives Cheng Xiaoshi a tilted, open grin in his sheepish pose", () => {
    const sheepish = GESTURES["signature-sheepish"].pose(0.5);
    expect(sheepish.ParamMouthForm).toBeGreaterThan(0.7);
    expect(sheepish.ParamMouthOpenY).toBeGreaterThan(0.2);
    expect(sheepish.ParamAngleZ).toBeGreaterThan(5);
  });

  it("folds the forearm for Cheng Xiaoshi's raised-hand wink and closes one eye", () => {
    const wink = GESTURES["signature-wink"].pose(0.45);
    expect(wink.ParamElbowR).toBeLessThan(-150);
    expect(wink.ParamEyeROpen).toBe(-1);
    expect(wink.ParamEyeLOpen ?? 0).toBe(0);
  });

  it("holds Lu Guang's hand at eye level and narrows his gaze after the lift starts", () => {
    const study = GESTURES["signature-study-photo"].pose;
    expect(study(0.15).ParamLuStudy).toBeGreaterThan(0.4);
    expect(study(0.15).ParamEyeLOpen).toBeCloseTo(0);
    expect(study(0.33).ParamLuStudy).toBe(1);
    expect(study(0.66).ParamLuStudy).toBe(1);
    expect(study(0.5).ParamEyeLOpen).toBeCloseTo(-0.22);
    expect(study(0.5).ParamEyeBallX).toBeLessThan(0);
    expect(study(0.91).ParamLuStudy).toBeLessThan(0.25);
  });

  it("holds Lu Guang's folded arms through one small nod and a faint smile", () => {
    const fold = GESTURES["signature-folded-nod"].pose;
    expect(fold(0.15).ParamLuFoldR).toBeGreaterThan(fold(0.15).ParamLuFoldL);
    expect(fold(0.32).ParamLuFoldL).toBe(1);
    expect(fold(0.32).ParamAngleY).toBeCloseTo(0);
    expect(fold(0.50).ParamAngleY).toBeCloseTo(-5.5);
    expect(fold(0.66).ParamLuFoldL).toBe(1);
    expect(fold(0.66).ParamLuFoldR).toBe(1);
    expect(fold(0.48).ParamMouthForm).toBeCloseTo(0.23);
  });

  it("lifts Lu Guang's hand to his chin, holds it, then releases quietly", () => {
    const thought = GESTURES["signature-quiet-thought"].pose;
    expect(thought(0.35).ParamLuThought).toBe(1);
    expect(thought(0.65).ParamLuThought).toBe(1);
    expect(thought(0.5).ParamAngleY).toBeCloseTo(-3);
    expect(thought(0.88).ParamLuThought).toBeLessThan(0.35);
  });

  it("offsets do not accumulate on parameters nothing else writes (the stuck-arm bug)", () => {
    const p = store({ ParamArmL: 0, ParamElbowR: 0 });
    const bases = new Map<string, number>();
    for (let frame = 0; frame < 600; frame++) {
      restoreBases(p, bases);
      // IkiMotion would run here; it never writes the arms.
      applyOffsets(p, { ParamArmL: 5, ParamElbowR: 12 }, bases);
    }
    expect(p.get("ParamArmL")).toBeCloseTo(5);
    expect(p.get("ParamElbowR")).toBeCloseTo(12);
    restoreBases(p, bases);
    expect(p.get("ParamArmL")).toBe(0);
  });

  it("offsets ride on top of what the motion layer wrote this frame", () => {
    const p = store();
    const bases = new Map<string, number>();
    for (let frame = 0; frame < 50; frame++) {
      restoreBases(p, bases);
      p.set("ParamAngleZ", 4); // the motion layer's head tilt
      applyOffsets(p, { ParamAngleZ: 3 }, bases);
    }
    expect(p.get("ParamAngleZ")).toBeCloseTo(7);
  });

  it("springs ease into a target and settle back to rest", () => {
    const s = new SpringSet(9);
    let out = {};
    for (let i = 0; i < 120; i++) out = s.step({ ParamElbowR: 60 }, 1 / 60);
    expect((out as Record<string, number>).ParamElbowR).toBeGreaterThan(59);
    const first = new SpringSet(9).step({ ParamElbowR: 60 }, 1 / 60).ParamElbowR;
    expect(first).toBeLessThan(5); // no snap on the first frame
    for (let i = 0; i < 240; i++) out = s.step({}, 1 / 60);
    expect(Math.abs((out as Record<string, number>).ParamElbowR ?? 0)).toBeLessThan(0.05);
  });

  it("lets Cheng Xiaoshi's spring take a small overshoot and settle", () => {
    const spring = new SpringSet(8.5, {}, 0.78);
    const frames = Array.from({ length: 120 }, () => spring.step({ ParamAngleZ: 10 }, 1 / 60).ParamAngleZ);
    expect(Math.max(...frames)).toBeGreaterThan(10.02);
    expect(Math.max(...frames)).toBeLessThan(10.5);
    expect(frames.at(-1)).toBeCloseTo(10);
  });

  it("idle arms hang relaxed (slightly bent, close to the body) and follow the weight shift", () => {
    for (let t = 0; t < 120; t += 0.37) {
      const pose = idlePose(t, 0, false, 0);
      expect(pose.ParamElbowL).toBeGreaterThan(0);
      expect(pose.ParamElbowL).toBeLessThan(12);
      expect(Math.abs(pose.ParamArmR)).toBeLessThan(4);
    }
    const left = idlePose(10, -0.8, false, 0), right = idlePose(10, 0.8, false, 0);
    expect(left.ParamBodyAngleZ).toBeGreaterThan(right.ParamBodyAngleZ);
  });

  it("uses the raised wave only when the model's arm ranges allow them", () => {
    expect(resolveGesture("wave", 150, -170)).toBe("wave-raised");
    expect(resolveGesture("wave", 150, -120)).toBe("wave"); // elbow cannot open far enough
    expect(resolveGesture("signature-bang", 150, -170)).toBe("signature-bang");
    expect(resolveGesture("wave", 32, -10)).toBe("wave");
    expect(resolveGesture("clap", 150, -170)).toBe("clap");
    // A forearm that folds inward far enough brings the hand to the face.
    expect(resolveGesture("think_chin", 150, -170, 170)).toBe("think_chin-fold");
    expect(resolveGesture("facepalm", 150, -170, 170)).toBe("facepalm-fold");
    expect(resolveGesture("facepalm", 150, -170, 90)).toBe("facepalm");
    expect(resolveGesture("wave", 150, -170, 170)).toBe("wave-raised");
  });

  it("soft-limits the arm lift without a hard stop", () => {
    expect(softLimit(3, 9)).toBe(3); // below the knee: untouched
    expect(softLimit(24, 9)).toBeLessThan(9);
    expect(softLimit(24, 9)).toBeGreaterThan(softLimit(12, 9)); // still monotonic
    expect(softLimit(-8, 9)).toBe(-8); // tucking in is never limited
    const pose = limitArmLift({ ParamArmR: 24, ParamElbowR: -158 }, 9);
    expect(pose.ParamArmR).toBeLessThan(9);
    expect(pose.ParamElbowR).toBe(-158);
    expect(limitArmLift({ ParamArmR: 24 }, undefined).ParamArmR).toBe(24);
    // A straight arm keeps pointing the same way: the elbow bends out by what the shoulder lost.
    const point = limitArmLift({ ParamArmR: 24, ParamElbowR: 0 }, 9);
    expect(point.ParamArmR - point.ParamElbowR).toBeCloseTo(24, 5);
  });

  it("takes at most 0.12 s through horizontal in each direction of the raised wave", () => {
    const wave = GESTURES["wave-raised"];
    for (const duration of [0.92 * wave.dur, wave.dur, 1.08 * wave.dur]) {
      for (const framesPerSecond of [30, 60, 120]) {
        for (const idleElbow of [0, 7.5]) {
          let rising = 0, falling = 0;
          for (let frame = 0; frame < duration * framesPerSecond; frame++) {
            const t = frame / framesPerSecond / duration;
            const angle = wave.pose(t).ParamElbowR + idleElbow;
            if (angle > -135 && angle < -45) {
              if (t < 0.5) rising++;
              else falling++;
            }
          }
          expect(rising / framesPerSecond).toBeLessThanOrEqual(0.12);
          expect(falling / framesPerSecond).toBeLessThanOrEqual(0.12);
        }
      }
    }
  });

  it("adds poses", () => {
    expect(addPoses({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 5 });
  });
});
