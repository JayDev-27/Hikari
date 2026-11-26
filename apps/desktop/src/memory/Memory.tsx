import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ErrorInfo, MemoryItem, MemoryResults } from "@hikari/protocol";
import { inTauri, onCore } from "../ui/coreBridge";
import { ACTIVE_KEY, activeCharacterId } from "../avatar/characters";
import { builtinPacks } from "../avatar/packs";
import { characterHue, initials } from "../studio/format";
import { IconCheck, IconSearch, IconTrash, IconWarn } from "../studio/icons";
import { usePanelLink } from "./link";
import { ALL_CHARACTERS, KINDS, PAGE_SIZE, SEARCH_DEBOUNCE_MS, buildQuery, debounce, kindLabel, type KindFilter } from "./query";
import { cleanItems, hasMore, initialMemState, isPending, loadingState, memoryErrorKind, memReducer, visibleItems, visibleTotal, type MemOp } from "./store";
import { confidenceLabel, countLabel, editedItem, importanceBars, importanceLabel, memoryDate } from "./format";
import { FakeMemoryCore } from "./devCore";
import "../ui/tokens.css";
import "../studio/studio.css";
import "./memory.css";

type Toast = { id: number; kind: "ok" | "error"; title: string; detail?: string };
const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const makeStandIn = () => new FakeMemoryCore(Date.now(), activeCharacterId());
/** Read the clock in event handlers (kept out of render). */
const wallClock = () => Date.now();

