// Writes a minimal VRM 1.0 (.glb): a T-posed humanoid of boxes with the standard bone set, no expressions.
// For a smoke test of Hikari's VRM renderer without downloading a model. Usage:
//   node apps/desktop/dev/make-test-vrm.mjs apps/desktop/public/characters/_vrm-test/box.vrm   (git-ignored)
// Its shoulders are broader than VRoid's, which is how the per-model clap fit (gestures.ts fitClap) was found and checked.
import { writeFileSync } from "node:fs";

// Unit box (24 vertices with normals, 36 indices).
const P = [], N = [], I = [];
const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
for (const [a, b, c, s] of faces) {
  const base = P.length / 3;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const p = [0, 0, 0]; p[a] = u * 0.5; p[b] = v * 0.5 * s; p[c] = 0.5 * s;
    P.push(...p); const n = [0, 0, 0]; n[c] = s; N.push(...n);
  }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const pos = new Float32Array(P), nor = new Float32Array(N), idx = new Uint16Array(I);
const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(nor.buffer), Buffer.from(idx.buffer)]);

const nodes = [], humanBones = {};
const add = (node) => (nodes.push(node), nodes.length - 1);
// bone(name, parent, translation, box: [w,h,d, offset] for the visible segment)
const bone = (name, parent, t, box, mat = 0) => {
  const i = add({ name, translation: t, children: [] });
  if (parent !== null) nodes[parent].children.push(i);
  if (box) {
    const [w, h, d, ox, oy, oz] = box;
    const m = add({ name: `${name}_mesh`, mesh: mat, translation: [ox, oy, oz], scale: [w, h, d] });
    nodes[i].children.push(m);
  }
  humanBones[name] = { node: i };
  return i;
};
const hips = bone("hips", null, [0, 0.95, 0], [0.30, 0.14, 0.18, 0, 0, 0]);
const spine = bone("spine", hips, [0, 0.10, 0], [0.28, 0.14, 0.17, 0, 0.06, 0]);
const chest = bone("chest", spine, [0, 0.14, 0], [0.32, 0.20, 0.19, 0, 0.08, 0]);
const neck = bone("neck", chest, [0, 0.22, 0], [0.08, 0.08, 0.08, 0, 0.03, 0], 1);
bone("head", neck, [0, 0.08, 0], [0.20, 0.24, 0.22, 0, 0.11, 0.01], 1);
for (const [side, sx] of [["left", 1], ["right", -1]]) {
  const cap = (s) => side + s;
  const ua = bone(cap("UpperArm"), chest, [0.18 * sx, 0.17, 0], [0.26, 0.08, 0.08, 0.13 * sx, 0, 0]);
  const la = bone(cap("LowerArm"), ua, [0.27 * sx, 0, 0], [0.24, 0.07, 0.07, 0.12 * sx, 0, 0]);
  bone(cap("Hand"), la, [0.25 * sx, 0, 0], [0.09, 0.03, 0.07, 0.05 * sx, 0, 0], 1);
  const ul = bone(cap("UpperLeg"), hips, [0.09 * sx, -0.06, 0], [0.11, 0.42, 0.11, 0, -0.21, 0]);
  const ll = bone(cap("LowerLeg"), ul, [0, -0.43, 0], [0.09, 0.42, 0.09, 0, -0.21, 0]);
  bone(cap("Foot"), ll, [0, -0.42, 0], [0.09, 0.05, 0.20, 0, -0.03, 0.05]);
}
const sceneRoot = add({ name: "Root", children: [hips] });

const json = {
  asset: { version: "2.0", generator: "hikari make-vrm.mjs (test model)" },
  extensionsUsed: ["VRMC_vrm"],
  scene: 0, scenes: [{ nodes: [sceneRoot] }], nodes,
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
    { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 },
    { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
  ],
  materials: [
    { name: "body", pbrMetallicRoughness: { baseColorFactor: [0.55, 0.6, 0.95, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
    { name: "skin", pbrMetallicRoughness: { baseColorFactor: [0.98, 0.86, 0.78, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  ],
  meshes: [0, 1].map((m) => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: m }] })),
  extensions: {
    VRMC_vrm: {
      specVersion: "1.0",
      meta: { name: "Hikari box test", version: "1", authors: ["Hikari test generator"], licenseUrl: "https://vrm.dev/licenses/1.0/", avatarPermission: "onlyAuthor", commercialUsage: "personalNonProfit", allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false, allowPoliticalOrReligiousUsage: false, allowAntisocialOrHateUsage: false, creditNotation: "required", allowRedistribution: false, modification: "prohibited" },
      humanoid: { humanBones },
    },
  },
};
const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20), binBuf = pad(bin, 0);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (b, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, b]); };
writeFileSync(process.argv[2], Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]));
console.log("wrote", process.argv[2], Object.keys(humanBones).length, "bones");
