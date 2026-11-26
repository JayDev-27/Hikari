import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProviderStatus } from "@hikari/protocol";
import { inTauri, onCore, useCoreStatus } from "../ui/coreBridge";
import { IconCloud, IconGauge, IconGear, IconInfo, IconWarn } from "./controls";
import { DEFAULT_SETTINGS, normalizeSettings, recordStatus, type HikariSettings, type MemoryStats, type StatusTable } from "./model";
import { loadSettings, memoryStats, preview, saveSettings } from "./native";
import { General } from "./General";
import { Providers } from "./Providers";
import { Performance } from "./Performance";
import { About } from "./About";
import "../ui/tokens.css";
import "./settings.css";

/**
 * Settings window: General · Providers · Performance · About, in a source-list sidebar like System Settings.
 * Changes save as they're made (settings.json via Rust; keys in the Keychain), there's no Save button.
 */

export type PageId = "general" | "providers" | "performance" | "about";
const PAGES: { id: PageId; title: string; icon: ReactNode; tint: string }[] = [
  { id: "general", title: "General", icon: <IconGear />, tint: "#8e8e93" },
  { id: "providers", title: "Providers", icon: <IconCloud />, tint: "#0a84ff" },
  { id: "performance", title: "Performance", icon: <IconGauge />, tint: "#30b158" },
  { id: "about", title: "About", icon: <IconInfo />, tint: "#6b7be6" },
];

/** macOS app window: the title bar is an overlay, so the sidebar runs up behind the traffic lights. */
const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const initialPage = (): PageId => {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "").get("page");
  return PAGES.some((p) => p.id === q) ? (q as PageId) : "general";
};

/** Sample router traffic for the browser preview (the real thing arrives as `provider.status` from the core). */
const SAMPLE_STATUS: ProviderStatus[] = [
  { capability: "llm", provider: "groq", model: "qwen/qwen3.8-27b", status: "benched", reason: "Rate limited (429), retry in 40 s", latencyMs: 0 },
  { capability: "llm", provider: "local", model: "qwen3.5:4b-q4_K_M", status: "active", latencyMs: 640 },
  { capability: "stt", provider: "local", model: "hima-asr-mlx-8bit", status: "active", latencyMs: 182 },
  { capability: "tts", provider: "local", model: "hima-tts-nano-hi", status: "ok", latencyMs: 214 },
  { capability: "embed", provider: "local", model: "embeddinggemma-300m", status: "ok", latencyMs: 9 },
];

export interface Toast { id: number; kind: "ok" | "error"; text: string }

export function Settings() {
  const [page, setPage] = useState<PageId>(initialPage);
  const [settings, setSettings] = useState<HikariSettings | null>(null);
  const [statuses, setStatuses] = useState<StatusTable>(() => (preview() ? SAMPLE_STATUS.reduce(recordStatus, {}) : {}));
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const core = useCoreStatus();
  const connected = core.connected || preview();
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<HikariSettings | null>(null);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), kind === "error" ? 8000 : 3500);
  }, []);

  useEffect(() => {
    let live = true;
    loadSettings()
      .then((raw) => live && setSettings(normalizeSettings(raw)))
      .catch((e) => {
        if (!live) return;
        setSettings(DEFAULT_SETTINGS);
        toast("error", `Couldn't read your settings: ${String(e)}`);
      });
    return () => {
      live = false;
    };
  }, [toast]);

  useEffect(() => onCore(["provider.status"], (e) => setStatuses((t) => recordStatus(t, e.payload as ProviderStatus))), []);

  // Memory: once for the profile's Auto choice, then every 2 s while the Performance page is on screen.
  useEffect(() => {
    let live = true;
    const read = () => {
      if (document.visibilityState === "hidden") return;
      memoryStats().then((m) => live && setMemory(m)).catch(() => {});
    };
    read();
    if (page !== "performance") return () => void (live = false);
    const timer = window.setInterval(read, 2000);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [page]);

  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const next = pending.current;
    pending.current = null;
    if (next) saveSettings(next).catch((e) => toast("error", `Couldn't save settings: ${String(e)}`));
  }, [toast]);

  /** Apply now, write shortly after (a burst of changes is one write). */
  const update = useCallback((next: HikariSettings) => {
    setSettings(next);
    pending.current = next;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 300);
  }, [flush]);
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [flush]);

  // ⌘1–⌘4 switch sections.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1;
      if ((e.metaKey || e.ctrlKey) && PAGES[i]) {
        e.preventDefault();
        setPage(PAGES[i].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = PAGES.find((p) => p.id === page)!;
  return (
    <div className={`se hk${unifiedTitlebar() ? " se-unified" : ""}`}>
      {unifiedTitlebar() && <div className="se-titlebar" data-tauri-drag-region />}
      <aside className="se-sidebar">
        <nav className="se-nav" aria-label="Settings sections">
          {PAGES.map((p, i) => (
            <button key={p.id} type="button" className={`se-nav-item${p.id === page ? " sel" : ""}`}
              aria-current={p.id === page ? "page" : undefined} title={`${p.title} (⌘${i + 1})`} onClick={() => setPage(p.id)}>
              <span className="se-nav-icon" style={{ background: p.tint }}>{p.icon}</span>
              {p.title}
            </button>
          ))}
        </nav>
        {preview() && <p className="se-preview-note">Browser preview: sample data</p>}
      </aside>

      <main className="se-main">
        <header className="se-head" data-tauri-drag-region>
          <h1 data-tauri-drag-region>{current.title}</h1>
          {(page === "providers" || page === "about") && (
            <span className={`se-core${connected ? " on" : ""}`} title={core.reason}>
              <span className="se-dot" />{connected ? "Core connected" : "Core offline"}
            </span>
          )}
        </header>
        <div className="se-page" key={page}>
          {!settings ? null : page === "general" ? (
            <General settings={settings} onChange={update} />
          ) : page === "providers" ? (
            <Providers settings={settings} onChange={update} statuses={statuses} connected={connected} toast={toast} />
          ) : page === "performance" ? (
            <Performance settings={settings} onChange={update} memory={memory} />
          ) : (
            <About />
          )}
        </div>
      </main>

      <div className="se-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`se-toast ${t.kind}`}>
            {t.kind === "error" && <IconWarn />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
