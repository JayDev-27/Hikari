import { describe, expect, it, vi } from "vitest";
import { Subscriptions } from "./subscriptions";

describe("Subscriptions", () => {
  it("unsubscribes a listener that resolves after dispose (StrictMode double-mount)", async () => {
    const un = vi.fn();
    let resolve!: (u: () => void) => void;
    const s = new Subscriptions();
    s.add(new Promise<() => void>((r) => (resolve = r)));
    s.dispose(); // effect cleanup runs before listen() resolves
    resolve(un);
    await Promise.resolve();
    await Promise.resolve();
    expect(un).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes resolved listeners on dispose, once", async () => {
    const un = vi.fn();
    const s = new Subscriptions();
    s.add(Promise.resolve(un));
    await Promise.resolve();
    await Promise.resolve();
    s.dispose();
    s.dispose();
    expect(un).toHaveBeenCalledTimes(1);
  });
});
