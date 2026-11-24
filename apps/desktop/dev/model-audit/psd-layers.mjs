#!/usr/bin/env node
// List the layer tree of a PSD (names, bounds, visibility, opacity) without any
// dependency, to see what art a rig could be built from.
//   node dev/model-audit/psd-layers.mjs <file.psd>
import { readFileSync } from "node:fs";

const buf = readFileSync(process.argv[2]);
let o = 0;
const u8 = () => buf[o++];
const u16 = () => ((o += 2), buf.readUInt16BE(o - 2));
const i16 = () => ((o += 2), buf.readInt16BE(o - 2));
const u32 = () => ((o += 4), buf.readUInt32BE(o - 4));
const i32 = () => ((o += 4), buf.readInt32BE(o - 4));
const tag = () => ((o += 4), buf.toString("latin1", o - 4, o));
/** Skip a length-prefixed block (note: `o += u32()` would read o before u32 advances it). */
const skip = () => {
  const n = u32();
  o += n;
};

if (tag() !== "8BPS") throw new Error("not a PSD");
const version = u16();
o += 6;
const channels = u16(), height = u32(), width = u32(), depth = u16(), mode = u16();
console.log(`PSD v${version}: ${width}x${height}, ${channels} ch, ${depth}-bit, colour mode ${mode}`);
skip(); // colour mode data
skip(); // image resources
const secLen = version === 2 ? Number(buf.readBigUInt64BE(o)) : u32();
if (version === 2) o += 8;
const secEnd = o + secLen;
const layerInfoLen = version === 2 ? Number(buf.readBigUInt64BE(o)) : u32();
if (version === 2) o += 8;
let count = i16();
count = Math.abs(count);
const layers = [];
for (let l = 0; l < count; l++) {
  const top = i32(), left = i32(), bottom = i32(), right = i32();
  const nch = u16();
  o += nch * (version === 2 ? 10 : 6);
  tag(); // 8BIM
  tag(); // blend mode
  const opacity = u8();
  u8(); // clipping
  const flags = u8();
  u8();
  const extraLen = u32();
  const extraEnd = o + extraLen;
  skip(); // mask data
  skip(); // blending ranges
  const nameLen = u8();
  let name = buf.toString("latin1", o, o + nameLen);
  o += nameLen;
  o += (4 - ((nameLen + 1) % 4)) % 4;
  let divider = 0;
  while (o + 12 <= extraEnd) {
    tag();
    const key = tag();
    const len = u32();
    if (key === "luni") {
      const n = buf.readUInt32BE(o);
      name = buf.swap16 ? Buffer.from(buf.subarray(o + 4, o + 4 + n * 2)).swap16().toString("utf16le") : name;
    }
    if (key === "lsct") divider = buf.readUInt32BE(o);
    o += len + (len % 2);
  }
  o = extraEnd;
  layers.push({ name, left, top, w: right - left, h: bottom - top, opacity, visible: !(flags & 2), divider });
}
// PSD stores layers bottom-to-top; groups close with a divider (type 3) before their header (1/2).
let depthLvl = 0;
const lines = [];
for (let i = layers.length - 1; i >= 0; i--) {
  const L = layers[i];
  if (L.divider === 3) { depthLvl = Math.max(0, depthLvl - 1); continue; }
  const isGroup = L.divider === 1 || L.divider === 2;
  lines.push(`${"  ".repeat(depthLvl)}${isGroup ? "▸ " : ""}${L.name}${isGroup ? "" : `  [${L.w}x${L.h} @${L.left},${L.top}]`}${L.visible ? "" : " (hidden)"}`);
  if (isGroup) depthLvl++;
}
console.log(`${layers.filter((l) => l.divider === 0).length} raster layers, ${layers.filter((l) => l.divider === 1 || l.divider === 2).length} groups`);
console.log(lines.join("\n"));
void secEnd;
void layerInfoLen;
