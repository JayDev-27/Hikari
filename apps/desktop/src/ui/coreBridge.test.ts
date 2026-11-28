import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type MessageType } from "@hikari/protocol";

type BrowserPreview = {
  inject: (type: MessageType, payload: unknown, turnId?: string) => void;
  sent: { type: MessageType; payload: unknown }[];
};

type PreviewWindow = {
  hikariCore?: BrowserPreview;
};

const browserWindow: PreviewWindow = {};
let bridge: typeof import("./coreBridge") | undefined;
let preview: BrowserPreview | undefined;

function getBridge() {
  if (!bridge) throw new Error("coreBridge has not been initialized");
  return bridge;
}

function getPreview() {
  if (!preview) throw new Error("browser-preview API has not been initialized");
  return preview;
}

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
  getPreview().sent.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("coreBridge browser preview", () => {
  it("records sent messages with their type and payload", async () => {
    const api = getBridge();
    const bus = getPreview();
    const payload = { role: "ui" as const, protocolVersion: PROTOCOL_VERSION };

    await api.sendToCore("hello", payload);

    expect(bus.sent).toEqual([{ type: "hello", payload }]);
  });

  it("delivers only the message types requested by each subscriber", () => {
    const api = getBridge();
    const bus = getPreview();
    const handler = vi.fn();
    const stop = api.onCore(["hello"], handler);
    const hello = { role: "ui" as const, protocolVersion: PROTOCOL_VERSION };

    bus.inject("state", {}, "ignored-turn");
    bus.inject("hello", hello, "hello-turn");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      type: "hello",
      payload: hello,
      turnId: "hello-turn",
    });

    stop();
  });

  it("returns an unsubscribe function that stops future delivery", () => {
    const api = getBridge();
    const bus = getPreview();
    const handler = vi.fn();
    const unsubscribe = api.onCore(["hello"], handler);

    expect(unsubscribe).toEqual(expect.any(Function));
    unsubscribe();

    bus.inject("hello", { role: "ui", protocolVersion: PROTOCOL_VERSION });

    expect(handler).not.toHaveBeenCalled();
  });
});
