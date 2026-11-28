import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageType } from "@hikari/protocol";

type BrowserPreview = {
  inject: (type: MessageType, payload: unknown, turnId?: string) => void;
  sent: { type: MessageType; payload: unknown }[];
};

type PreviewWindow = {
  hikariCore?: BrowserPreview;
};

const browserWindow: PreviewWindow = {};
let bridge: typeof import("./coreBridge");
let preview: BrowserPreview;

beforeAll(async () => {
  // coreBridge exposes its preview bus while running in a browser DEV build.
  // Stub window before importing it so the module takes that initialization path.
  vi.stubGlobal("window", browserWindow);
  bridge = await import("./coreBridge");

  if (!browserWindow.hikariCore) {
    throw new Error("coreBridge did not expose the browser-preview API");
  }
  preview = browserWindow.hikariCore;
});

beforeEach(() => {
  preview.sent.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("coreBridge browser preview", () => {
  it("records sent messages with their type and payload", async () => {
    const payload = { role: "ui" as const, protocolVersion: "0.2.0" };

    await bridge.sendToCore("hello", payload);

    expect(preview.sent).toEqual([{ type: "hello", payload }]);
  });

  it("delivers only the message types requested by each subscriber", () => {
    const handler = vi.fn();
    const stop = bridge.onCore(["hello"], handler);
    const hello = { role: "ui" as const, protocolVersion: "0.2.0" };

    preview.inject("state", {}, "ignored-turn");
    preview.inject("hello", hello, "hello-turn");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "hello",
      payload: hello,
      turnId: "hello-turn",
    });

    stop();
  });

  it("returns an unsubscribe function that stops future delivery", () => {
    const handler = vi.fn();
    const unsubscribe = bridge.onCore(["hello"], handler);

    expect(unsubscribe).toEqual(expect.any(Function));
    unsubscribe();

    preview.inject("hello", { role: "ui", protocolVersion: "0.2.0" });

    expect(handler).not.toHaveBeenCalled();
  });
});
