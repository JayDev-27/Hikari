import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { inTauri, useCoreStatus } from "../ui/coreBridge";
import { Subscriptions } from "../util/subscriptions";
import { clearAudit, exportAudit, onAudit, readAudit, revealAudit } from "./auditStore";
import { TierBadge } from "./TierBadge";
import { DEFAULT_FILTER, STATUS_LABEL, buildTimeline, filterEntries, formatDuration, type AuditRecord, type Entry, type Filter, type TimelineMark } from "./model";
import "../ui/tokens.css";
import "./activity.css";

/**
 * Activity: a read-only timeline of what the agent asked to do, what you decided and what happened. Reads the audit
 * log (`audit.rs`) and follows it live; it never writes (the Confirm window is the log's only writer).
 */

const unifiedTitlebar = () => inTauri() && /Mac/.test(navigator.platform);
const READ_LIMIT = 2000;

const STATUS_FILTERS: { id: Filter["status"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "done", label: "Done" },
  { id: "failed", label: "Failed" },
  { id: "denied", label: "Denied" },
];

export function Activity() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>(DEFAULT_FILTER);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const coreStatus = useCoreStatus();
  const [coreDisconnected, setCoreDisconnected] = useState(false);

  // Once a disconnect has been observed, a missing result cannot be expected from that core session.
  // Keep this latched even if a later connection is established.
  useEffect(() => {
    if (coreStatus.known && !coreStatus.connected) setCoreDisconnected(true);
  }, [coreStatus.known, coreStatus.connected]);

  const reload = useCallback(async () => {
    try {
      setRecords(await readAudit(READ_LIMIT));
    } catch (e) {
      setNote(`Couldn't read the log: ${String(e)}`);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const subs = new Subscriptions();
    let live = true;
    readAudit(READ_LIMIT)
      .then((r) => live && setRecords(r))
      .catch((e) => live && setNote(`Couldn't read the log: ${String(e)}`))
      .finally(() => live && setLoaded(true));
    subs.add(() => (live = false));
    subs.add(onAudit((r) => (r ? setRecords((all) => [...all.slice(-(READ_LIMIT - 1)), r]) : void reload())));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    subs.add(() => window.removeEventListener("keydown", onKey));
    return () => subs.dispose();
  }, [reload]);

  // Running rows show a live elapsed time and become "No result" after the guard's stale window.
  const [now, setNow] = useState(() => Date.now());
  const coreUnavailable = coreDisconnected || (coreStatus.known === true && !coreStatus.connected);
  const { entries, marks } = useMemo(
    () => buildTimeline(records, { now, coreDisconnected: coreUnavailable }),
    [records, now, coreUnavailable],
  );
  const anyRunning = entries.some((e) => e.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const filtering = filter.status !== "all" || filter.tier !== "all" || filter.query.trim() !== "";
  const rows = useMemo(() => mergeRows(shown, filtering ? [] : marks), [shown, marks, filtering]);

  const flash = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((n) => (n === text ? null : n)), 4000);
  };
  const doExport = async () => {
    try {
      const where = await exportAudit();
      if (where) flash(`Exported to ${where}`);
    } catch (e) {
      flash(`Export failed: ${String(e)}`);
    }
  };
  const doReveal = async () => {
    try {
      if (!(await revealAudit())) flash("Show in Finder works in the app (this is a browser preview).");
    } catch (e) {
      flash(`Couldn't open the folder: ${String(e)}`);
    }
  };
  const doClear = async () => {
    try {
      if (await clearAudit()) flash("Log cleared.");
    } catch (e) {
      flash(`Couldn't clear the log: ${String(e)}`);
    }
  };

  return (
    <div className={`ac ac-activity hk${unifiedTitlebar() ? " ac-unified" : ""}`}>
      {unifiedTitlebar() && <div className="ac-titlebar" data-tauri-drag-region />}
      <header className="ac-head" data-tauri-drag-region>
        <div className="ac-head-title" data-tauri-drag-region>
          <h1>Activity</h1>
          <p>What Hikari asked to do, what you decided, and what happened.</p>
        </div>
        <div className="ac-head-actions">
          <button type="button" className="ac-btn ac-btn-plain" onClick={() => void doReveal()} title="Show the log file in Finder">
            Show in Finder
          </button>
          <button type="button" className="ac-btn" onClick={() => void doExport()} disabled={!records.length}>
            Export…
          </button>
          <button type="button" className="ac-btn ac-btn-plain ac-danger" onClick={() => void doClear()} disabled={!records.length}>
            Clear…
          </button>
        </div>
      </header>

      <div className="ac-bar">
        <div className="ac-seg" role="radiogroup" aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={filter.status === s.id}
              className={filter.status === s.id ? "on" : ""}
              onClick={() => setFilter((f) => ({ ...f, status: s.id }))}
            >
              {s.label}
              {s.id === "active" && entries.some((e) => e.status === "awaiting" || e.status === "running") && <span className="ac-dot" />}
            </button>
          ))}
        </div>
        <select className="ac-select" aria-label="Tier" value={filter.tier} onChange={(e) => setFilter((f) => ({ ...f, tier: e.target.value as Filter["tier"] }))}>
          <option value="all">All tiers</option>
          <option value="read">Read only</option>
          <option value="act">Takes action</option>
          <option value="sensitive">Sensitive</option>
        </select>
        <label className="ac-search">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input ref={search} type="search" placeholder="Search actions" value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} />
        </label>
      </div>

      <main className="ac-list" aria-live="polite">
        {loaded && !rows.length && (
          <div className="ac-empty">
            {filtering ? (
              <>
                <strong>No matching actions</strong>
                <button type="button" className="ac-btn ac-btn-plain" onClick={() => setFilter(DEFAULT_FILTER)}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <strong>No activity yet</strong>
                <span>When Hikari uses a tool (opening an app, setting a timer), it shows up here.</span>
              </>
            )}
          </div>
        )}
        {rows.map((row, i) =>
          row.kind === "day" ? (
            <h2 key={`d${row.label}${i}`} className="ac-day">
              {row.label}
            </h2>
          ) : row.kind === "mark" ? (
            <div key={`m${row.mark.at}${i}`} className={`ac-mark ac-mark-${row.mark.kind}`}>
              <span>{row.mark.detail}</span>
              <time>{clock(row.mark.at)}</time>
            </div>
          ) : (
            <Row key={row.entry.callId} e={row.entry} now={now} open={open === row.entry.callId} onToggle={() => setOpen((o) => (o === row.entry.callId ? null : row.entry.callId))} />
          ),
        )}
      </main>
      {note && (
        <div className="ac-note" role="status">
          {note}
        </div>
      )}
    </div>
  );
}

