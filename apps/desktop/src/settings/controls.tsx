import { useEffect, useId, type ReactNode } from "react";
import type { Badge as BadgeInfo } from "./model";

/** Small macOS-style controls for the Settings window (styles in settings.css). */

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
export const IconGear = () => (
  <svg {...base}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" /></svg>
);
export const IconCloud = () => (
  <svg {...base}><path d="M4.6 12.5h6.9a3 3 0 0 0 .3-6 4 4 0 0 0-7.6 1.1A2.5 2.5 0 0 0 4.6 12.5Z" /></svg>
);
export const IconGauge = () => (
  <svg {...base}><path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" /><path d="m8 11.5 2.6-3.4" /></svg>
);
export const IconInfo = () => (
  <svg {...base}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.8M8 5h.01" /></svg>
);
export const IconLock = () => (
  <svg {...base}><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
);
export const IconKey = () => (
  <svg {...base}><circle cx="5.5" cy="10.5" r="2.8" /><path d="m7.5 8.5 5.5-5.5M11 5l1.6 1.6M9.6 6.4l1.2 1.2" /></svg>
);
export const IconArrow = () => (
  <svg {...base}><path d="M6 3.5h6.5V10M12.5 3.5 4 12" /></svg>
);
export const IconWarn = () => (
  <svg {...base}><path d="M8 2.5 14 13H2Z" /><path d="M8 6.5v3M8 11.3h.01" /></svg>
);

export function Card({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="se-group">
      {title && <h2 className="se-group-title">{title}</h2>}
      <div className="se-card">{children}</div>
      {footer && <p className="se-footnote">{footer}</p>}
    </section>
  );
}

/** One labelled row of a card: label (and hint) on the left, the control on the right. */
export function Row({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string }) {
  return (
    <div className="se-row">
      <div className="se-row-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {hint && <span className="se-hint">{hint}</span>}
      </div>
      {children !== undefined && <div className="se-row-control">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={`se-switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="se-switch-knob" />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size }: {
  value: T;
  options: { id: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "wide";
}) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className={`se-seg${size === "wide" ? " wide" : ""}`} role="radiogroup" aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      <span className="se-seg-pill" style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }} />
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} title={o.title}
          className={o.id === value ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, onChange, options, label, id, disabled }: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  label: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <span className="se-select">
      <select id={id} value={value} aria-label={label} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true"><path d="m1.5 4.5 2.5-2.5 2.5 2.5M1.5 7.5 4 10l2.5-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

export function Badge({ badge }: { badge: BadgeInfo }) {
  return <span className={`se-badge ${badge.tone}`} title={badge.title}>{badge.label}</span>;
}

/** A sheet that drops from the top of the window, as macOS sheets do. Escape or a click outside dismisses it. */
export function Sheet({ onDismiss, children, labelledBy }: { onDismiss: () => void; children: ReactNode; labelledBy?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  return (
    <div className="se-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}>
      <div className="se-sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
    </div>
  );
}

/** A horizontal meter: used share and, inside it, Hikari's share. */
export function Meter({ used, part, label }: { used: number; part?: number; label: string }) {
  const id = useId();
  return (
    <div className="se-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-labelledby={id}>
      <span id={id} hidden>{label}</span>
      <span className="se-meter-used" style={{ width: `${used * 100}%` }} />
      {part !== undefined && <span className="se-meter-part" style={{ width: `${Math.max(part * 100, part > 0 ? 0.8 : 0)}%` }} />}
    </div>
  );
}
