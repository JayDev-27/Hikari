import { useEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { ChatEvent } from "../stage/runtime";
import { Subscriptions } from "../util/subscriptions";

interface Line {
  kind: "user" | "her" | "system";
  text: string;
  turnId?: string;
  via?: "voice" | "text";
  done?: boolean;
}

/** Fold a stream of transcript events into lines (her tokens append to her open line). */
export function foldChat(lines: Line[], e: ChatEvent): Line[] {
  if (e.kind === "end") return lines.map((l) => (l.kind === "her" && l.turnId === e.turnId ? { ...l, done: true } : l));
  if (e.kind === "her" && e.append) {
    const i = lines.findLastIndex((l) => l.kind === "her" && l.turnId === e.turnId && !l.done);
    if (i >= 0) return lines.map((l, j) => (j === i ? { ...l, text: l.text + e.text } : l));
  }
  return [...lines, { kind: e.kind, text: e.text, turnId: e.turnId, via: e.via }];
}

/**
 * Chat window: type to Hikari, see the running transcript (your voice turns
 * included). Talks to the core through the stage (`chat://send` / `chat://event`),
 * so the core sees a single UI connection.
 */
export function Chat() {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const subs = new Subscriptions();
    subs.add(listen<ChatEvent[]>("chat://history", (e) => setLines(e.payload.reduce(foldChat, []))));
    subs.add(listen<ChatEvent>("chat://event", (e) => setLines((ls) => foldChat(ls, e.payload))));
    void emitTo("stage", "chat://hello", null);
    return () => subs.dispose();
  }, []);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    void emitTo("stage", "chat://send", { text: t });
    setText("");
  };

  return (
    <div className="chat">
      <div className="chat-log">
        {lines.length === 0 && <p className="chat-empty">Say hi in English, हिंदी or Hinglish. Or hold ⌥Space and talk.</p>}
        {lines.map((l, i) => (
          <div key={i} className={`msg ${l.kind}`}>
            {l.kind === "user" && l.via === "voice" && <span className="via">🎙</span>}
            {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message Hikari…"
          aria-label="Message"
        />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
