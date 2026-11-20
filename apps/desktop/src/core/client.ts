import { isCompatible, msg, type AnyMessage, type MessageType, type PayloadMap } from "@hikari/protocol";

type Handler<T extends MessageType> = (payload: PayloadMap[T], env: Extract<AnyMessage, { type: T }>) => void;
type AnyHandler = (payload: never, env: never) => void;

/**
 * WebSocket client to the Python core (ws://127.0.0.1:<port>/ws).
 * Reconnects with backoff; performs the `hello` handshake and refuses a core
 * with an incompatible major protocol version.
 */
export class CoreClient {
  private ws?: WebSocket;
  private handlers = new Map<MessageType, Set<AnyHandler>>();
  private backoff = 250;
  private closed = false;
  connected = false;
  onStatus?: (connected: boolean, reason?: string) => void;

  constructor(private url: string) {}

  connect(): void {
    this.closed = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 250;
      this.send("hello", { role: "ui", protocolVersion: "0.1.0", capabilities: ["tts.chunk.phonemes", "barge_in"] });
    };
    ws.onmessage = (ev) => {
      let m: AnyMessage;
      try {
        m = JSON.parse(ev.data as string) as AnyMessage;
      } catch {
        return;
      }
      if (m.type === "hello") {
        if (!isCompatible(m.payload.protocolVersion)) {
          this.onStatus?.(false, `core speaks protocol ${m.payload.protocolVersion}`);
          ws.close();
          return;
        }
        this.connected = true;
        this.onStatus?.(true);
      }
      this.handlers.get(m.type)?.forEach((h) => h(m.payload as never, m as never));
    };
    ws.onclose = () => {
      this.connected = false;
      this.onStatus?.(false);
      if (!this.closed) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 5000);
      }
    };
  }

  on<T extends MessageType>(type: T, h: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    // Stored type-erased; dispatch is keyed by `type`, so payloads always match.
    const erased = h as unknown as AnyHandler;
    set.add(erased);
    return () => set!.delete(erased);
  }

  /** Dispatch a message locally as if it came from core (used by the dev mock). */
  inject(m: AnyMessage): void {
    this.handlers.get(m.type)?.forEach((h) => h(m.payload as never, m as never));
  }

  send<T extends MessageType>(type: T, payload: PayloadMap[T], extra?: { turnId?: string }): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg(type, payload, extra)));
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
