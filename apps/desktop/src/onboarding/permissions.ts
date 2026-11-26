import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../ui/coreBridge";
import type { PermissionId, PermissionReport, PermissionStatus } from "./steps";

/**
 * TCC permissions via Rust (src-tauri/src/permissions.rs). In a browser preview there is no
 * Tauri, so a DEV stand-in answers instead: "Allow…" grants after a moment (as if the user
 * clicked Allow) and "Open Settings" grants a little later (as if they flipped the toggle),
 * so the live updates can be seen. Drive it from the console: `hikariPermissions.set("microphone", "denied")`.
 */
const mock: PermissionReport = { microphone: "notDetermined", accessibility: "notDetermined", screenRecording: "denied" };

if (typeof window !== "undefined" && !inTauri() && import.meta.env.DEV) {
  (window as unknown as { hikariPermissions: unknown }).hikariPermissions = {
    set: (id: PermissionId, s: PermissionStatus) => (mock[id] = s),
    get: () => ({ ...mock }),
  };
}

export async function fetchPermissions(): Promise<PermissionReport> {
  if (!inTauri()) return { ...mock };
  return invoke<PermissionReport>("permissions_status");
}

export async function requestPermission(id: PermissionId): Promise<void> {
  if (!inTauri()) {
    const was = mock[id];
    window.setTimeout(() => (mock[id] = was === "notDetermined" && id === "microphone" ? "granted" : "denied"), 700);
    if (was !== "notDetermined" || id !== "microphone") window.setTimeout(() => (mock[id] = "granted"), 3500);
    return;
  }
  await invoke("permission_request", { permission: id });
}

export async function openPermissionSettings(id: PermissionId): Promise<void> {
  if (!inTauri()) {
    window.setTimeout(() => (mock[id] = "granted"), 2500);
    return;
  }
  await invoke("permission_open_settings", { permission: id });
}

export async function relaunchApp(): Promise<void> {
  if (inTauri()) await invoke("relaunch_app");
}

/**
 * Live permission statuses. Polls every `intervalMs` while `live` (the permissions step is
 * showing and the window is visible), and on window focus, which is when the user comes
 * back from System Settings.
 */
export function usePermissions(live: boolean, intervalMs = 1000): { report: PermissionReport | null; refresh: () => void } {
  const [report, setReport] = useState<PermissionReport | null>(null);
  const refresh = useCallback(() => {
    void fetchPermissions()
      .then((r) => setReport((prev) => (prev && sameReport(prev, r) ? prev : r)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const first = window.setTimeout(refresh, 0);
    window.addEventListener("focus", refresh);
    let timer: number | undefined;
    if (live) timer = window.setInterval(() => document.visibilityState !== "hidden" && refresh(), intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [live, intervalMs, refresh]);

  return { report, refresh };
}

const sameReport = (a: PermissionReport, b: PermissionReport) =>
  a.microphone === b.microphone && a.accessibility === b.accessibility && a.screenRecording === b.screenRecording;
