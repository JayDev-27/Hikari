import { useEffect, useState } from "react";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import type { MessageType, PayloadMap } from "@hikari/protocol";

/**
 * Panels (Settings, Memory, Voice Lab, Activity, Confirm, Onboarding) talk to the core through the stage, which owns
 * the one WebSocket connection, the same way Chat does:
 *   panel → `core://send` {type, payload} → stage → core
 *   core → stage → `core://event` {type, payload, turnId} → every panel
 *   stage → `core://status` {connected, reason} → every panel (ask with `core://hello`)
 * In a browser preview (no Tauri) a panel gets a local bus instead, so it can be driven from the console:
 * `window.hikariCore.inject("memory.results", {...})`.
 */
export interface CoreEvent<T extends MessageType = MessageType> {
  type: T;
  payload: PayloadMap[T];
  turnId?: string;
}
export interface CoreStatus {
  connected: boolean;
  reason?: string;
}

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Listener = (e: CoreEvent) => void;
const local = { listeners: new Set<Listener>(), sent: [] as CoreEvent[], status: { connected: false } as CoreStatus };

if (typeof window !== "undefined" && !inTauri() && import.meta.env.DEV) {
  (window as unknown as { hikariCore: unknown }).hikariCore = {
    inject: (type: MessageType, payload: unknown, turnId?: string) => local.listeners.forEach((l) => l({ type, payload, turnId } as CoreEvent)),
    sent: local.sent,
  };
}

/** Send a protocol message to the core (through the stage). Resolves once handed to the stage. */
export async function sendToCore<T extends MessageType>(type: T, payload: PayloadMap[T]): Promise<void> {
  if (!inTauri()) {
    local.sent.push({ type, payload });
    return;
  }
  await emitTo("stage", "core://send", { type, payload });
}

/** Subscribe to core messages of the given types. Returns an unsubscribe function. */
export function onCore(types: MessageType[], handler: (e: CoreEvent) => void): () => void {
  const want = new Set(types);
  const fn: Listener = (e) => want.has(e.type) && handler(e);
  if (!inTauri()) {
    local.listeners.add(fn);
    return () => local.listeners.delete(fn);
  }
  let off: (() => void) | undefined;
  let gone = false;
  void listen<CoreEvent>("core://event", (e) => fn(e.payload)).then((u) => (gone ? u() : (off = u)));
  return () => {
    gone = true;
    off?.();
  };
}

/** Live connection status of the core, as the stage sees it. */
export function useCoreStatus(): CoreStatus {
  const [status, setStatus] = useState<CoreStatus>(local.status);
  useEffect(() => {
    if (!inTauri()) return;
    let off: (() => void) | undefined;
    let gone = false;
    void listen<CoreStatus>("core://status", (e) => setStatus(e.payload)).then((u) => (gone ? u() : (off = u)));
    void emit("core://hello", null);
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  return status;
}

/** Messages the stage forwards to panels (everything a panel might show; audio and lip-sync traffic stays put). */
export const PANEL_MESSAGES: MessageType[] = [
  "tool.request", "tool.result", "memory.results", "voice_lab.event", "provider.status", "error", "state", "hello",
];
