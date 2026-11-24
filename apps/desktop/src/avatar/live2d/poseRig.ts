import type { PoseRig } from "../characters";

export interface DrawableModel {
  getModel(): {
    canvasinfo: { PixelsPerUnit: number };
    parameters: { ids: string[]; values: Float32Array };
    drawables: { ids: string[]; vertexPositions: Float32Array[]; vertexUvs: Float32Array[] };
  };
  getDrawableVertices(i: number): Float32Array;
  getDrawableOpacity(i: number): number;
  getDrawableTextureIndex(i: number): number;
  getDrawableVertexUvs(i: number): Float32Array;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
function smooth(n: number) {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
}

type Deform = (vertices: Float32Array, out: Float32Array) => void;

// Fit a rotation and translation around the wrist. Preserve the drawn palm's
// dimensions even when interpolation between two bent keyforms flattens it.
function handDeformer(rest: Float32Array, x: number, y: number, ppu: number, breadth: number): Deform {
  const weights: number[] = [];
  const blend: number[] = [];
  const palmOffset: number[] = [];
  let sum = 0, rx = 0, ry = 0;
  for (let j = 0; j < rest.length; j += 2) {
    const dx = rest[j] * ppu - x, dy = rest[j + 1] * ppu - y;
    const w = Math.exp(-(dx * dx + dy * dy) / (2 * 38 * 38));
    weights.push(w);
    // Broaden across the palm in its own coordinate frame, tapering into the wrist.
    palmOffset.push((breadth - 1) * dx / ppu * smooth((14 - dy) / 42));
    blend.push(smooth((36 - dy) / 46));
    rx += w * rest[j];
    ry += w * rest[j + 1];
    sum += w;
  }
  rx /= sum;
  ry /= sum;
  return (v, out) => {
    let cx = 0, cy = 0, dot = 0, cross = 0;
    for (let j = 0; j < v.length; j += 2) {
      const w = weights[j / 2], dx = rest[j] - rx, dy = rest[j + 1] - ry;
      cx += w * v[j];
      cy += w * v[j + 1];
      dot += w * (dx * v[j] + dy * v[j + 1]);
      cross += w * (dx * v[j + 1] - dy * v[j]);
    }
    const length = Math.hypot(dot, cross) || 1;
    const c = dot / length, s = cross / length;
    for (let j = 0; j < v.length; j += 2) {
      const dx = rest[j] - rx + palmOffset[j / 2], dy = rest[j + 1] - ry, f = blend[j / 2];
      out[j] = v[j] + f * (cx / sum + c * dx - s * dy - v[j]);
      out[j + 1] = v[j + 1] + f * (cy / sum + s * dx + c * dy - v[j + 1]);
    }
  };
}

// Preserve the silhouette across a bent limb while allowing the animated
// centerline to foreshorten. The three samples lie on the painted arm.
function armDeformer(rest: Float32Array, centers: [number, number, number], pixelsPerUnit: number, wristY?: number): Deform {
  const bands = new Map<number, number[]>();
  for (let i = 0; i < rest.length; i += 2) {
    const y = Math.round(rest[i + 1] * pixelsPerUnit * 10);
    if (!bands.has(y)) bands.set(y, []);
    bands.get(y)!.push(i);
  }
  const heights = [...bands.keys()].sort((a, b) => b - a);
  const rows = heights.map(y => {
    const indices = bands.get(y)!.sort((a, b) => rest[a] - rest[b]);
    const t = (heights[0] - y) / (heights[0] - heights[heights.length - 1]);
    const center = t <= 0.48
      ? centers[0] + clamp((t - 0.10) / 0.38) * (centers[1] - centers[0])
      : centers[1] + clamp((t - 0.48) / 0.29) * (centers[2] - centers[1]);
    const x = rest[indices[0]] + center * (rest[indices[indices.length - 1]] - rest[indices[0]]);
    let k = 0;
    while (k + 2 < indices.length && rest[indices[k + 1]] < x) k++;
    const a = indices[k], b = indices[Math.min(k + 1, indices.length - 1)];
    const mix = clamp((x - rest[a]) / (rest[b] - rest[a] || 1));
    const upper = 0.6 * smooth((t - 0.10) / 0.09) * smooth((0.37 - t) / 0.09);
    // Crossfade into the rigid hand at its painted wrist, including the narrow
    // strip above the cuff. Wrist height differs between sides and costumes.
    const wristFade = wristY === undefined
      ? smooth((0.83 - t) / 0.10)
      : 1 - smooth((36 + wristY - y / 10) / 46);
    const lower = smooth((t - 0.55) / 0.11) * wristFade;
    return { indices, a, b, mix, weight: upper + lower };
  });
  function sample(v: Float32Array, xy: Float32Array) {
    rows.forEach(({ a, b, mix }, r) => {
      xy[2 * r] = v[a] + mix * (v[b] - v[a]);
      xy[2 * r + 1] = v[a + 1] + mix * (v[b + 1] - v[a + 1]);
    });
  }
  const neutral = new Float32Array(rows.length * 2), live = new Float32Array(neutral.length);
  sample(rest, neutral);
  return (v, out) => {
    sample(v, live);
    rows.forEach(({ indices, a, b, weight }, r) => {
      const prev = Math.max(0, r - 1) * 2, next = Math.min(rows.length - 1, r + 1) * 2;
      const tx = live[next] - live[prev], ty = live[next + 1] - live[prev + 1];
      const length = Math.hypot(tx, ty) || 1, nx = -ty / length, ny = tx / length;
      const dx = neutral[next] - neutral[prev], dy = neutral[next + 1] - neutral[prev + 1];
      const width = Math.abs((rest[b] - rest[a]) * dy - (rest[b + 1] - rest[a + 1]) * dx) / (Math.hypot(dx, dy) || 1);
      const current = Math.abs((v[b] - v[a]) * nx + (v[b + 1] - v[a + 1]) * ny);
      const gain = Math.max(0, Math.min(0.75, width / (current || 1) - 1)) * weight;
      for (const j of indices) {
        const offset = gain * ((v[j] - live[2 * r]) * nx + (v[j + 1] - live[2 * r + 1]) * ny);
        out[j] += nx * offset;
        out[j + 1] += ny * offset;
      }
    });
  };
}

// Bind a rest-space x to two vertices on an edge, then sample its displacement.
function rowSampler(rest: Float32Array, y: number) {
  const row: number[] = [];
  for (let j = 0; j < rest.length; j += 2) {
    if (Math.abs(rest[j + 1] - y) < 1e-5) row.push(j);
  }
  row.sort((a, b) => rest[a] - rest[b]);
  return (x: number) => {
    let k = 0;
    while (k + 1 < row.length && rest[row[k + 1]] < x) k++;
    const a = row[k], b = row[Math.min(k + 1, row.length - 1)];
    const t = clamp((x - rest[a]) / (rest[b] - rest[a] || 1));
    return (live: Float32Array, axis: number) =>
      (1 - t) * (live[a + axis] - rest[a + axis]) + t * (live[b + axis] - rest[b + axis]);
  };
}

/** Additional pose art is opt-in on the five layered character packs. Keep
 * Cubism's native arrays intact for physics and parameter interpolation. */
export function installPoseRig(core: DrawableModel, rig: PoseRig, texture: number) {
  const { canvasinfo, parameters, drawables } = core.getModel();
  const ppu = canvasinfo.PixelsPerUnit;
  const ids = drawables.ids;
  const rest = drawables.vertexPositions.map(v => v.slice());
  const deforms = new Map<number, Deform>();
  for (const hand of rig.hands) {
    const i = ids.indexOf(hand.drawable);
    if (i >= 0) deforms.set(i, handDeformer(rest[i], ...hand.wrist, ppu, hand.breadth ?? 1));
  }

  for (const arm of rig.arms ?? []) {
    const i = ids.indexOf(arm.drawable);
    if (i < 0) continue;
    // Split skin and sleeve textures share the same lower-arm mesh in the
    // exported model. Give their common vertices one posed position at the cuff.
    const splitHand = rig.hands.find(h => h.drawable === arm.handDrawable);
    const skinIndex = splitHand ? ids.indexOf(splitHand.drawable) : -1;
    const hand = splitHand
      ? handDeformer(rest[i], ...splitHand.wrist, ppu, splitHand.breadth ?? 1)
      : deforms.get(i);
    const wrist = splitHand ?? rig.hands.find(h => h.drawable === arm.drawable);
    const preserveWidth = armDeformer(rest[i], arm.centers, ppu, wrist?.wrist[1]);
    deforms.set(i, (v, out) => {
      if (hand) hand(v, out);
      else out.set(v);
      preserveWidth(v, out);
    });
    if (skinIndex >= 0) {
      const key = (x: number, y: number) => [x, y].map(v => Math.round(v * ppu * 100)).join(",");
      const vertices = new Map<string, number>();
      for (let j = 0; j < rest[i].length; j += 2) vertices.set(key(rest[i][j], rest[i][j + 1]), j);
      const binding: number[] = [];
      const skin = rest[skinIndex];
      for (let j = 0; j < skin.length; j += 2) binding.push(vertices.get(key(skin[j], skin[j + 1])) ?? -1);
      if (binding.every(j => j >= 0)) deforms.set(skinIndex, (_, out) => {
        const sleeve = core.getDrawableVertices(i);
        binding.forEach((j, k) => {
          out[2 * k] = sleeve[j];
          out[2 * k + 1] = sleeve[j + 1];
        });
      });
    }
  }
  const joined = ids.indexOf("JoinedHands");
  if (joined >= 0 && rig.joinedBreadth) {
    // The contact drawing replaces both palms. Alpha blending these disjoint
    // silhouettes shows four translucent hands during approach and release.
    const singles = new Set((rig.arms ?? []).flatMap(arm => arm.handDrawable ? [ids.indexOf(arm.handDrawable)] : []));
    const opacity = core.getDrawableOpacity.bind(core);
    core.getDrawableOpacity = i => {
      if (i !== joined && !singles.has(i)) return opacity(i);
      const inContact = opacity(joined) >= 0.5;
      if (i === joined) return inContact ? 1 : 0;
      return inContact ? 0 : 1;
    };
    const uv = drawables.vertexUvs[joined];
    const us = uv.filter((_, j) => j % 2 === 0), vs = uv.filter((_, j) => j % 2 === 1);
    const left = Math.min(...us), right = Math.max(...us);
    const bottom = Math.min(...vs), height = Math.max(...vs) - bottom;
    const leftIndex = us.indexOf(left) * 2, rightIndex = us.indexOf(right) * 2;
    const gain = rig.joinedBreadth - 1;
    deforms.set(joined, (v, out) => {
      for (let j = 0; j < v.length; j += 2) {
        // The lower corners meet the animated sleeves. Widen only above those contacts.
        const amount = gain * ((uv[j] - left) / (right - left) - 0.5) *
          smooth((uv[j + 1] - bottom) / (height * 0.55));
        out[j] = v[j] + amount * (v[rightIndex] - v[leftIndex]);
        out[j + 1] = v[j + 1] + amount * (v[rightIndex + 1] - v[leftIndex + 1]);
      }
    });
  }

  const headIndex = ids.indexOf("Head"), bodyIndex = ids.indexOf("Body");
  const head = rest[headIndex];
  const neck = Math.min(...head.filter((_, j) => j % 2 === 1));
  const crown = Math.max(...head.filter((_, j) => j % 2 === 1));
  let roll = 0;
  if (bodyIndex >= 0) {
    // The head and body textures overlap along horizontal mesh rows at the collar.
    // Match each head column to the moving torso there, including through breathing.
    const body = rest[bodyIndex];
    const collar = Math.max(...body.filter((_, j) => j % 2 === 1));
    const headRow = rowSampler(head, neck);
    const torsoRow = rowSampler(body, collar);
    const pivotX = (Math.min(...head.filter((_, j) => j % 2 === 0)) +
      Math.max(...head.filter((_, j) => j % 2 === 0))) / 2;
    for (const [i, id] of ids.entries()) {
      if (!/^(Head$|Gaze|Blink|Brow|Mouth$|LipShape|hair)/i.test(id)) continue;
      const columns: { head: ReturnType<typeof headRow>; torso: ReturnType<typeof torsoRow>; tilt: number }[] = [];
      for (let j = 0; j < rest[i].length; j += 2) {
        const x = rest[i][j];
        columns.push({ head: headRow(x), torso: torsoRow(x),
          tilt: smooth((rest[i][j + 1] - neck) / ((crown - neck) * 0.32)) });
      }
      deforms.set(i, (v, out) => {
        const liveHead = drawables.vertexPositions[headIndex];
        const liveBody = drawables.vertexPositions[bodyIndex];
        const c = Math.cos(roll), s = Math.sin(roll);
        for (let j = 0; j < v.length; j += 2) {
          const col = columns[j / 2];
          const bx = col.torso(liveBody, 0), by = col.torso(liveBody, 1);
          const x = v[j] - col.head(liveHead, 0) - pivotX;
          const y = v[j + 1] - col.head(liveHead, 1) - neck;
          out[j] = pivotX + bx + x + col.tilt * ((c - 1) * x - s * y);
          out[j + 1] = neck + by + y + col.tilt * (s * x + (c - 1) * y);
        }
      });
    }
  }

  const grip = rig.grip;
  if (grip && texture >= 0) {
    const prop = ids.indexOf(grip.drawable), body = ids.indexOf("Body");
    const uv = drawables.vertexUvs[prop];
    const us = uv.filter((_, i) => i % 2 === 0), vs = uv.filter((_, i) => i % 2 === 1);
    const u0 = Math.min(...us), v0 = Math.min(...vs);
    const du = Math.max(...us) - u0, dv = Math.max(...vs) - v0;
    const localUv = uv.map((v, j) => j % 2 ? (v - v0) / dv : (v - u0) / du);
    const [ax, ay, bx, by] = grip.bodyPoints;
    const dx = bx - ax, dy = by - ay, denom = dx * dx + dy * dy;
    const [a, b] = grip.bodyIndices.map(i => i * 2);
    deforms.set(prop, (_, out) => {
      const v = drawables.vertexPositions[body];
      const vx = v[b] - v[a], vy = v[b + 1] - v[a + 1];
      const c = (vx * dx + vy * dy) / denom, s = (vy * dx - vx * dy) / denom;
      for (let j = 0; j < out.length; j += 2) {
        const x = grip.origin[0] + localUv[j] * grip.size[0] - ax;
        const y = -grip.origin[1] - (1 - localUv[j + 1]) * grip.size[1] - ay;
        out[j] = v[a] + c * x - s * y;
        out[j + 1] = v[a + 1] + s * x + c * y;
      }
    });
    const baseUv = core.getDrawableVertexUvs.bind(core);
    const baseTexture = core.getDrawableTextureIndex.bind(core);
    const opacity = core.getDrawableOpacity.bind(core);
    const arms = new Set(grip.arms.map(id => ids.indexOf(id)));
    // Switch once the native reach is settled and reverse on release.
    const contact = () => smooth((opacity(prop) - 0.93) / 0.07);
    core.getDrawableTextureIndex = i => i === prop ? texture : baseTexture(i);
    core.getDrawableVertexUvs = i => i === prop ? localUv : baseUv(i);
    core.getDrawableOpacity = i => {
      if (i === prop) return contact();
      return arms.has(i) ? opacity(i) * (1 - contact()) : opacity(i);
    };
  }

  const native = core.getDrawableVertices.bind(core);
  const output = new Map([...deforms.keys()].map(i => [i, new Float32Array(rest[i].length)]));
  const updated = new Set<number>();
  core.getDrawableVertices = i => {
    const deform = deforms.get(i);
    if (!deform) return native(i);
    const out = output.get(i)!;
    if (!updated.has(i)) {
      deform(native(i), out);
      updated.add(i);
    }
    return out;
  };
  const tilt = parameters.ids.indexOf("ParamAngleZ");
  return () => {
    roll = Math.max(-3, Math.min(3, (parameters.values[tilt] ?? 0) * 0.22)) * Math.PI / 180;
    updated.clear();
  };
}
