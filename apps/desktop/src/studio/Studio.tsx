import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { ACTIVE_KEY, activeCharacterId, setActiveCharacterId, type CharacterPack } from "../avatar/characters";
import { deleteUserPack, importModel, listPacks, type ImportResult } from "../avatar/packs";
import { CharacterPreview, type PreviewHandle } from "./CharacterPreview";
import { Subscriptions } from "../util/subscriptions";
import { characterHue, groupPacks, initials, languageName, moveLabel, parseModelInfo, personaSection, previewMoves, rendererLabel, type ModelInfo } from "./format";
import { IconCheck, IconDoc, IconFolder, IconLink, IconPlay, IconPlus, IconSearch, IconTrash, IconTray, IconWarn } from "./icons";
import "../ui/tokens.css";
import "./studio.css";

/** First paragraph of the persona's "## Identity" section (or of the file). */
export function personaSummary(md: string): string {
  const m = md.match(/##\s*Identity\s*\n+([\s\S]*?)(\n##|$)/);
  const text = (m ? m[1] : md.replace(/^#.*$/m, "")).trim();
  return text.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
}

type Toast = { id: number; kind: "ok" | "error"; title: string; detail?: string[] };
const inTauri = () => "__TAURI_INTERNALS__" in window;
/** macOS app window: the title bar is an overlay, so the sidebar runs up behind the traffic lights. */
const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const hueStyle = (p: CharacterPack) => ({ "--hue": characterHue(p.id) }) as CSSProperties;

export function Studio() {
  const [packs, setPacks] = useState<CharacterPack[]>([]);
  const [selected, setSelected] = useState<string>(activeCharacterId());
  const [active, setActive] = useState<string>(activeCharacterId());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CharacterPack | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setPacks(await listPacks()), []);
  useEffect(() => {
    let live = true;
    void listPacks().then((p) => live && setPacks(p));
    const syncActive = (event: StorageEvent) => {
      if (event.key === ACTIVE_KEY && event.newValue) setActive(event.newValue);
    };
    window.addEventListener("storage", syncActive);
    return () => {
      window.removeEventListener("storage", syncActive);
      live = false;
    };
  }, []);

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === "error" ? 9000 : 4500);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? packs.filter((p) => p.displayName.toLowerCase().includes(q) || p.id.includes(q)) : packs;
  }, [packs, query]);
  const groups = useMemo(() => groupPacks(visible), [visible]);
  const order = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const pack = packs.find((p) => p.id === selected) ?? order[0] ?? packs[0];

  const activate = async (p: CharacterPack) => {
    setActiveCharacterId(p.id);
    setActive(p.id);
    if (inTauri()) await emitTo("stage", "character://select", p.id);
    toast({ kind: "ok", title: `${p.displayName} is now on your desktop.` });
  };

  const doImport = useCallback(
    async (src: string, slot?: CharacterPack) => {
      setBusy(true);
      try {
        const r: ImportResult = await importModel(src, slot);
        await refresh();
        setSelected(r.id);
        const detail = [...r.warnings];
        if (r.license) detail.push(`Licence: ${r.license.terms}`);
        toast({ kind: "ok", title: `Imported ${rendererLabel[r.renderer]} model as “${r.id}”.`, detail });
        // A slot that's currently active gets its new model right away.
        if (r.id === activeCharacterId()) await emitTo("stage", "character://select", r.id);
      } catch (e) {
        toast({ kind: "error", title: "Couldn't import that model.", detail: [String(e)] });
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  // Drag & drop onto the window: import into the selected slot, else as a new character.
  useEffect(() => {
    if (!inTauri()) return;
    const subs = new Subscriptions();
    subs.add(
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
        else if (e.payload.type === "leave") setDragging(false);
        else if (e.payload.type === "drop") {
          setDragging(false);
          const path = e.payload.paths[0];
          if (path) void doImport(path, pack?.importSlot || pack?.imported ? pack : undefined);
        }
      }),
    );
    return () => subs.dispose();
  }, [doImport, pack]);

  const pickFile = async (slot?: CharacterPack) => {
    if (!inTauri()) return toast({ kind: "error", title: "Importing needs the Hikari app." });
    const f = await open({ multiple: false, filters: [{ name: "Character model", extensions: ["vrm", "zip", "json"] }] });
    if (typeof f === "string") await doImport(f, slot);
  };
  const pickFolder = async (slot?: CharacterPack) => {
    if (!inTauri()) return toast({ kind: "error", title: "Importing needs the Hikari app." });
    const f = await open({ directory: true, multiple: false });
    if (typeof f === "string") await doImport(f, slot);
  };

  const remove = async (p: CharacterPack) => {
    setConfirmDelete(null);
    await deleteUserPack(p.id);
    await refresh();
    if (p.id === activeCharacterId()) await emitTo("stage", "character://select", p.id);
    toast({ kind: "ok", title: `Removed the imported model for ${p.displayName}.` });
  };

  // Keyboard: ↑/↓ move through the list, ⌘F searches, ⌘↩ uses the selected character.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && pack?.modelUrl && pack.id !== active) {
        e.preventDefault();
        void activate(pack);
        return;
      }
      if (e.key === "Escape" && confirmDelete) setConfirmDelete(null);
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea");
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (!typing || e.target === search.current) && order.length) {
        e.preventDefault();
        const i = Math.max(0, order.findIndex((p) => p.id === pack?.id));
        const next = order[Math.min(order.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
        setSelected(next.id);
        document.getElementById(`st-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={`st hk${dragging ? " st-dragging" : ""}${unifiedTitlebar() ? " st-unified" : ""}`}>
      {unifiedTitlebar() && <div className="st-titlebar" data-tauri-drag-region />}
      <Sidebar
        groups={groups}
        selected={pack?.id}
        active={active}
        query={query}
        onQuery={setQuery}
        onSelect={setSelected}
        searchRef={search}
        busy={busy}
        onImportFile={() => void pickFile()}
        onImportFolder={() => void pickFolder()}
      />

      <main className="st-main">
        {pack ? (
          <Detail
            key={pack.id}
            pack={pack}
            isActive={pack.id === active}
            busy={busy}
            onUse={() => void activate(pack)}
            onImportFile={() => void pickFile(pack)}
            onImportFolder={() => void pickFolder(pack)}
            onDelete={() => setConfirmDelete(pack)}
          />
        ) : (
          <div className="st-empty">
            <p className="st-empty-title">No characters match “{query}”.</p>
            <button className="st-btn" onClick={() => setQuery("")}>Clear Search</button>
          </div>
        )}
      </main>

      <div className="st-toasts" role="status" aria-live="polite">
        {busy && <div className="st-toast"><span className="st-spinner" />Importing…</div>}
        {toasts.map((t) => (
          <div key={t.id} className={`st-toast ${t.kind}`}>
            <span className="st-toast-icon">{t.kind === "ok" ? <IconCheck /> : <IconWarn />}</span>
            <div>
              <p>{t.title}</p>
              {t.detail?.map((d) => <p key={d} className="st-toast-detail">{d}</p>)}
            </div>
          </div>
        ))}
      </div>

      {dragging && (
        <div className="st-drop" aria-hidden="true">
          <div className="st-drop-card">
            <IconTray />
            <p className="st-drop-title">Drop to Import</p>
            <p className="st-drop-sub">
              {pack?.importSlot || pack?.imported ? `Replaces the model for ${pack.displayName}` : "Adds a new character"} · Live2D folder, .zip or .vrm
            </p>
          </div>
        </div>
      )}

      {confirmDelete && (
        <Sheet onDismiss={() => setConfirmDelete(null)}>
          <div className="st-sheet-icon"><IconTrash /></div>
          <h2>Delete the imported model for “{confirmDelete.displayName}”?</h2>
          <p>The model files are removed from Hikari's data folder. {confirmDelete.importSlot ? "The character stays, ready for another model." : ""}</p>
          <div className="st-sheet-actions">
            <button className="st-btn" autoFocus onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="st-btn st-btn-danger" onClick={() => void remove(confirmDelete)}>Delete</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The character's portrait (or, for a pack without one, a monogram on their tint). */
function Avatar({ pack, size = 32 }: { pack: CharacterPack; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`st-avatar${pack.avatarUrl && !broken ? " has-img" : ""}`} style={{ ...hueStyle(pack), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {pack.avatarUrl && !broken ? <img src={pack.avatarUrl} alt="" draggable={false} onError={() => setBroken(true)} /> : initials(pack.displayName)}
    </span>
  );
}

function Sidebar({ groups, selected, active, query, onQuery, onSelect, searchRef, busy, onImportFile, onImportFolder }: {
  groups: { title: string; items: CharacterPack[] }[];
  selected?: string;
  active: string;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onImportFile: () => void;
  onImportFolder: () => void;
}) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <aside className="st-sidebar">
      <label className="st-search">
        <IconSearch />
        <input ref={searchRef} type="search" placeholder="Search" value={query}
          onChange={(e) => onQuery(e.target.value)} aria-label="Search characters" spellCheck={false} />
      </label>

      <nav className="st-list" role="listbox" aria-label="Characters">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 className="st-group">{g.title}</h3>
            {g.items.map((p) => (
              <button key={p.id} id={`st-row-${p.id}`} role="option" aria-selected={p.id === selected}
                className={`st-row${p.id === selected ? " sel" : ""}`} onClick={() => onSelect(p.id)}>
                <Avatar pack={p} />
                <span className="st-row-text">
                  <span className="st-row-name">{p.displayName}</span>
                  <span className="st-row-sub">
                    {p.modelUrl ? `${rendererLabel[p.renderer]} · ${languageName(p.defaultLanguage)}` : "Import a model to use"}
                  </span>
                </span>
                {p.id === active && <span className="st-live" title="On your desktop" aria-label="Active" />}
              </button>
            ))}
          </section>
        ))}
      </nav>

      <div className="st-sidebar-foot">
        <button className="st-btn st-btn-plain" disabled={busy} aria-haspopup="menu" aria-expanded={menu}
          onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}>
          <IconPlus /> Import Character
        </button>
        {menu && (
          <div className="st-menu" role="menu">
            <button role="menuitem" onClick={onImportFile}><IconDoc /> Model File…<kbd>.vrm .zip</kbd></button>
            <button role="menuitem" onClick={onImportFolder}><IconFolder /> Live2D Folder…</button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Detail({ pack, isActive, busy, onUse, onImportFile, onImportFolder, onDelete }: {
  pack: CharacterPack;
  isActive: boolean;
  busy: boolean;
  onUse: () => void;
  onImportFile: () => void;
  onImportFolder: () => void;
  onDelete: () => void;
}) {
  const preview = useRef<PreviewHandle>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("about");
  const canPreview = (pack.renderer === "live2d" || pack.renderer === "iki") && pack.modelUrl;
  // The moves come from the model itself (its parameters, motions and the gestures its rig resolves), not a fixed list.
  const [model, setModel] = useState<ModelInfo | null>(null);
  useEffect(() => {
    if (!canPreview || !pack.modelUrl) return;
    let live = true;
    void fetch(pack.modelUrl).then((r) => r.text()).then((text) => live && setModel(parseModelInfo(pack.renderer, text)))
      .catch(() => live && setModel({}));
    return () => { live = false; };
  }, [canPreview, pack.modelUrl, pack.renderer]);
  const moves = useMemo(() => previewMoves(pack, model), [pack, model]);
  const pollTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(pollTimer.current), []);
  const identity = personaSummary(pack.personaText ?? "");
  const speech = personaSection(pack.personaText ?? "", "Speech style");
  const meta = [pack.modelUrl ? rendererLabel[pack.renderer] : null, languageName(pack.defaultLanguage), pack.source === "user" ? "Imported" : "Built-in"].filter(Boolean);
  const canImport = pack.importSlot || pack.imported;

  // The chip stays lit for as long as the move really plays.
  const play = (m: string) => {
    preview.current?.play(m);
    setPlaying(m);
    window.clearTimeout(pollTimer.current);
    // Lit for at least ~0.5 s (a short move still registers), then until the avatar is idle again.
    let polls = 0;
    const poll = () => {
      if (++polls < 4 || preview.current?.busy()) pollTimer.current = window.setTimeout(poll, 150);
      else setPlaying(null);
    };
    pollTimer.current = window.setTimeout(poll, 150);
  };
  // An Iki signature runs to its end (the rig ignores other moves meanwhile), so the other chips wait for it.
  const locked = pack.renderer === "iki" && !!playing && moves.some((m) => m.id === playing && m.signature);

  return (
    <div className="st-detail" style={hueStyle(pack)}>
      <div className="st-stage-col">
        <div className={`st-stage${canPreview ? "" : " empty"}`}>
          <div className="st-stage-glow" />
          <div className="st-stage-floor" />
          {canPreview ? (
            <>
              <CharacterPreview ref={preview} pack={pack} onState={setState} />
              {state === "loading" && <div className="st-stage-loading"><span className="st-spinner" /></div>}
            </>
          ) : (
            <div className="st-stage-placeholder">
              <Avatar pack={pack} size={88} />
              <p>{pack.modelUrl ? `${rendererLabel[pack.renderer]} preview opens on the desktop stage.` : "No model yet"}</p>
            </div>
          )}
        </div>
      </div>

      <div className="st-info">
        <header className="st-head">
          <h1>{pack.displayName}</h1>
          <p className="st-meta">{meta.join("  ·  ")}</p>
          <div className="st-cta">
            {pack.modelUrl ? (
              isActive ? (
                <span className="st-active-pill"><IconCheck /> On Your Desktop</span>
              ) : (
                <button className="st-btn st-btn-primary" onClick={onUse}>Use Character<kbd>⌘↩</kbd></button>
              )
            ) : (
              <button className="st-btn st-btn-primary" disabled={busy} onClick={onImportFile}>Import Model…</button>
            )}
            {canImport && pack.modelUrl && (
              <>
                <button className="st-btn st-icon-btn" disabled={busy} onClick={onImportFile} title={pack.imported ? "Replace with a model file…" : "Import a model file…"} aria-label="Import a model file"><IconDoc /></button>
                <button className="st-btn st-icon-btn" disabled={busy} onClick={onImportFolder} title={pack.imported ? "Replace with a Live2D folder…" : "Import a Live2D folder…"} aria-label="Import a Live2D folder"><IconFolder /></button>
              </>
            )}
            {pack.imported && (
              <button className="st-btn st-icon-btn st-btn-danger-plain" disabled={busy} onClick={onDelete} title="Delete the imported model" aria-label="Delete the imported model"><IconTrash /></button>
            )}
          </div>
        </header>

        {canPreview && (
          <section className="st-moves-block">
            <h2 className="st-group-title">Moves</h2>
            <div className="st-moves" role="group" aria-label="Preview moves">
              {moves.map((m) => (
                <button key={m.id} className={`st-chip${m.signature ? " sig" : ""}${playing === m.id ? " on" : ""}`}
                  disabled={state !== "ready" || (locked && playing !== m.id)} onClick={() => play(m.id)}
                  title={m.signature ? "Signature move" : undefined}>
                  <IconPlay /> {m.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {!pack.modelUrl && (
          <div className="st-card st-callout">
            <p>Bring your own model for {pack.displayName}: a Live2D folder or .zip, or a .vrm, that you bought, commissioned or made. Drag it onto this window or choose a file.</p>
            <p className="st-fine">Ripped or fan-extracted models aren't allowed.</p>
            <div className="st-actions-row">
              <button className="st-btn" disabled={busy} onClick={onImportFile}><IconDoc /> Choose File…</button>
              <button className="st-btn" disabled={busy} onClick={onImportFolder}><IconFolder /> Choose Folder…</button>
            </div>
          </div>
        )}

        <Segmented id={`st-${pack.id}`} value={tab} onChange={setTab} render={(t) => {
          if (t === "about") return identity || speech ? (
            <>
              {identity && <p className="st-prose">{identity}</p>}
              {speech && <p className="st-prose st-prose-sub">{speech}</p>}
            </>
          ) : <p className="st-prose st-prose-sub">No persona yet.</p>;
          if (t === "details") return (
            <>
              <Row label="Renderer" value={pack.modelUrl ? rendererLabel[pack.renderer] : "—"} />
              <Row label="Language" value={languageName(pack.defaultLanguage)} />
              <Row label="Voice" value={pack.voice ? `${pack.voice.voiceId ?? "Default"}` : "—"} hint={pack.voice?.engine} />
              <Row label="Signature moves" value={pack.signatureMotions?.length ? pack.signatureMotions.map(moveLabel).join(", ") : "—"} />
              <Row label="Source" value={pack.source === "user" ? "Imported to Hikari's data folder" : "Built into Hikari"} />
            </>
          );
          return (
            <div className="st-licence">
              <p className="st-licence-source">{pack.license.source}</p>
              <p>{pack.license.terms}</p>
              {pack.license.credit && <p className="st-fine">{pack.license.credit}</p>}
              {pack.license.url && <p className="st-url"><IconLink /> <span>{pack.license.url}</span></p>}
            </div>
          );
        }} />
      </div>
    </div>
  );
}

type Tab = "about" | "details" | "licence";
const TABS: { id: Tab; label: string }[] = [{ id: "about", label: "About" }, { id: "details", label: "Details" }, { id: "licence", label: "Licence" }];

/**
 * macOS-style segmented control and its panel: the selection pill slides to the chosen segment, and the new content
 * slides in from the side it travelled toward while the old content fades out the other way.
 */
function Segmented({ id, value, onChange, render }: {
  id: string;
  value: Tab;
  onChange: (t: Tab) => void;
  render: (t: Tab) => ReactNode;
}) {
  const index = TABS.findIndex((t) => t.id === value);
  // The panel leaving (kept until its fade ends) and which way the selection moved.
  const [leaving, setLeaving] = useState<{ tab: Tab; dir: "left" | "right"; key: number } | null>(null);
  const [dir, setDir] = useState<"left" | "right" | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const switches = useRef(0);
  const select = (next: Tab, focus = false) => {
    const to = TABS.findIndex((t) => t.id === next);
    if (focus) buttons.current[to]?.focus();
    if (next === value) return;
    const d = to > index ? "right" : "left";
    setDir(d);
    setLeaving({ tab: value, dir: d, key: ++switches.current });
    onChange(next);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = step ? (index + step + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(TABS[to].id, true);
  };
  return (
    <>
      <div className="st-tabs" role="tablist" aria-label="Character information" onKeyDown={onKey} style={{ "--i": index } as CSSProperties}>
        <span className="st-tabs-pill" aria-hidden="true" />
        {TABS.map((t, i) => (
          <button key={t.id} ref={(el) => { buttons.current[i] = el; }} role="tab" id={`${id}-tab-${t.id}`}
            aria-selected={value === t.id} aria-controls={`${id}-panel`} tabIndex={value === t.id ? 0 : -1}
            className={value === t.id ? "on" : ""} onClick={() => select(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="st-card st-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`}>
        <div className="st-panel-stack">
          {leaving && (
            <div key={`out-${leaving.key}`} className={`st-panel-page out to-${leaving.dir === "right" ? "left" : "right"}`} aria-hidden="true"
              onAnimationEnd={(e) => e.target === e.currentTarget && setLeaving((l) => (l?.key === leaving.key ? null : l))}>
              {render(leaving.tab)}
            </div>
          )}
          <div key={value} className={`st-panel-page${dir ? ` in from-${dir}` : ""}`}>{render(value)}</div>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="st-kv">
      <span className="st-k">{label}</span>
      <span className="st-v">{value}{hint && <span className="st-hint"> {hint}</span>}</span>
    </div>
  );
}

function Sheet({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="st-sheet-backdrop" onClick={onDismiss}>
      <div className="st-sheet" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
