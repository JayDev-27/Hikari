import { useCallback, useEffect, useState } from "react";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { activeCharacterId, setActiveCharacterId, type CharacterPack } from "../avatar/characters";
import { deleteUserPack, importModel, listPacks, type ImportResult } from "../avatar/packs";
import { Subscriptions } from "../util/subscriptions";

/** First paragraph of the persona's "## Identity" section (or of the file). */
export function personaSummary(md: string): string {
  const m = md.match(/##\s*Identity\s*\n+([\s\S]*?)(\n##|$)/);
  const text = (m ? m[1] : md.replace(/^#.*$/m, "")).trim();
  return text.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
}

type Notice = { kind: "ok" | "error"; text: string; warnings?: string[]; license?: CharacterPack["license"] };

export function Studio() {
  const [packs, setPacks] = useState<CharacterPack[]>([]);
  const [selected, setSelected] = useState<string>(activeCharacterId());
  const [active, setActive] = useState<string>(activeCharacterId());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState(false);

  const refresh = useCallback(async () => setPacks(await listPacks()), []);
  useEffect(() => {
    let live = true;
    void listPacks().then((p) => live && setPacks(p));
    return () => {
      live = false;
    };
  }, []);

  const pack = packs.find((p) => p.id === selected) ?? packs[0];

  const use = async (p: CharacterPack) => {
    setActiveCharacterId(p.id);
    setActive(p.id);
    await emitTo("stage", "character://select", p.id);
  };

  const doImport = useCallback(
    async (src: string, slot?: CharacterPack) => {
      setBusy(true);
      setNotice(null);
      try {
        const r: ImportResult = await importModel(src, slot);
        await refresh();
        setSelected(r.id);
        setNotice({
          kind: "ok",
          text: `Imported ${r.renderer === "vrm" ? "VRM" : "Live2D"} model as “${r.id}”.`,
          warnings: r.warnings,
          license: r.license,
        });
        // A slot that's currently active gets its new model right away.
        if (r.id === activeCharacterId()) await emitTo("stage", "character://select", r.id);
      } catch (e) {
        setNotice({ kind: "error", text: String(e) });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // Drag & drop onto the window: import into the selected slot, else as a new character.
  useEffect(() => {
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
    const f = await open({
      multiple: false,
      filters: [{ name: "Character model", extensions: ["vrm", "zip", "json"] }],
    });
    if (typeof f === "string") await doImport(f, slot);
  };
  const pickFolder = async (slot?: CharacterPack) => {
    const f = await open({ directory: true, multiple: false });
    if (typeof f === "string") await doImport(f, slot);
  };

  const remove = async (p: CharacterPack) => {
    if (!confirm(`Delete the imported model for “${p.displayName}”? The files in Hikari's data folder are removed.`)) return;
    await deleteUserPack(p.id);
    await refresh();
    if (p.id === activeCharacterId()) await emitTo("stage", "character://select", p.id);
  };

  return (
    <div className={`studio${dragging ? " dragging" : ""}`}>
      <aside className="studio-list">
        <h1>Characters</h1>
        {packs.map((p) => (
          <button key={p.id} className={`pack${p.id === pack?.id ? " sel" : ""}`} onClick={() => setSelected(p.id)}>
            <span className="name">
              {p.displayName}
              {p.id === active && <span className="dot" title="Active" />}
            </span>
            <span className="badges">
              {p.modelUrl ? <span className="badge">{p.renderer === "vrm" ? "VRM" : "Live2D"}</span> : <span className="badge warn">needs model</span>}
              {p.imported && <span className="badge">imported</span>}
            </span>
          </button>
        ))}
        <div className="list-actions">
          <button disabled={busy} onClick={() => void pickFile()}>Import model file…</button>
          <button disabled={busy} onClick={() => void pickFolder()}>Import Live2D folder…</button>
        </div>
      </aside>

      <main className="studio-detail">
        {pack && (
          <>
            <header>
              <h2>{pack.displayName}</h2>
              <div className="actions">
                {pack.modelUrl && (
                  <button className="primary" disabled={pack.id === active} onClick={() => void use(pack)}>
                    {pack.id === active ? "Active" : "Use this character"}
                  </button>
                )}
                {(pack.importSlot || pack.imported) && (
                  <>
                    <button disabled={busy} onClick={() => void pickFile(pack)}>
                      {pack.imported ? "Replace model file…" : "Import model file…"}
                    </button>
                    <button disabled={busy} onClick={() => void pickFolder(pack)}>
                      {pack.imported ? "Replace from folder…" : "Import Live2D folder…"}
                    </button>
                  </>
                )}
                {pack.imported && (
                  <button className="danger" disabled={busy} onClick={() => void remove(pack)}>
                    Delete import
                  </button>
                )}
              </div>
            </header>

            {!pack.modelUrl && (
              <p className="callout">
                Import your own model for this character: a Live2D (.model3.json folder or .zip) or VRM model you bought,
                commissioned or made. Drag it onto this window, or use the buttons above. Ripped or fan-extracted
                models aren't allowed.
              </p>
            )}

            {pack.personaText && (
              <section>
                <h3>Personality</h3>
                <p>{personaSummary(pack.personaText)}</p>
              </section>
            )}

            <section className="meta">
              <div><span>Default language</span>{pack.defaultLanguage ?? "—"}</div>
              <div><span>Voice</span>{pack.voice ? `${pack.voice.engine}${pack.voice.voiceId ? ` · ${pack.voice.voiceId}` : ""}` : "—"}</div>
              <div><span>Source</span>{pack.source === "user" ? "Imported (app data folder)" : "Built-in"}</div>
            </section>

            <section>
              <h3>Licence</h3>
              <p><strong>{pack.license.source}</strong></p>
              <p>{pack.license.terms}</p>
              {pack.license.credit && <p className="credit">{pack.license.credit}</p>}
              {pack.license.url && <p className="url">{pack.license.url}</p>}
            </section>
          </>
        )}

        {busy && <p className="notice">Importing…</p>}
        {notice && (
          <div className={`notice ${notice.kind}`}>
            <p>{notice.text}</p>
            {notice.warnings?.map((w) => <p key={w} className="warn">⚠︎ {w}</p>)}
            {notice.license && notice.kind === "ok" && <p className="lic">Licence found: {notice.license.terms}</p>}
          </div>
        )}
        {dragging && <div className="drop-hint">Drop to import{pack?.importSlot || pack?.imported ? ` into “${pack.displayName}”` : ""}</div>}
      </main>
    </div>
  );
}
