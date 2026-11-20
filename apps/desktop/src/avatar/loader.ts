import type { AvatarController } from "./types";
import { loadPack } from "./characters";

/** Load a character pack and construct the matching renderer (code-split per renderer). */
export async function loadAvatar(host: HTMLElement, characterId: string): Promise<AvatarController> {
  const pack = await loadPack(characterId);
  if (pack.renderer === "live2d") {
    // The engine checks for Core at import time, so check first for a useful message.
    if (!("Live2DCubismCore" in window)) {
      throw new Error("Live2D Cubism Core isn't installed yet — run `pnpm -F desktop fetch:assets --sdk <SDK zip>`");
    }
    const { Live2DAvatar } = await import("./live2d/Live2DAvatar");
    const avatar = await Live2DAvatar.create(host, pack);
    new ResizeObserver(() => avatar.resize()).observe(host);
    return avatar;
  }
  throw new Error("VRM renderer lands in M3");
}
