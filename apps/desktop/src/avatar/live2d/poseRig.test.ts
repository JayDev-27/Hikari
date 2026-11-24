import { expect, it } from "vitest";
import { installPoseRig, type DrawableModel } from "./poseRig";

it.each([1, 1.35])("preserves a palm breadth of %s through a wrist bend and neck turn", breadth => {
  const hand = new Float32Array([-10, 30, 10, 30, -10, -35, 10, -35]);
  const head = new Float32Array([-40, 0, 40, 0, -40, 100, 40, 100]);
  const body = new Float32Array([-40, 0, 40, 0, -40, -100, 40, -100]);
  const raw = {
    canvasinfo: { PixelsPerUnit: 1 },
    parameters: { ids: ["ParamAngleX", "ParamAngleY", "ParamAngleZ"], values: new Float32Array(3) },
    drawables: { ids: ["palm", "Head", "Body"], vertexPositions: [hand, head, body], vertexUvs: [] },
  };
  const core: DrawableModel = {
    getModel: () => raw,
    getDrawableVertices: i => raw.drawables.vertexPositions[i],
    getDrawableVertexUvs: i => raw.drawables.vertexUvs[i],
    getDrawableTextureIndex: () => 0,
    getDrawableOpacity: () => 1,
  };
  const sample = installPoseRig(core, { hands: [{ drawable: "palm", wrist: [0, 0], breadth }] }, -1);
  // A native keyform halfway through rotation has squeezed the palm to a quarter of its width.
  hand[4] = -2.5;
  hand[6] = 2.5;
  head[0] += 8;
  head[1] -= 5;
  body[0] += 2;
  body[1] += 3;
  raw.parameters.values[2] = 25;
  sample();
  const posed = core.getDrawableVertices(0);
  expect(Math.hypot(posed[6] - posed[4], posed[7] - posed[5])).toBeCloseTo(20 * breadth);
  expect(hand[6] - hand[4]).toBe(5);
  const turned = core.getDrawableVertices(1);
  expect([...turned.slice(0, 4)]).toEqual([...body.slice(0, 4)]);
  expect(Math.abs(turned[4] - head[4])).toBeGreaterThan(5);
  head[0] -= 8;
  head[1] += 5;
  body[0] -= 2;
  body[1] -= 3;
  raw.parameters.values[2] = 0;
  sample();
  expect([...core.getDrawableVertices(1)]).toEqual([...head]);
});

it("restores forearm thickness across the direction of a raised arm", () => {
  const rest = Array.from({ length: 21 }, (_, row) => [-10, -row * 5, 10, -row * 5]).flat();
  const arm = Float32Array.from(rest);
  const head = Float32Array.of(-10, 0, 10, 0, -10, 20, 10, 20);
  const core: DrawableModel = {
    getModel: () => ({
      canvasinfo: { PixelsPerUnit: 1 },
      parameters: { ids: [], values: new Float32Array() },
      drawables: { ids: ["arm", "Head"], vertexPositions: [arm, head], vertexUvs: [] },
    }),
    getDrawableVertices: i => i === 0 ? arm : head,
    getDrawableOpacity: () => 1,
    getDrawableTextureIndex: () => 0,
    getDrawableVertexUvs: () => new Float32Array(),
  };
  const tick = installPoseRig(core, { hands: [], arms: [{ drawable: "arm", centers: [0.5, 0.5, 0.5] }] }, -1);
  for (let j = 0; j < arm.length; j += 2) {
    arm[j] = -rest[j + 1];
    arm[j + 1] = 0.6 * rest[j];
  }
  tick();
  const posed = core.getDrawableVertices(0);
  const j = 14 * 4;
  expect(posed[j + 3] - posed[j + 1]).toBeCloseTo(20);
  expect((posed[j + 3] + posed[j + 1]) / 2).toBeCloseTo(0);
  expect(posed[j]).toBe(arm[j]);
  expect([...posed.slice(-4)]).toEqual([...arm.slice(-4)]);
});

it("keeps split hand artwork registered to its sleeve in either draw order", () => {
  const sleeve = Float32Array.of(-5, 25, 5, 25, -5, 0, 5, 0, -5, -25, 5, -25);
  const skin = sleeve.slice(4);
  const head = Float32Array.of(-5, 0, 5, 0, -5, 25, 5, 25);
  const drawables = { ids: ["sleeve", "skin", "Head"], vertexPositions: [sleeve, skin, head], vertexUvs: [] };
  const core: DrawableModel = {
    getModel: () => ({ canvasinfo: { PixelsPerUnit: 1 }, parameters: { ids: [], values: new Float32Array() }, drawables }),
    getDrawableVertices: i => drawables.vertexPositions[i],
    getDrawableOpacity: () => 1,
    getDrawableTextureIndex: () => 0,
    getDrawableVertexUvs: () => new Float32Array(),
  };
  const tick = installPoseRig(core, {
    hands: [{ drawable: "skin", wrist: [0, 0] }],
    arms: [{ drawable: "sleeve", handDrawable: "skin", centers: [0.5, 0.5, 0.5] }],
  }, -1);
  skin.fill(0);
  for (const first of [1, 0]) {
    sleeve[4] += 2;
    tick();
    core.getDrawableVertices(first);
    expect(core.getDrawableVertices(1)).toEqual(core.getDrawableVertices(0).slice(4));
  }
});
