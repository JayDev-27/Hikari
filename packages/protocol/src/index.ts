export * from "./generated";
import { PROTOCOL_VERSION, type Envelope, type MessageType, type PayloadMap } from "./generated";

/** Build an envelope with the current protocol version and timestamp. */
export function msg<T extends MessageType>(
  type: T,
  payload: PayloadMap[T],
  extra: Partial<Pick<Envelope<T>, "id" | "replyTo" | "turnId">> = {},
): Envelope<T> {
  return { v: PROTOCOL_VERSION, type, ts: Date.now(), payload, ...extra };
}

/** Major-version compatibility check used in the hello handshake. */
export function isCompatible(remote: string): boolean {
  return remote.split(".")[0] === PROTOCOL_VERSION.split(".")[0];
}