/** The character on the desktop, kept in sync with the Studio through localStorage (as Chat does). */
function useActiveCharacter() {
  const [id, setId] = useState(activeCharacterId());
  useEffect(() => {
    const sync = (e: StorageEvent) => e.key === ACTIVE_KEY && e.newValue && setId(e.newValue);
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return id;
}

/** Wall-clock time, refreshed every minute (for "Today" / "Yesterday"). */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Memories window: browse, search, edit and delete what Hikari remembers. Every change goes to the core
 * (`memory.upsert` / `memory.delete`) and shows at once; if the core reports a failure, it's put back.
 */
export function Memory() {
  const link = usePanelLink(makeStandIn);
  const { send, connected } = link;
  const activeId = useActiveCharacter();
  const packs = useMemo(() => builtinPacks().sort((a, b) => a.displayName.localeCompare(b.displayName)), []);
  const nameOf = useCallback((id?: string) => packs.find((p) => p.id === id)?.displayName ?? id ?? "", [packs]);
  const now = useNow();

  const [nsPick, setNsPick] = useState<string | null>(null);
  const namespace = nsPick ?? activeId;
  const [kind, setKind] = useState<KindFilter>("all");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const search = useMemo(() => debounce(setQ, SEARCH_DEBOUNCE_MS), []);
  useEffect(() => () => search.cancel(), [search]);
  const searchField = useRef<HTMLInputElement>(null);

  const [state, dispatch] = useReducer(memReducer, initialMemState);
  const seq = useRef(0);
  const gen = useRef(0);
  const opIds = useRef(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const listEl = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "error" ? 8000 : 4000);
  }, []);

  // DEV preview: `hikariMemory.failNext = true` makes the stand-in core fail the next edit or delete.
  useEffect(() => {
    if (link.fake) (window as unknown as { hikariMemory: unknown }).hikariMemory = link.fake;
  }, [link.fake]);

  const filter = useMemo(() => ({ text: q, kind, namespace }), [q, kind, namespace]);
  const query = useCallback(
    (offset: number, limit = PAGE_SIZE, fresh = false) => {
      if (fresh) gen.current++;
      const s = ++seq.current;
      dispatch({ type: "query", seq: s, gen: gen.current, offset, limit });
      send("memory.query", buildQuery({ ...filter, offset, limit })).catch(() => dispatch({ type: "queryFailed" }));
    },
    [filter, send],
  );

  // A new filter (or the core coming back) starts the list over. The same filter isn't asked twice in a row (React's
  // dev double effects would otherwise leave an extra unanswered query that eats the next reply).
  const lastAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!connected) {
      lastAsked.current = null;
      dispatch({ type: "offline" });
      return;
    }
    const key = JSON.stringify(filter);
    if (key === lastAsked.current) return;
    lastAsked.current = key;
    query(0, PAGE_SIZE, true);
  }, [connected, query, filter]);

  useEffect(
    () =>
      onCore(["memory.results", "error"], (e) => {
        if (e.type === "memory.results") {
          const r = e.payload as MemoryResults;
          dispatch({ type: "results", items: cleanItems(r.items), total: typeof r.total === "number" ? r.total : undefined });
          return;
        }
        const err = e.payload as ErrorInfo;
        const what = memoryErrorKind(err.code);
        if (what === "query") dispatch({ type: "queryFailed" });
        else if (what === "upsert" || what === "delete") {
          dispatch({ type: "opFailed", opKind: what === "upsert" ? "edit" : "delete" });
          toast({ kind: "error", title: what === "upsert" ? "Couldn't save your edit, so it was put back." : "Couldn't forget that, so it was put back.", detail: err.message });
        } else if (what === "other") toast({ kind: "error", title: "Memory problem", detail: err.message });
      }),
    [toast],
  );

  const items = visibleItems(state);
  const total = visibleTotal(state);
  const more = hasMore(state);
  const loading = loadingState(state);
  const loadedCount = state.base.length;

  // Infinite list: fetch the next page as the end comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || loading !== "none") return;
    const io = new IntersectionObserver((es) => es.some((x) => x.isIntersecting) && query(loadedCount), { root: listEl.current, rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loading, query, loadedCount]);

  const refresh = () => query(0, Math.max(PAGE_SIZE, loadedCount));

  const runOp = (op: MemOp, request: Promise<void>, failTitle: string) => {
    dispatch({ type: "op", op });
    request.then(refresh, (e: unknown) => {
      dispatch({ type: "opFailed", opId: op.opId });
      toast({ kind: "error", title: failTitle, detail: String(e) });
    });
  };

  const saveEdit = (item: MemoryItem, draft: string) => {
    setEditing(null);
    const next = editedItem(item, draft, wallClock());
    if (!next.text || next.text === item.text.trim()) return;
    runOp({ opId: ++opIds.current, seq: ++seq.current, kind: "edit", item: next, prev: item }, send("memory.upsert", next), "Couldn't save your edit, so it was put back.");
  };

  const forget = (ids: string[]) => {
    setConfirm(null);
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    runOp({ opId: ++opIds.current, seq: ++seq.current, kind: "delete", ids }, send("memory.delete", { ids }), "Couldn't forget that, so it was put back.");
    toast({ kind: "ok", title: ids.length === 1 ? "Forgotten." : `Forgot ${ids.length} memories.` });
  };

  // Selection only counts what's on screen (a new filter hides, but doesn't silently delete, old picks).
  const shownIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const picked = [...selected].filter((id) => shownIds.has(id));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  // Keyboard: ⌘F search, ⌘A select all, ⌫ delete selection, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchField.current?.focus();
        searchField.current?.select();
      } else if (confirm && e.key === "Escape") setConfirm(null);
      else if (typing) return;
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && connected) {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.id)));
      } else if ((e.key === "Backspace" || e.key === "Delete") && picked.length && !confirm) {
        e.preventDefault();
        setConfirm(picked);
      } else if (e.key === "Escape" && picked.length) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const kindInfo = KINDS.find((k) => k.id === kind)!;
  const allChars = namespace === ALL_CHARACTERS;
  const who = allChars ? "Hikari" : nameOf(namespace);
  const hue = { "--hue": characterHue(allChars ? "hikari" : namespace) } as CSSProperties;

  let body: ReactNode;
  if (!connected) {
    body = (
      <Empty icon={<IconBrain />} title="Hikari's brain isn't running">
        Memories are kept by Hikari's core, on this Mac. When it's running, everything she remembers shows up here, and you can
        correct or remove any of it.
        {link.reason && <span className="mm-fine">{link.reason}</span>}
      </Empty>
    );
  } else if (loading === "first" && !items.length) {
    body = <div className="mm-center"><span className="st-spinner" aria-label="Loading memories" /></div>;
  } else if (state.failed && !items.length) {
    body = (
      <Empty icon={<IconWarn />} title="Couldn't load memories">
        The core didn't answer the search. <button className="st-btn" onClick={() => query(0, PAGE_SIZE, true)}>Try Again</button>
      </Empty>
    );
  } else if (!items.length) {
    body = q ? (
      <Empty icon={<IconSearch />} title={`No memories match “${q}”`}>
        <button className="st-btn" onClick={() => { setText(""); search.cancel(); setQ(""); }}>Clear Search</button>
      </Empty>
    ) : (
      <Empty icon={<KindIcon kind={kind} />} title={kind === "all" ? `${who} hasn't remembered anything yet` : `No ${kindInfo.label.toLowerCase()} yet`}>
        Talk for a while and what matters will show up here.
      </Empty>
    );
  } else {
    body = (
      <>
        <ul className={`mm-items${loading === "first" ? " stale" : ""}`} aria-label={`${kindInfo.label}${allChars ? "" : ` of ${who}`}`}>
          {items.map((it) => (
            <Row
              key={it.id}
              item={it}
              now={now}
              showKind={kind === "all"}
              showWho={allChars ? nameOf(it.namespace) : undefined}
              selected={selected.has(it.id)}
              anySelected={picked.length > 0}
              pending={isPending(state, it.id)}
              editing={editing === it.id}
              onToggle={() => toggle(it.id)}
              onEdit={() => setEditing(it.id)}
              onCancel={() => setEditing(null)}
              onSave={(t) => saveEdit(it, t)}
              onDelete={() => setConfirm([it.id])}
            />
          ))}
        </ul>
        {more && <div ref={sentinel} className="mm-more">{loading === "more" && <span className="st-spinner" aria-label="Loading more" />}</div>}
      </>
    );
  }

  return (
    <div className={`st mm hk${unifiedTitlebar() ? " st-unified" : ""}`} style={hue}>
      {unifiedTitlebar() && <div className="st-titlebar" data-tauri-drag-region />}
      <aside className="st-sidebar">
        <label className="mm-who" title="Whose memories to show">
          {allChars ? <span className="mm-avatar mm-avatar-all" aria-hidden="true"><IconPeople /></span> : <Avatar id={namespace} name={who} />}
          <span className="st-row-text">
            <span className="st-row-name">{allChars ? "All Characters" : who}</span>
            <span className="st-row-sub">{allChars ? "Everyone's memories" : namespace === activeId ? "On your desktop" : "Character"}</span>
          </span>
          <svg className="mm-updown" width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1.5 5 3-3 3 3M1.5 9l3 3 3-3" /></svg>
          <select value={namespace} onChange={(e) => setNsPick(e.target.value)} aria-label="Character">
            <option value={activeId}>{nameOf(activeId)} (on your desktop)</option>
            <option value={ALL_CHARACTERS}>All Characters</option>
            <optgroup label="Other characters">
              {packs.filter((p) => p.id !== activeId).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </optgroup>
          </select>
        </label>

        <nav className="st-list" aria-label="Kinds of memory">
          <h3 className="st-group">Library</h3>
          {KINDS.map((k) => (
            <button key={k.id} className={`st-row mm-kind${k.id === kind ? " sel" : ""}`} aria-current={k.id === kind} onClick={() => setKind(k.id)}>
              <span className="mm-kind-icon"><KindIcon kind={k.id} /></span>
              <span className="st-row-name">{k.label}</span>
            </button>
          ))}
        </nav>

        <div className="st-sidebar-foot mm-foot">
          <span className={`mm-dot${connected ? " on" : ""}`} aria-hidden="true" />
          {connected ? (link.mode === "app" ? "Connected to Hikari's core" : link.mode === "fake" ? "Preview · sample memories" : "Preview · drive with hikariCore") : "Core not running"}
        </div>
      </aside>

      <main className="st-main mm-main">
        <header className="mm-toolbar" data-tauri-drag-region>
          <div className="mm-title" data-tauri-drag-region>
            <h1>{kindInfo.label}</h1>
            <p>{connected && items.length ? countLabel(items.length, total, more) : kindInfo.hint}</p>
          </div>
          <label className="st-search mm-search">
            <IconSearch />
            <input
              ref={searchField}
              type="search"
              placeholder="Search memories"
              value={text}
              disabled={!connected}
              spellCheck={false}
              aria-label="Search memories"
              onChange={(e) => { setText(e.target.value); search(e.target.value); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") search.flush();
                if (e.key === "Escape" && text) { e.stopPropagation(); setText(""); search.cancel(); setQ(""); }
              }}
            />
          </label>
        </header>

        {picked.length > 0 && (
          <div className="mm-selbar" role="toolbar" aria-label="Selection">
            <span>{picked.length} selected</span>
            <button className="st-btn st-btn-plain" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>Select All</button>
            <span className="mm-spacer" />
            <button className="st-btn st-btn-plain" onClick={() => setSelected(new Set())}>Done</button>
            <button className="st-btn st-btn-danger-plain st-btn" onClick={() => setConfirm(picked)}><IconTrash /> Delete…</button>
          </div>
        )}

        <div className="mm-list" ref={listEl}>{body}</div>
      </main>

      <div className="st-toasts mm-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`st-toast ${t.kind}`}>
            <span className="st-toast-icon">{t.kind === "ok" ? <IconCheck /> : <IconWarn />}</span>
            <div>
              <p>{t.title}</p>
              {t.detail && <p className="st-toast-detail">{t.detail}</p>}
            </div>
          </div>
        ))}
      </div>

      {confirm && (
        <div className="st-sheet-backdrop" onClick={() => setConfirm(null)}>
          <div className="st-sheet" role="alertdialog" aria-modal="true" aria-labelledby="mm-confirm-title" onClick={(e) => e.stopPropagation()}>
            <div className="st-sheet-icon"><IconTrash /></div>
            <h2 id="mm-confirm-title">{confirm.length === 1 ? "Delete this memory?" : `Delete ${confirm.length} memories?`}</h2>
            <p>
              {allChars ? "Hikari" : who} will forget {confirm.length === 1 ? "it" : "them"} for good. This can't be undone.
            </p>
            {confirm.length === 1 && <p className="mm-quote">“{items.find((i) => i.id === confirm[0])?.text}”</p>}
            <div className="st-sheet-actions">
              <button className="st-btn" autoFocus onClick={() => setConfirm(null)}>Cancel</button>
              <button className="st-btn st-btn-danger" onClick={() => forget(confirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ item, now, showKind, showWho, selected, anySelected, pending, editing, onToggle, onEdit, onCancel, onSave, onDelete }: {
  item: MemoryItem;
  now: number;
  showKind: boolean;
  showWho?: string;
  selected: boolean;
  anySelected: boolean;
  pending: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(item.text);
  const field = useRef<HTMLTextAreaElement>(null);
  const bars = importanceBars(item.importance);
  const conf = confidenceLabel(item.confidence);
  const edited = item.updatedAt !== undefined && item.createdAt !== undefined && item.updatedAt > item.createdAt;

  useEffect(() => {
    const el = field.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const startEdit = () => {
    setDraft(item.text);
    onEdit();
  };

  return (
    <li className={`mm-row${selected ? " sel" : ""}${pending ? " pending" : ""}${editing ? " editing" : ""}${anySelected ? " selecting" : ""}`}>
      <button className={`mm-check${selected ? " on" : ""}`} role="checkbox" aria-checked={selected} aria-label="Select" onClick={onToggle}>
        {selected && <IconCheck />}
      </button>
      <div className="mm-body">
        {editing ? (
          <form className="mm-edit" onSubmit={(e) => { e.preventDefault(); onSave(draft); }}>
            <textarea
              ref={field}
              value={draft}
              rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 70)))}
              aria-label="Memory text"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
                if (e.key === "Enter" && (e.metaKey || !e.shiftKey) && !e.nativeEvent.isComposing) { e.preventDefault(); onSave(draft); }
              }}
            />
            <div className="mm-edit-actions">
              <span className="mm-fine">↩ to save · Esc to cancel</span>
              <button type="button" className="st-btn" onClick={onCancel}>Cancel</button>
              <button type="submit" className="st-btn st-btn-primary mm-save" disabled={!draft.trim()}>Save</button>
            </div>
          </form>
        ) : (
          <p className="mm-text" onDoubleClick={startEdit}>{item.text}</p>
        )}
        <div className="mm-meta">
          {showKind && <span className={`mm-tag k-${item.kind}`}>{kindLabel[item.kind]}</span>}
          {showWho && <span className="mm-tag">{showWho}</span>}
          <span>{memoryDate(item.createdAt, now)}{edited && " · edited"}</span>
          {bars > 0 && (
            <span className="mm-bars" title={`${importanceLabel(item.importance)} (${Math.round((item.importance ?? 0) * 100)}%)`} aria-label={importanceLabel(item.importance)}>
              {[1, 2, 3].map((b) => <i key={b} className={b <= bars ? "on" : ""} />)}
            </span>
          )}
          {conf && <span className={`mm-conf ${conf.level}`} title={`Confidence ${conf.pct}`}>{conf.word}</span>}
          {item.emotion && item.emotion !== "neutral" && <span className="mm-emotion">{item.emotion}</span>}
          {pending && <span className="mm-saving">Saving…</span>}
        </div>
      </div>
      {!editing && (
        <div className="mm-actions">
          <button className="st-btn st-btn-plain st-icon-btn" aria-label="Edit memory" title="Edit" onClick={startEdit}><IconPencil /></button>
          <button className="st-btn st-btn-plain st-icon-btn mm-del" aria-label="Delete memory" title="Delete" onClick={onDelete}><IconTrash /></button>
        </div>
      )}
    </li>
  );
}

