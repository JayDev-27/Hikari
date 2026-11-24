// Minimal .moc3 reader/patcher for the fixed layout our models use (Cubism 4.00 moc3,
// as written by Stretchy Studio's exporter). Layout reference: py-moc3 / moc3ingbird,
// as documented in Stretchy Studio's moc3writer.js. Sections are located through the
// file's Section Offset Table, so numeric data can be edited IN PLACE (same sizes), which
// is all the model fixes need. Structural edits (new deformers/parameters) are out of scope.
//
//   const moc = parseMoc3(readFileSync("Reze.moc3"));
//   moc.sections["parameter.default_values"].view[3] = 0;   // typed-array view, live
//   writeFileSync("Reze.moc3", moc.bytes());

const HEADER_SIZE = 64, SOT_COUNT = 160;
const I32 = 0, F32 = 1, I16 = 2, U8 = 3, BOOL = 4, STR64 = 5, RUNTIME = 6;
const C = { PARTS: 0, DEFORMERS: 1, WARP: 2, ROT: 3, MESHES: 4, PARAMS: 5, PART_KF: 6, WARP_KF: 7, ROT_KF: 8, MESH_KF: 9, KF_POS: 10, KB_IDX: 11, KB_BAND: 12, KB: 13, KEYS: 14, UVS: 15, POS_IDX: 16, MASKS: 17, DOG: 18, DOGO: 19, GLUES: 20, GLUE_INFO: 21, GLUE_KF: 22 };

