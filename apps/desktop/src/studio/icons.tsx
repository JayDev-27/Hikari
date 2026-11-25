/** Small line icons in the SF Symbols spirit: 1.6 px strokes, round caps, currentColor. */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconSearch = () => (
  <svg {...base}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
);
export const IconPlus = () => (
  <svg {...base}><path d="M8 3v10M3 8h10" /></svg>
);
export const IconCheck = () => (
  <svg {...base}><path d="m3.5 8.5 3 3 6-7" /></svg>
);
export const IconPlay = () => (
  <svg {...base} fill="currentColor" stroke="none"><path d="M5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L5.9 3.1a.6.6 0 0 0-.9.5Z" /></svg>
);
export const IconDoc = () => (
  <svg {...base}><path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6Z" /><path d="M9 2v4h4" /></svg>
);
export const IconFolder = () => (
  <svg {...base}><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z" /></svg>
);
export const IconTrash = () => (
  <svg {...base}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.1a1.5 1.5 0 0 0 1.5 1.4h2.8a1.5 1.5 0 0 0 1.5-1.4l.6-8.1" /></svg>
);
export const IconTray = () => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 6v20M14 18l8 8 8-8" /><path d="M6 26v7a5 5 0 0 0 5 5h22a5 5 0 0 0 5-5v-7" />
  </svg>
);
export const IconWarn = () => (
  <svg {...base}><path d="M8 2.5 14 13H2Z" /><path d="M8 6.5v3M8 11.3v.2" /></svg>
);
export const IconChevron = ({ open }: { open: boolean }) => (
  <svg {...base} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .18s ease" }}><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
);
export const IconLink = () => (
  <svg {...base}><path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6" /><path d="M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.6-.6" /></svg>
);
