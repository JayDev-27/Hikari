import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../ui/coreBridge";
import type { MemoryStats } from "./model";

/**
 * The Settings window's native calls (src-tauri: secrets.rs, settings_store.rs, sysmem.rs, the autostart plugin).
 * In a browser preview there is no Tauri, so DEV builds get sample data held in memory: never localStorage, and
 * never a real key.
 */

export interface KeyPresence {
  provider: string;
  saved: boolean;
  last4?: string;
}

export const preview = () => !inTauri() && import.meta.env.DEV;

const sample = {
  settings: null as unknown,
  keys: new Map<string, string>([["groq", "7Q2f"]]),
  autostart: false,
  appBytes: 168 * 2 ** 20,
};

function unavailable(): never {
  throw new Error("Only available in the Hikari app.");
}

export async function loadSettings(): Promise<unknown> {
  if (inTauri()) return invoke<unknown>("settings_load");
  return sample.settings;
}

export async function saveSettings(settings: unknown): Promise<void> {
  if (inTauri()) return invoke("settings_save", { settings });
  if (!preview()) unavailable();
  sample.settings = structuredClone(settings);
}

export async function keyStatus(providers: string[]): Promise<KeyPresence[]> {
  if (inTauri()) return invoke<KeyPresence[]>("secret_status", { providers });
  if (!preview()) unavailable();
  return providers.map((p) => (sample.keys.has(p) ? { provider: p, saved: true, last4: sample.keys.get(p) } : { provider: p, saved: false }));
}

export async function setKey(provider: string, key: string): Promise<KeyPresence> {
  if (inTauri()) return invoke<KeyPresence>("secret_set", { provider, key });
  if (!preview()) unavailable();
  const last4 = key.length >= 12 ? key.slice(-4) : undefined;
  sample.keys.set(provider, last4 ?? "");
  return { provider, saved: true, last4 };
}

export async function deleteKey(provider: string): Promise<void> {
  if (inTauri()) return invoke("secret_delete", { provider });
  if (!preview()) unavailable();
  sample.keys.delete(provider);
}

export async function memoryStats(): Promise<MemoryStats> {
  if (inTauri()) return invoke<MemoryStats>("memory_stats");
  if (!preview()) unavailable();
  // A 16 GB Mac with a little drift, so the meters visibly refresh in the preview.
  sample.appBytes = Math.max(120 * 2 ** 20, sample.appBytes + (Math.random() - 0.5) * 12 * 2 ** 20);
  return {
    totalBytes: 16 * 2 ** 30,
    usedBytes: 10.8 * 2 ** 30 + Math.random() * 0.2 * 2 ** 30,
    appBytes: sample.appBytes,
    helperBytes: 412 * 2 ** 20,
    helperCount: 3,
  };
}

/** Launch at login (tauri-plugin-autostart, a LaunchAgent). `null` if it can't be read here. */
export async function getAutostart(): Promise<boolean | null> {
  if (inTauri()) {
    const { isEnabled } = await import("@tauri-apps/plugin-autostart");
    return isEnabled();
  }
  return preview() ? sample.autostart : null;
}

export async function setAutostart(on: boolean): Promise<void> {
  if (inTauri()) {
    const { enable, disable } = await import("@tauri-apps/plugin-autostart");
    return on ? enable() : disable();
  }
  if (!preview()) unavailable();
  sample.autostart = on;
}

export async function appInfo(): Promise<{ version: string; tauri: string }> {
  if (inTauri()) {
    const { getVersion, getTauriVersion } = await import("@tauri-apps/api/app");
    const [version, tauri] = await Promise.all([getVersion(), getTauriVersion()]);
    return { version, tauri };
  }
  return { version: "0.1.0 (preview)", tauri: "—" };
}

export async function openExternal(url: string): Promise<void> {
  if (inTauri()) {
    const { open } = await import("@tauri-apps/plugin-shell");
    return open(url);
  }
  window.open(url, "_blank", "noopener");
}

/** Reopen the first-run welcome from its first step (onboarding.rs). */
export async function openWelcome(): Promise<void> {
  if (inTauri()) return invoke("onboarding_open");
  window.open("#/onboarding", "_blank", "noopener");
}