// [name, element type, count index] in file order (SOT index = 2 + position).
// Caveat: "art_mesh.position_index_counts" = vertices per mesh, "art_mesh.vertex_counts" = indices per mesh.
const LAYOUT = [
  ["part.runtime_space", RUNTIME, C.PARTS], ["part.ids", STR64, C.PARTS], ["part.keyform_binding_band_indices", I32, C.PARTS], ["part.keyform_begin_indices", I32, C.PARTS], ["part.keyform_counts", I32, C.PARTS], ["part.visibles", BOOL, C.PARTS], ["part.enables", BOOL, C.PARTS], ["part.parent_part_indices", I32, C.PARTS],
  ["deformer.runtime_space", RUNTIME, C.DEFORMERS], ["deformer.ids", STR64, C.DEFORMERS], ["deformer.keyform_binding_band_indices", I32, C.DEFORMERS], ["deformer.visibles", BOOL, C.DEFORMERS], ["deformer.enables", BOOL, C.DEFORMERS], ["deformer.parent_part_indices", I32, C.DEFORMERS], ["deformer.parent_deformer_indices", I32, C.DEFORMERS], ["deformer.types", I32, C.DEFORMERS], ["deformer.specific_indices", I32, C.DEFORMERS],
  ["warp_deformer.keyform_binding_band_indices", I32, C.WARP], ["warp_deformer.keyform_begin_indices", I32, C.WARP], ["warp_deformer.keyform_counts", I32, C.WARP], ["warp_deformer.vertex_counts", I32, C.WARP], ["warp_deformer.rows", I32, C.WARP], ["warp_deformer.cols", I32, C.WARP],
  ["rotation_deformer.keyform_binding_band_indices", I32, C.ROT], ["rotation_deformer.keyform_begin_indices", I32, C.ROT], ["rotation_deformer.keyform_counts", I32, C.ROT], ["rotation_deformer.base_angles", F32, C.ROT],
  ["art_mesh.runtime_space_0", RUNTIME, C.MESHES], ["art_mesh.runtime_space_1", RUNTIME, C.MESHES], ["art_mesh.runtime_space_2", RUNTIME, C.MESHES], ["art_mesh.runtime_space_3", RUNTIME, C.MESHES],
  ["art_mesh.ids", STR64, C.MESHES], ["art_mesh.keyform_binding_band_indices", I32, C.MESHES], ["art_mesh.keyform_begin_indices", I32, C.MESHES], ["art_mesh.keyform_counts", I32, C.MESHES], ["art_mesh.visibles", BOOL, C.MESHES], ["art_mesh.enables", BOOL, C.MESHES], ["art_mesh.parent_part_indices", I32, C.MESHES], ["art_mesh.parent_deformer_indices", I32, C.MESHES], ["art_mesh.texture_indices", I32, C.MESHES], ["art_mesh.drawable_flags", U8, C.MESHES], ["art_mesh.position_index_counts", I32, C.MESHES], ["art_mesh.uv_begin_indices", I32, C.MESHES], ["art_mesh.position_index_begin_indices", I32, C.MESHES], ["art_mesh.vertex_counts", I32, C.MESHES], ["art_mesh.mask_begin_indices", I32, C.MESHES], ["art_mesh.mask_counts", I32, C.MESHES],
  ["parameter.runtime_space", RUNTIME, C.PARAMS], ["parameter.ids", STR64, C.PARAMS], ["parameter.max_values", F32, C.PARAMS], ["parameter.min_values", F32, C.PARAMS], ["parameter.default_values", F32, C.PARAMS], ["parameter.repeats", BOOL, C.PARAMS], ["parameter.decimal_places", I32, C.PARAMS], ["parameter.keyform_binding_begin_indices", I32, C.PARAMS], ["parameter.keyform_binding_counts", I32, C.PARAMS],
  ["part_keyform.draw_orders", F32, C.PART_KF],
  ["warp_deformer_keyform.opacities", F32, C.WARP_KF], ["warp_deformer_keyform.keyform_position_begin_indices", I32, C.WARP_KF],
  ["rotation_deformer_keyform.opacities", F32, C.ROT_KF], ["rotation_deformer_keyform.angles", F32, C.ROT_KF], ["rotation_deformer_keyform.origin_xs", F32, C.ROT_KF], ["rotation_deformer_keyform.origin_ys", F32, C.ROT_KF], ["rotation_deformer_keyform.scales", F32, C.ROT_KF], ["rotation_deformer_keyform.reflect_xs", BOOL, C.ROT_KF], ["rotation_deformer_keyform.reflect_ys", BOOL, C.ROT_KF],
  ["art_mesh_keyform.opacities", F32, C.MESH_KF], ["art_mesh_keyform.draw_orders", F32, C.MESH_KF], ["art_mesh_keyform.keyform_position_begin_indices", I32, C.MESH_KF],
  ["keyform_position.xys", F32, C.KF_POS],
  ["keyform_binding_index.indices", I32, C.KB_IDX],
  ["keyform_binding_band.begin_indices", I32, C.KB_BAND], ["keyform_binding_band.counts", I32, C.KB_BAND],
  ["keyform_binding.keys_begin_indices", I32, C.KB], ["keyform_binding.keys_counts", I32, C.KB],
  ["keys.values", F32, C.KEYS],
  ["uv.xys", F32, C.UVS], ["position_index.indices", I16, C.POS_IDX], ["drawable_mask.art_mesh_indices", I32, C.MASKS],
  ["draw_order_group.object_begin_indices", I32, C.DOG], ["draw_order_group.object_counts", I32, C.DOG], ["draw_order_group.object_total_counts", I32, C.DOG], ["draw_order_group.min_draw_orders", I32, C.DOG], ["draw_order_group.max_draw_orders", I32, C.DOG],
  ["draw_order_group_object.types", I32, C.DOGO], ["draw_order_group_object.indices", I32, C.DOGO], ["draw_order_group_object.group_indices", I32, C.DOGO],
  ["glue.runtime_space", RUNTIME, C.GLUES], ["glue.ids", STR64, C.GLUES], ["glue.keyform_binding_band_indices", I32, C.GLUES], ["glue.keyform_begin_indices", I32, C.GLUES], ["glue.keyform_counts", I32, C.GLUES], ["glue.art_mesh_index_as", I32, C.GLUES], ["glue.art_mesh_index_bs", I32, C.GLUES], ["glue.info_begin_indices", I32, C.GLUES], ["glue.info_counts", I32, C.GLUES],
  ["glue_info.weights", F32, C.GLUE_INFO], ["glue_info.position_indices", I16, C.GLUE_INFO],
  ["glue_keyform.intensities", F32, C.GLUE_KF],
];

