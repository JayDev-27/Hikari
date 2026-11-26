/** Voice Lab icons, in the Studio's line style (1.6 px strokes, round caps, currentColor). */
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconMic = () => <svg {...base}><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" /><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" /></svg>;
export const IconLock = () => <svg {...base} width="11" height="11"><rect x="3.5" y="7" width="9" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>;
export const IconWave = () => <svg {...base}><path d="M2 8h1.5M5 5v6M8 2.5v11M11 5v6M14 8h-1.5" /></svg>;
export const IconStop = () => <svg {...base} fill="currentColor" stroke="none"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>;
export const IconPause = () => <svg {...base} fill="currentColor" stroke="none"><rect x="4" y="3.5" width="2.8" height="9" rx="0.8" /><rect x="9.2" y="3.5" width="2.8" height="9" rx="0.8" /></svg>;
export const IconRedo = () => <svg {...base}><path d="M3 8a5 5 0 1 0 1.5-3.6" /><path d="M3 2.5V5h2.5" /></svg>;
export const IconLeft = () => <svg {...base}><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
export const IconRight = () => <svg {...base}><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>;
export const IconShield = () => <svg {...base}><path d="M8 1.8 13 3.6v4c0 3.2-2.2 5.5-5 6.6-2.8-1.1-5-3.4-5-6.6v-4Z" /><path d="m5.7 8 1.6 1.6 3-3.2" /></svg>;
export const IconPerson = () => <svg {...base}><circle cx="8" cy="5.5" r="2.6" /><path d="M3 14a5 5 0 0 1 10 0" /></svg>;
export const IconPeople = () => <svg {...base}><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13a4.2 4.2 0 0 1 8.4 0" /><path d="M10.5 3.4a2.3 2.3 0 0 1 0 4.3M12 9.3a4.2 4.2 0 0 1 2.2 3.7" /></svg>;
export const IconSpark = () => <svg {...base}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.8 3.8l2 2M10.2 10.2l2 2M3.8 12.2l2-2M10.2 5.8l2-2" /></svg>;
