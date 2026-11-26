import type { MemoryItem } from "@hikari/protocol";

/** Protocol timestamps carry no unit: Python's time.time() gives seconds, JS gives ms. Anything below 1e12 is seconds. */
export function toMs(ts: number | undefined): number | undefined {
  if (ts === undefined || !Number.isFinite(ts) || ts <= 0) return undefined;
  return ts < 1e12 ? ts * 1000 : ts;
}

const DAY = 86_400_000;
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today, 14:05", "Yesterday", "Tuesday", "3 Mar", "3 Mar 2025": the way Finder and Notes date things. */
export function memoryDate(ts: number | undefined, now: number, locale?: string): string {
  const ms = toMs(ts);
  if (ms === undefined) return "";
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY);
  const d = new Date(ms);
  if (days <= 0) return `Today, ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(locale, { weekday: "long" });
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** Importance 0..1 as 0–3 filled bars (0 = no importance reported). */
export function importanceBars(importance: number | undefined): number {
  if (importance === undefined || !Number.isFinite(importance)) return 0;
  const v = Math.max(0, Math.min(1, importance));
  return v >= 0.67 ? 3 : v >= 0.34 ? 2 : 1;
}

export function importanceLabel(importance: number | undefined): string {
  return ["", "Low importance", "Medium importance", "High importance"][importanceBars(importance)];
}

/** Confidence 0..1 → "Sure" / "Fairly sure" / "Unsure", plus the percentage for the tooltip. */
export function confidenceLabel(confidence: number | undefined): { word: string; pct: string; level: "high" | "mid" | "low" } | undefined {
  if (confidence === undefined || !Number.isFinite(confidence)) return undefined;
  const v = Math.max(0, Math.min(1, confidence));
  const pct = `${Math.round(v * 100)}%`;
  if (v >= 0.8) return { word: "Sure", pct, level: "high" };
  if (v >= 0.5) return { word: "Fairly sure", pct, level: "mid" };
  return { word: "Unsure", pct, level: "low" };
}

/** The edited copy sent as `memory.upsert`: new text, `updatedAt` now (in the unit the item already uses). */
export function editedItem(item: MemoryItem, text: string, now: number): MemoryItem {
  const secs = item.createdAt !== undefined && item.createdAt < 1e12;
  return { ...item, text: text.trim(), updatedAt: secs ? Math.floor(now / 1000) : now };
}

/** Header count: "128 memories", "1 memory", or "40+ memories" when the core sends no total. */
export function countLabel(shown: number, total: number | undefined, more: boolean): string {
  const n = total ?? shown;
  const word = n === 1 ? "memory" : "memories";
  return total === undefined && more ? `${shown}+ ${word}` : `${n} ${word}`;
}