export function parseMoc3(fileBytes) {
  // Own, 64-byte-aligned copy so typed-array views are valid at every offset.
  const ab = new ArrayBuffer(fileBytes.length);
  new Uint8Array(ab).set(fileBytes);
  const dv = new DataView(ab);
  if (String.fromCharCode(...new Uint8Array(ab, 0, 4)) !== "MOC3") throw new Error("not a moc3 file");
  const version = dv.getUint8(4);
  const sot = Array.from({ length: SOT_COUNT }, (_, i) => dv.getUint32(HEADER_SIZE + i * 4, true));
  const counts = Array.from({ length: 23 }, (_, i) => dv.getInt32(sot[0] + i * 4, true));
  const canvas = { ppu: dv.getFloat32(sot[1], true), originX: dv.getFloat32(sot[1] + 4, true), originY: dv.getFloat32(sot[1] + 8, true), width: dv.getFloat32(sot[1] + 12, true), height: dv.getFloat32(sot[1] + 16, true) };
  const sections = {};
  LAYOUT.forEach(([name, type, ci], i) => {
    const offset = sot[2 + i], n = counts[ci];
    let view;
    if (type === F32) view = new Float32Array(ab, offset, n);
    else if (type === I32 || type === BOOL) view = new Int32Array(ab, offset, n);
    else if (type === I16) view = new Int16Array(ab, offset, n);
    else if (type === U8) view = new Uint8Array(ab, offset, n);
    else if (type === STR64) {
      view = Array.from({ length: n }, (_, k) => {
        const b = new Uint8Array(ab, offset + k * 64, 64);
        const z = b.indexOf(0);
        return new TextDecoder().decode(b.subarray(0, z < 0 ? 64 : z));
      });
    } else view = null;
    sections[name] = { offset, count: n, type, view };
  });
  return {
    version, counts, canvas, sections,
    bytes: () => new Uint8Array(ab),
    /** Parameter id → index. */
    paramIndex: (id) => sections["parameter.ids"].view.indexOf(id),
    meshIndex: (id) => sections["art_mesh.ids"].view.indexOf(id),
  };
}

/**
 * Describe how one art mesh is driven: its keyform binding band (the parameters whose
 * keys form the keyform grid) and the vertex positions of every keyform.
 */
export function meshKeyforms(moc, mi) {
  const s = (n) => moc.sections[n].view;
  const band = s("art_mesh.keyform_binding_band_indices")[mi];
  const bBegin = s("keyform_binding_band.begin_indices")[band], bCount = s("keyform_binding_band.counts")[band];
  const bindings = [];
  for (let k = 0; k < bCount; k++) {
    const kbi = s("keyform_binding_index.indices")[bBegin + k];
    const kBegin = s("keyform_binding.keys_begin_indices")[kbi], kCount = s("keyform_binding.keys_counts")[kbi];
    // Which parameter owns this binding: the one whose binding range contains kbi.
    let param = -1;
    for (let p = 0; p < moc.counts[C.PARAMS]; p++) {
      const b0 = s("parameter.keyform_binding_begin_indices")[p], bc = s("parameter.keyform_binding_counts")[p];
      if (kbi >= b0 && kbi < b0 + bc) { param = p; break; }
    }
    bindings.push({ binding: kbi, param, paramId: param >= 0 ? s("parameter.ids")[param] : "?", keys: Array.from(s("keys.values").slice(kBegin, kBegin + kCount)) });
  }
  const kfBegin = s("art_mesh.keyform_begin_indices")[mi], kfCount = s("art_mesh.keyform_counts")[mi];
  // NB: the section named "position_index_counts" holds the VERTEX count and "vertex_counts"
  // holds the triangle-INDEX count (checked against Cubism Core totals). The names are
  // swapped relative to what you'd expect; this is how the format defines them.
  const verts = s("art_mesh.position_index_counts")[mi];
  return { band, bindings, keyformBegin: kfBegin, keyformCount: kfCount, vertexCount: verts };
}

export { LAYOUT, C as COUNT_INDEX };