function Avatar({ id, name }: { id: string; name: string }) {
  const pack = useMemo(() => builtinPacks().find((p) => p.id === id), [id]);
  const [broken, setBroken] = useState(false);
  const img = pack?.avatarUrl && !broken;
  return (
    <span className={`mm-avatar${img ? " has-img" : ""}`} style={{ "--hue": characterHue(id) } as CSSProperties} aria-hidden="true">
      {img ? <img src={pack!.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="mm-empty">
      <span className="mm-empty-icon">{icon}</span>
      <p className="mm-empty-title">{title}</p>
      <div className="mm-empty-sub">{children}</div>
    </div>
  );
}

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const IconPencil = () => <svg {...base}><path d="M10.5 2.8a1.6 1.6 0 0 1 2.3 2.3L5.5 12.4 2.5 13.5l1.1-3Z" /><path d="m9.5 3.8 2.3 2.3" /></svg>;
const IconPeople = () => <svg {...base}><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13a4.2 4.2 0 0 1 8.4 0" /><path d="M10.5 3.4a2.3 2.3 0 0 1 0 4.3M12 9.3a4.2 4.2 0 0 1 2.2 3.7" /></svg>;
const IconBrain = () => (
  <svg {...base} width="28" height="28"><path d="M6 2.5a2 2 0 0 0-2 2 2 2 0 0 0-1.5 3 2.2 2.2 0 0 0 .8 3.6A2.2 2.2 0 0 0 6 13.5a1.5 1.5 0 0 0 2-.6V3.6a1.5 1.5 0 0 0-2-1.1Z" /><path d="M10 2.5a2 2 0 0 1 2 2 2 2 0 0 1 1.5 3 2.2 2.2 0 0 1-.8 3.6 2.2 2.2 0 0 1-2.7 2.4 1.5 1.5 0 0 1-2-.6" /></svg>
);
function KindIcon({ kind }: { kind: KindFilter }) {
  switch (kind) {
    case "fact":
      return <svg {...base}><path d="M5.5 10.5a4.5 4.5 0 1 1 5 0V12h-5Z" /><path d="M6.5 14h3" /></svg>;
    case "episode":
      return <svg {...base}><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>;
    case "self":
      return <svg {...base}><path d="M8 13.5S2.5 10.2 2.5 6.3A2.8 2.8 0 0 1 8 5a2.8 2.8 0 0 1 5.5 1.3c0 3.9-5.5 7.2-5.5 7.2Z" /></svg>;
    case "summary":
      return <svg {...base}><path d="M3 4h10M3 7h10M3 10h6M3 13h4" /></svg>;
    default:
      return <svg {...base}><path d="M2.5 9.5 4 3.5h8l1.5 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1Z" /><path d="M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2" /></svg>;
  }
}
