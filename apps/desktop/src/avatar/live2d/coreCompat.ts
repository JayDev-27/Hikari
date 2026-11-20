/**
 * Cubism Core 6 (shipped in Cubism SDK for Web 5-r.5, 2026) moved
 * `model.drawables.renderOrders` to `model.getRenderOrders()` ("object render
 * orders", which also cover offscreens). untitled-pixi-live2d-engine 1.4.0 still
 * reads the old field and crashes in doDrawModel. Every other Drawables field
 * the engine reads is unchanged in Core 6 (checked against live2dcubismcore.d.ts).
 *
 * Shim: give each model's `drawables` a `renderOrders` getter backed by
 * `getRenderOrders()`. For models without offscreens (all bundled samples, most
 * models) object render orders == drawable render orders. Models that use
 * offscreens (Cubism 5.3+ feature) get a warning: their order may be wrong until
 * the engine supports Core 6. Remove once the engine does.
 */

interface CoreModel {
  drawables: { count: number; renderOrders?: Int32Array };
  offscreens?: { count?: number };
  getRenderOrders?: () => Int32Array;
}
interface CoreGlobal {
  Model: { fromMoc(moc: unknown): CoreModel | null; __hikariPatched?: boolean };
}

export function patchCubismCore(): void {
  const core = (window as unknown as { Live2DCubismCore?: CoreGlobal }).Live2DCubismCore;
  if (!core || core.Model.__hikariPatched) return;
  const fromMoc = core.Model.fromMoc.bind(core.Model);
  core.Model.fromMoc = (moc: unknown) => {
    const model = fromMoc(moc);
    if (model && model.drawables.renderOrders === undefined && typeof model.getRenderOrders === "function") {
      const offscreens = model.offscreens?.count ?? 0;
      if (offscreens > 0) {
        console.warn(`[hikari] model uses ${offscreens} offscreens; Live2D draw order may be wrong (engine lacks Core 6 support)`);
      }
      Object.defineProperty(model.drawables, "renderOrders", {
        get: () => model.getRenderOrders!().subarray(0, model.drawables.count),
        configurable: true,
      });
    }
    return model;
  };
  core.Model.__hikariPatched = true;
}
