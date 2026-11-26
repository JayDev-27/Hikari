import { useCallback, useMemo } from "react";
import type { MessageType, PayloadMap } from "@hikari/protocol";
import { inTauri, sendToCore, useCoreStatus } from "../ui/coreBridge";

/**
 * How a panel (Memories, Voice Lab) reaches the core.
 *  - In the app: through the stage (coreBridge); "connected" is the stage's live status. Nothing is ever faked.
 *  - In a DEV browser preview: the coreBridge local bus, plus an optional stand-in core whose replies are injected
 *    back through `window.hikariCore.inject`, exactly like messages from a real core. Pick with the hash query:
 *      #/memory            stand-in core answers (sample data)
 *      #/memory?core=manual connected, nothing answers: drive it yourself with hikariCore.inject(…)
 *      #/memory?core=offline the offline state
 */
export type LinkMode = "app" | "fake" | "manual" | "offline";

export interface StandIn {
  handle<T extends MessageType>(type: T, payload: PayloadMap[T]): { type: MessageType; payload: unknown }[];
}

export function previewMode(): LinkMode {
  if (inTauri() || !import.meta.env.DEV) return "app";
  const core = new URLSearchParams(location.hash.split("?")[1] ?? "").get("core");
  return core === "manual" || core === "offline" ? core : "fake";
}

/** Replies from a stand-in core land after a short, real-feeling delay. */
const FAKE_LATENCY_MS = 220;

export type Emit = (type: MessageType, payload: unknown) => void;
/** Deliver a message to this window's listeners as if the core had sent it (browser preview only). */
const injectLocal: Emit = (type, payload) =>
  (window as unknown as { hikariCore?: { inject: Emit } }).hikariCore?.inject(type, payload);

/** `standIn` gets an `emit` for messages it sends on its own later (e.g. training progress). */
export function usePanelLink(standIn?: (emit: Emit) => StandIn) {
  const status = useCoreStatus();
  const mode = useMemo(() => previewMode(), []);
  const fake = useMemo(() => (mode === "fake" && standIn ? standIn(injectLocal) : undefined), [mode, standIn]);
  const connected = mode === "app" ? status.connected : mode !== "offline";

  const send = useCallback(
    async <T extends MessageType>(type: T, payload: PayloadMap[T]) => {
      await sendToCore(type, payload);
      if (!fake) return;
      const replies = fake.handle(type, payload);
      if (replies.length) setTimeout(() => replies.forEach((r) => injectLocal(r.type, r.payload)), FAKE_LATENCY_MS);
    },
    [fake],
  );

  return { connected, reason: mode === "app" ? status.reason : undefined, mode, send, fake };
}
