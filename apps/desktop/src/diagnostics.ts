import { error as logError, info as logInfo, warn as logWarn } from "@tauri-apps/plugin-log";
import { useStage } from "./state/stage";

/**
 * Forward webview errors, warnings and page-visibility changes to the Rust log
 * (stdout + log file). Release builds have no devtools, so this is how we see
 * what the stage is doing in production.
 */
export function installDiagnostics(): void {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const fmt = (args: unknown[]) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.warn = (...a: unknown[]) => { origWarn(...a); void logWarn(`[web] ${fmt(a)}`); };
  console.error = (...a: unknown[]) => { origError(...a); void logError(`[web] ${fmt(a)}`); };
  window.addEventListener("error", (e) => void logError(`[web] uncaught: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => void logError(`[web] unhandled rejection: ${fmt([e.reason])}`));
  document.addEventListener("visibilitychange", () => void logInfo(`[web] visibility → ${document.visibilityState}`));
  void logInfo(`[web] boot visibility=${document.visibilityState} dpr=${devicePixelRatio}`);
  // Heartbeat (VITE_DIAG=1 builds only): rendered fps + tier every 5 s (fps 0 for long = rAF not firing).
  if (!import.meta.env.VITE_DIAG) return;
  let lastBeat = 0;
  let rafTicks = 0;
  const countRaf = () => { rafTicks++; requestAnimationFrame(countRaf); };
  requestAnimationFrame(countRaf);
  setInterval(() => {
    const s = useStage.getState();
    const now = performance.now();
    const rafHz = lastBeat ? Math.round((rafTicks * 1000) / (now - lastBeat)) : 0;
    rafTicks = 0;
    lastBeat = now;
    void logInfo(`[web] heartbeat render=${s.fps}fps tier=${s.tier} rAF=${rafHz}Hz state=${s.state} visibility=${document.visibilityState}`);
  }, 5000);
}
