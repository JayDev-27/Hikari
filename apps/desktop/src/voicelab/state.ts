import { consentReducer, initialConsent, type ConsentEvent, type ConsentState } from "./consent";
import { initialLab, labReducer, OPS, parseConsent, type LabAction, type LabState } from "./ops";

/**
 * Voice Lab window state: the core's view (LabState) plus each voice's consent flow. The core's `consent.check`
 * answers drive the flows here, in the reducer, so a flow can only reach `granted` on the core's word.
 */
export interface UiState {
  lab: LabState;
  consent: Record<string, ConsentState>;
}

export type UiAction = LabAction | { type: "consent"; voiceId: string; event: ConsentEvent };

export const initialUi: UiState = { lab: initialLab, consent: {} };

export const consentOf = (s: UiState, voiceId: string): ConsentState => s.consent[voiceId] ?? initialConsent;

function withConsent(s: UiState, voiceId: string, event: ConsentEvent): UiState {
  return { ...s, consent: { ...s.consent, [voiceId]: consentReducer(consentOf(s, voiceId), event) } };
}

export function uiReducer(s: UiState, a: UiAction): UiState {
  if (a.type === "consent") return withConsent(s, a.voiceId, a.event);
  const next = { ...s, lab: labReducer(s.lab, a) };
  if (a.type === "offline") {
    // A submission in flight can't be answered any more: back to the form (nothing is granted without the core).
    const consent = Object.fromEntries(Object.entries(s.consent).map(([id, c]) => [id, c.step === "submitting" ? { ...c, step: "attest" as const, error: "Lost the connection to the core before it confirmed. Try again." } : c]));
    return { ...next, consent };
  }
  if (a.type !== "core") return next;
  const { op, voiceId = "", data } = a.event;
  if (op === OPS.voiceDeleted) {
    return { ...next, consent: Object.fromEntries(Object.entries(next.consent).filter(([id]) => id !== voiceId)) };
  }
  if (op !== OPS.consentCheck || !voiceId) return next;
  const c = parseConsent(data);
  const cur = consentOf(next, voiceId);
  if (c.ok) {
    return withConsent(next, voiceId, cur.step === "submitting"
      ? { type: "accepted", consentId: c.consentId, at: c.at }
      : { type: "restore", owner: c.owner ?? cur.owner ?? "self", speakerName: c.speakerName, consentId: c.consentId, at: c.at });
  }
  if (cur.step === "submitting") return withConsent(next, voiceId, { type: "refused", reason: c.reason ?? "The core didn't accept the consent record." });
  // The core holds no consent (withdrawn, or never given): whatever the UI thought, start over.
  if (cur.step === "granted") return withConsent(next, voiceId, { type: "reset" });
  return next;
}
