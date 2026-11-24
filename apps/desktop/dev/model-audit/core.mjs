// Load the real Live2D Cubism Core (the proprietary browser build fetched by
// `pnpm fetch:assets`) inside Node, so rigs can be inspected and validated without a
// browser. The Core is Emscripten/WASM and expects a few browser globals.
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CORE_PATH = join(here, "../../public/live2d/live2dcubismcore.min.js");

let ready;

/** Resolve to the `Live2DCubismCore` namespace once its WASM has initialised. */
export function loadCore() {
  ready ??= (async () => {
    const g = globalThis;
    g.window ??= g;
    g.self ??= g;
    g.document ??= { currentScript: { src: "file:///core.js" }, createElement: () => ({}), getElementsByTagName: () => [] };
    g.location ??= { href: "file:///" };
    runInThisContext(readFileSync(CORE_PATH, "utf8"), { filename: "live2dcubismcore.min.js" });
    const C = g.Live2DCubismCore;
    // The WASM instantiates asynchronously; calls before that throw.
    for (let i = 0; i < 100; i++) {
      try {
        C.Version.csmGetVersion();
        return C;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    throw new Error("Cubism Core did not initialise");
  })();
  return ready;
}

export const coreAvailable = () => {
  try {
    readFileSync(CORE_PATH);
    return true;
  } catch {
    return false;
  }
};
