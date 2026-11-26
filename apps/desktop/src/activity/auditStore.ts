import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "../ui/coreBridge";
import type { AuditRecord } from "./model";

/**
 * The audit log's I/O. In the app it is `src-tauri/src/audit.rs` (JSONL in the app data folder, append-only, rotated,
 * timestamps stamped by Rust). In a browser preview there is no Rust, so a dev stand-in keeps records in localStorage
 * and tells other tabs through a BroadcastChannel (Confirm in one tab, Activity in another).
 */

const DEV_KEY = "hikari.audit.dev";
const DEV_MAX = 2000;
const channel = !inTauri() && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("hikari-audit") : undefined;
type DevMsg = { kind: "appended"; record: AuditRecord } | { kind: "cleared" };

function devLoad(): AuditRecord[] {
  try {
    return JSON.parse(localStorage.getItem(DEV_KEY) ?? "[]") as AuditRecord[];
  } catch {
    return [];
  }
}
function devSave(all: AuditRecord[]): void {
  try {
    localStorage.setItem(DEV_KEY, JSON.stringify(all.slice(-DEV_MAX)));
  } catch {
    /* private window / quota: the dev log stays in this tab only */
  }
}
const devListeners = new Set<(m: DevMsg) => void>();
channel?.addEventListener("message", (e: MessageEvent<DevMsg>) => devListeners.forEach((l) => l(e.data)));
const devEmit = (m: DevMsg) => {
  devListeners.forEach((l) => l(m));
  channel?.postMessage(m);
};

/** Append one record. Resolves with the record as written (with its timestamp). Never throws: a failed write is logged. */
export async function appendAudit(record: AuditRecord): Promise<AuditRecord | undefined> {
  if (inTauri()) {
    try {
      return await invoke<AuditRecord>("audit_append", { record });
    } catch (e) {
      console.error("audit: append failed", e);
      return undefined;
    }
  }
  const stamped = { ...record, ts: Date.now() } as AuditRecord;
  const all = devLoad();
  all.push(stamped);
  devSave(all);
  devEmit({ kind: "appended", record: stamped });
  return stamped;
}

/** The newest `limit` records, oldest first. */
export async function readAudit(limit = 1000): Promise<AuditRecord[]> {
  if (inTauri()) return invoke<AuditRecord[]>("audit_read", { limit });
  return devLoad().slice(-limit);
}

/** Live: called with each record as it is written, and with `null` after a clear. Returns unsubscribe. */
export function onAudit(handler: (r: AuditRecord | null) => void): Promise<() => void> {
  if (inTauri()) {
    return Promise.all([
      listen<AuditRecord>("audit://appended", (e) => handler(e.payload)),
      listen("audit://cleared", () => handler(null)),
    ]).then((offs) => () => offs.forEach((f) => f()));
  }
  const l = (m: DevMsg) => handler(m.kind === "appended" ? m.record : null);
  devListeners.add(l);
  return Promise.resolve(() => devListeners.delete(l));
}

/** Show the log folder in Finder. Returns false where that isn't possible (browser preview). */
export async function revealAudit(): Promise<boolean> {
  if (!inTauri()) return false;
  await invoke("audit_reveal");
  return true;
}

/** Save a copy of the whole log (native save dialog in the app, a download in the preview). Resolves with where it went. */
export async function exportAudit(): Promise<string | null> {
  if (inTauri()) return invoke<string | null>("audit_export");
  const text = devLoad().map((r) => JSON.stringify(r)).join("\n") + "\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
  a.download = "hikari-audit.jsonl";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}

/** Delete the log. In the app Rust asks first in a native dialog (the UI can't skip it); resolves true if cleared. */
export async function clearAudit(): Promise<boolean> {
  if (inTauri()) return invoke<boolean>("audit_clear");
  if (!window.confirm("Clear the activity log? This can't be undone.")) return false;
  devSave([{ kind: "cleared", ts: Date.now() }]);
  devEmit({ kind: "cleared" });
  return true;
}