function Row({ e, now, open, onToggle }: { e: Entry; now: number; open: boolean; onToggle: () => void }) {
  const startedAt = e.decision?.decision === "approved" ? (e.decision.ts ?? e.at) : e.at;
  const dur = e.status === "running" || e.status === "no_result" ? now - startedAt : e.durationMs;
  const detail = e.result?.error ?? (e.result?.ok ? resultLine(e.result.result) : "");
  return (
    <article className={`ac-row ac-s-${e.status}${open ? " open" : ""}`}>
      <button type="button" className="ac-row-main" onClick={onToggle} aria-expanded={open}>
        <StatusIcon status={e.status} />
        <span className="ac-row-text">
          <span className="ac-row-summary">{e.summary || e.tool}</span>
          <span className="ac-row-meta">
            <code>{e.tool}</code>
            {e.tier && <TierBadge tier={e.tier} />}
            <span className={`ac-status ac-status-${e.status}`}>{STATUS_LABEL[e.status]}</span>
            {detail && <span className="ac-row-detail">{detail}</span>}
          </span>
        </span>
        <span className="ac-row-time">
          <time>{clock(e.at)}</time>
          {dur !== undefined && <span>{formatDuration(dur)}</span>}
        </span>
      </button>
      {open && (
        <dl className="ac-row-more">
          {e.args !== undefined && Object.keys(e.args as object).length > 0 && (
            <>
              <dt>Arguments</dt>
              <dd>
                <pre>{JSON.stringify(e.args, null, 2)}</pre>
              </dd>
            </>
          )}
          {e.decision && (
            <>
              <dt>Decision</dt>
              <dd>
                {decisionText(e)}
                {e.decision.ts ? ` at ${clock(e.decision.ts)}` : ""}
                {e.decision.waitedMs !== undefined ? ` after ${formatDuration(e.decision.waitedMs)}` : ""}
              </dd>
            </>
          )}
          {e.result && (
            <>
              <dt>{e.result.ok ? "Result" : "Error"}</dt>
              <dd>
                <pre>{e.result.ok ? JSON.stringify(e.result.result ?? null, null, 2) : e.result.error ?? "(no message)"}</pre>
              </dd>
            </>
          )}
          <dt>Call</dt>
          <dd>
            <code>{e.callId}</code>
          </dd>
        </dl>
      )}
    </article>
  );
}

function decisionText(e: Entry): string {
  const d = e.decision!;
  switch (d.decision) {
    case "approved":
      return d.via === "voice" ? "You allowed it by voice" : "You allowed it";
    case "denied":
      return d.via === "window_closed" ? "Denied (dialog closed)" : d.via === "voice" ? "You denied it by voice" : "You denied it";
    case "auto_denied":
      return "Denied automatically (no answer in time)";
    case "panic":
      return "Stopped by Stop all actions";
    case "cancelled":
      return "Cancelled (the core disconnected)";
  }
}

function StatusIcon({ status }: { status: Entry["status"] }) {
  if (status === "running" || status === "awaiting") return <span className={`ac-icon ac-icon-${status}`} aria-hidden="true" />;
  const path =
    status === "succeeded" ? "M4.5 8.4 7 10.8l4.6-5.2" : status === "failed" ? "M8 4.6v4.2M8 11.2v.2" : (status === "unknown" || status === "no_result") ? "M6.4 6.2a1.7 1.7 0 1 1 2.4 1.6c-.5.3-.8.6-.8 1.2M8 11.2v.2" : "M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6";
  return (
    <svg className={`ac-icon ac-icon-${status}`} viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      <circle cx="8" cy="8" r="7.2" />
      <path d={path} />
    </svg>
  );
}

function resultLine(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 90 ? `${s.slice(0, 89)}…` : s;
}

const clock = (ts: number) => (ts ? new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "");

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

type ListRow = { kind: "day"; label: string } | { kind: "entry"; entry: Entry } | { kind: "mark"; mark: TimelineMark };

/** Entries and marks interleaved by time (newest first), with a heading per day. */
function mergeRows(entries: Entry[], marks: TimelineMark[]): ListRow[] {
  const items: { at: number; row: ListRow }[] = [
    ...entries.map((entry) => ({ at: entry.at, row: { kind: "entry", entry } as ListRow })),
    ...marks.map((mark) => ({ at: mark.at, row: { kind: "mark", mark } as ListRow })),
  ].sort((a, b) => b.at - a.at);
  const out: ListRow[] = [];
  let day = "";
  for (const it of items) {
    const label = dayLabel(it.at);
    if (label !== day) {
      out.push({ kind: "day", label });
      day = label;
    }
    out.push(it.row);
  }
  return out;
}
