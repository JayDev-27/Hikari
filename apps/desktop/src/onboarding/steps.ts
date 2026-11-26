/** Onboarding: the step machine and permission-status presentation (pure, unit-tested). */

export const STEPS = ["welcome", "character", "permissions", "brain", "talk", "done"] as const;
export type StepId = (typeof STEPS)[number];

export const STEP_TITLES: Record<StepId, string> = {
  welcome: "Welcome",
  character: "Your Character",
  permissions: "Permissions",
  brain: "Her Brain",
  talk: "Talking",
  done: "All Set",
};

export interface FlowState {
  step: StepId;
  /** Furthest step reached; the sidebar lets the user jump back to any step up to it. */
  reached: StepId;
}

export type FlowAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; step: StepId }
  | { type: "restart" };

export const START: FlowState = { step: "welcome", reached: "welcome" };
export const stepIndex = (s: StepId) => STEPS.indexOf(s);
const later = (a: StepId, b: StepId) => (stepIndex(a) >= stepIndex(b) ? a : b);

export function flow(state: FlowState, action: FlowAction): FlowState {
  const i = stepIndex(state.step);
  switch (action.type) {
    case "next": {
      const step = STEPS[Math.min(i + 1, STEPS.length - 1)];
      return { step, reached: later(state.reached, step) };
    }
    case "back":
      return { ...state, step: STEPS[Math.max(i - 1, 0)] };
    case "goto":
      // Only steps already reached: no skipping ahead past the permissions explanation.
      return stepIndex(action.step) <= stepIndex(state.reached) ? { ...state, step: action.step } : state;
    case "restart":
      return START;
  }
}

/** Parse a persisted state (localStorage), falling back to the start on anything odd. */
export function restoreFlow(raw: string | null | undefined): FlowState {
  try {
    const v = JSON.parse(raw ?? "") as Partial<FlowState>;
    const ok = (s: unknown): s is StepId => typeof s === "string" && (STEPS as readonly string[]).includes(s);
    if (ok(v.step) && ok(v.reached) && stepIndex(v.step) <= stepIndex(v.reached)) return { step: v.step, reached: v.reached };
  } catch {
    /* fall through */
  }
  return START;
}

// ---------- permissions ----------

export type PermissionId = "microphone" | "accessibility" | "screenRecording";
/** As reported by Rust `permissions_status` (see src-tauri/src/permissions.rs). */
export type PermissionStatus = "granted" | "notDetermined" | "denied" | "restricted" | "unsupported";
export type PermissionReport = Record<PermissionId, PermissionStatus>;

export interface PermissionInfo {
  id: PermissionId;
  name: string;
  /** Needed for the core experience (talking) vs. only for M7 Mac control. */
  optional: boolean;
  why: string;
}

export const PERMISSIONS: PermissionInfo[] = [
  {
    id: "microphone",
    name: "Microphone",
    optional: false,
    why: "So she can hear you while you hold ⌥Space. Your voice stays on this Mac, and you can always type instead.",
  },
  {
    id: "accessibility",
    name: "Accessibility",
    optional: true,
    why: "Lets her click and type in other apps when you ask, always after checking with you.",
  },
  {
    id: "screenRecording",
    name: "Screen Recording",
    optional: true,
    why: "Lets her see the window you're asking about. Nothing is recorded or saved.",
  },
];

export type Tone = "ok" | "idle" | "warn" | "muted";
export interface PermissionView {
  label: string;
  tone: Tone;
  /** What the row's button does: show the system prompt, open System Settings, or nothing. */
  action: "request" | "settings" | null;
  actionLabel?: string;
  hint?: string;
}

export function permissionView(id: PermissionId, status: PermissionStatus): PermissionView {
  switch (status) {
    case "granted":
      return { label: "Allowed", tone: "ok", action: null };
    case "notDetermined":
      return { label: "Not set up", tone: "idle", action: "request", actionLabel: "Allow…" };
    case "denied":
      return {
        label: "Off",
        tone: "warn",
        action: "settings",
        actionLabel: "Open Settings",
        hint:
          id === "screenRecording"
            ? "Turn Hikari on in System Settings, then reopen."
            : "Turn Hikari on in System Settings.",
      };
    case "restricted":
      return { label: "Blocked", tone: "muted", action: null, hint: "Your Mac's administrator controls this." };
    case "unsupported":
      return { label: "Unavailable", tone: "muted", action: null };
  }
}

/** Label for the permissions step's Continue button. */
export function permissionsContinueLabel(r: PermissionReport | null): string {
  return !r || r.microphone === "granted" || r.microphone === "restricted" || r.microphone === "unsupported"
    ? "Continue"
    : "Continue Without Mic";
}

/** Short summary for the final step: "Microphone on · Mac control off". */
export function permissionSummary(r: PermissionReport | null): string {
  if (!r) return "";
  const mic = r.microphone === "granted" ? "Microphone on" : "Microphone off";
  const control = [r.accessibility, r.screenRecording].filter((s) => s === "granted").length;
  const mac = control === 2 ? "Mac control ready" : control === 1 ? "Mac control partly set up" : "Mac control off";
  return `${mic} · ${mac}`;
}

// ---------- characters ----------

/** A one-line pitch from persona.md's "## Identity": its first sentence, up to the first colon. */
export function tagline(md: string): string {
  const m = md.match(/##\s*Identity\s*\n+([\s\S]*?)(\n##|$)/);
  const para = (m?.[1] ?? "").trim().split(/\n\s*\n/)[0]?.replace(/\s+/g, " ") ?? "";
  let s = para.split(/(?<=[.!?])\s/)[0] ?? "";
  // "Makima, playing your companion: composed, …" → "composed, …".
  s = s.replace(/^[^:]*,\s*playing [^:]*:\s*/, "");
  s = s.split(/[:;—]/)[0].replace(/[.!?]$/, "").trim();
  // "Hiyori is your cheerful, high-energy desktop companion" → "Your cheerful, high-energy desktop companion".
  s = s.replace(/^[\p{L} '-]+?\s+(is|was)\s+/u, "");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}
