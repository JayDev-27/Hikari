import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import type { ChatEvent } from "../stage/runtime";
import { Subscriptions } from "../util/subscriptions";
import { ACTIVE_KEY, activeCharacterId } from "../avatar/characters";
import { builtinPacks } from "../avatar/packs";
import { characterHue, initials } from "../studio/format";
import "../ui/tokens.css";
import "./chat.css";

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

/** Where a bubble sits in a run of messages from the same sender: shapes its corners like Messages does. */
export function bubblePosition(lines: Line[], i: number): "single" | "first" | "middle" | "last" {
  const same = (j: number) => j >= 0 && j < lines.length && lines[j].kind === lines[i].kind && lines[i].kind !== "system";
  const prev = same(i - 1), next = same(i + 1);
  return prev && next ? "middle" : prev ? "last" : next ? "first" : "single";
}

const SUGGESTIONS = ["How was your day?", "आज क्या प्लान है?", "Ek mazedaar fact batao!"];
const inTauri = () => "__TAURI_INTERNALS__" in window;
const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);

/** The character the stage is showing, kept in sync with the Studio through localStorage. */
function useActiveCharacter() {
  const [id, setId] = useState(activeCharacterId());
  useEffect(() => {
    const sync = (e: StorageEvent) => e.key === ACTIVE_KEY && e.newValue && setId(e.newValue);
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const pack = useMemo(() => builtinPacks().find((p) => p.id === id), [id]);
  return { id, name: pack?.displayName ?? "Hikari", avatar: pack?.avatarUrl };
}

/**
 * Chat window: type to Hikari, see the running transcript (your voice turns
 * included). Talks to the core through the stage (`chat://send` / `chat://event`),
 * so the core sees a single UI connection.
 */
export function Chat() {
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const who = useActiveCharacter();
  const hue = { "--hue": characterHue(who.id) } as CSSProperties;

  useEffect(() => {
    if (!inTauri()) {
      // Browser preview (dev only): window.hikariChat([...ChatEvent]) plays transcript events, e.g. to check
      // her streaming bubble without a core.
      if (import.meta.env.DEV) (window as unknown as { hikariChat: (es: ChatEvent[]) => void }).hikariChat = (es) => setLines((ls) => es.reduce(foldChat, ls));
      return;
    }
    const subs = new Subscriptions();
    subs.add(listen<ChatEvent[]>("chat://history", (e) => setLines(e.payload.reduce(foldChat, []))));
    subs.add(listen<ChatEvent>("chat://event", (e) => setLines((ls) => foldChat(ls, e.payload))));
    void emitTo("stage", "chat://hello", null);
    return () => subs.dispose();
  }, []);

  // Follow new messages only while the reader is at the bottom; otherwise offer a jump button.
  useLayoutEffect(() => {
    const el = log.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [lines, atBottom]);

  // Grow the composer with its text, up to five lines.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [text]);

  const send = (value = text) => {
    const t = value.trim();
    if (!t) return;
    if (inTauri()) void emitTo("stage", "chat://send", { text: t });
    else setLines((ls) => [...ls, { kind: "user", text: t, via: "text" }]); // browser preview: echo locally
    setText("");
    setAtBottom(true);
    field.current?.focus();
  };

  const typing = lines.at(-1)?.kind === "her" && !lines.at(-1)?.done;
  const waiting = lines.at(-1)?.kind === "user"; // sent, her reply not started yet

  return (
    <div className={`ch hk${unifiedTitlebar() ? " ch-unified" : ""}`} style={hue}>
      <header className="ch-head" data-tauri-drag-region>
        <span className={`ch-avatar${who.avatar ? " has-img" : ""}`} aria-hidden="true">{who.avatar ? <img src={who.avatar} alt="" draggable={false} /> : initials(who.name)}</span>
        <div className="ch-who" data-tauri-drag-region>
          <p className="ch-name">{who.name}</p>
          <p className="ch-status">{typing ? "typing…" : waiting ? "thinking…" : "Hold ⌥ Space to talk"}</p>
        </div>
      </header>

      <div
        className="ch-log"
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <div className="ch-empty">
            <span className={`ch-avatar ch-avatar-lg${who.avatar ? " has-img" : ""}`} aria-hidden="true">{who.avatar ? <img src={who.avatar} alt="" draggable={false} /> : initials(who.name)}</span>
            <p className="ch-empty-title">Say hi to {who.name}</p>
            <p className="ch-empty-sub">English, हिंदी or Hinglish. Or hold ⌥ Space and just talk.</p>
            <div className="ch-suggest">
              {SUGGESTIONS.map((s) => <button key={s} className="ch-chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <>
            <p className="ch-day">Today</p>
            {lines.map((l, i) =>
              l.kind === "system" ? (
                <p key={i} className="ch-system">{l.text}</p>
              ) : (
                <div key={i} className={`ch-row ${l.kind} ${bubblePosition(lines, i)}`}>
                  <div className={`ch-bubble${l.kind === "her" && !l.done ? " streaming" : ""}`}>{l.text}</div>
                  {l.kind === "user" && l.via === "voice" && bubblePosition(lines, i) !== "first" && bubblePosition(lines, i) !== "middle" && (
                    <span className="ch-via"><MicIcon /> Voice</span>
                  )}
                </div>
              ),
            )}
            {waiting && (
              <div className="ch-row her single">
                <div className="ch-bubble ch-dots" aria-label={`${who.name} is thinking`}><i /><i /><i /></div>
              </div>
            )}
          </>
        )}
      </div>

      {!atBottom && (
        <button className="ch-jump" aria-label="Jump to the latest message" onClick={() => setAtBottom(true)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg>
        </button>
      )}

      <form className="ch-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="ch-field">
          <textarea
            ref={field}
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Message ${who.name}`}
            aria-label="Message"
          />
          <button type="submit" className="ch-send" disabled={!text.trim()} aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
          </button>
        </div>
      </form>
    </div>
  );
}

const MicIcon = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" />
  </svg>
);
