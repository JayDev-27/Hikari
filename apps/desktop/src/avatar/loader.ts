import type { AvatarController } from "./types";
import type { CharacterPack } from "./characters";

/** The pack is an empty slot (franchise preset): the stage shows an import prompt. */
export class EmptySlotError extends Error {
  constructor(readonly pack: CharacterPack) {
    super(`${pack.displayName} has no model yet — import your own model for this character`);
  }
}

/** Construct the renderer for a resolved pack (code-split per renderer). */
export async function loadAvatar(host: HTMLElement, pack: CharacterPack): Promise<AvatarController> {
  if (!pack.modelUrl) throw new EmptySlotError(pack);
  if (pack.renderer === "live2d") {
    // The engine checks for Core at import time, so check first for a useful message.
    if (!("Live2DCubismCore" in window)) {
      throw new Error("Live2D Cubism Core isn't installed yet — run `pnpm -F desktop fetch:assets --sdk <SDK zip>`");
    }
    const { patchCubismCore } = await import("./live2d/coreCompat");
    patchCubismCore();
    const { Live2DAvatar } = await import("./live2d/Live2DAvatar");
    const avatar = await Live2DAvatar.create(host, pack);
    const ro = new ResizeObserver(() => avatar.resize());
    ro.observe(host);
    avatar.onDestroy = () => ro.disconnect();
    return avatar;
  }
  if (pack.renderer === "iki") {
    const { IkiAvatar } = await import("./iki/IkiAvatar");
    const avatar = await IkiAvatar.create(host, pack);
    const ro = new ResizeObserver(() => avatar.resize());
    ro.observe(host);
    avatar.onDestroy = () => ro.disconnect();
    return avatar;
  }
  throw new Error("VRM renderer lands in M3");
}
