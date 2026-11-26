/**
 * Voice consent, as a state machine. Nothing in Voice Lab records dataset clips until this reaches `granted`, and
 * `granted` is only reached when the core confirms it stored the consent record (research 03 §4: "Get the speaker's
 * consent and keep licence records for any voice").
 *
 *   own voice:      owner → attest → submitting → granted
 *   someone else's: owner → speaker → statement → attest → submitting → granted
 *
 * The statement step records the speaker reading a consent statement in their own voice; it's sent with the record
 * as evidence. Editing who the speaker is after recording it throws the recording away (it names them).
 */
export type Owner = "self" | "other";
export type ConsentStep = "owner" | "speaker" | "statement" | "attest" | "submitting" | "granted";

export interface StatementClip {
  wavBase64: string;
  sampleRate: number;
  durationMs: number;
  peak: number;
}

export type AttestKey = "own" | "present" | "adult" | "noDeception" | "private" | "withdraw";

export interface ConsentState {
  step: ConsentStep;
  owner?: Owner;
  speakerName: string;
  relationship: string;
  statement?: StatementClip;
  attest: Partial<Record<AttestKey, boolean>>;
  /** Why the core refused the last submission. */
  error?: string;
  /** From the core when granted. */
  consentId?: string;
  grantedAt?: number;
}

export type ConsentEvent =
  | { type: "owner"; owner: Owner }
  | { type: "speaker"; speakerName?: string; relationship?: string }
  | { type: "statement"; clip: StatementClip }
  | { type: "clearStatement" }
  | { type: "attest"; key: AttestKey; value: boolean }
  | { type: "next" }
  | { type: "back" }
  | { type: "submit" }
  | { type: "accepted"; consentId?: string; at?: number }
  | { type: "refused"; reason: string }
  /** The core already holds consent for this voice (e.g. reopening the window). */
  | { type: "restore"; owner: Owner; speakerName?: string; consentId?: string; at?: number }
  | { type: "reset" };

export const initialConsent: ConsentState = { step: "owner", speakerName: "", relationship: "", attest: {} };

/** The statement must be read in full: at least this long, and audible. */
export const STATEMENT_MIN_MS = 5000;
export const STATEMENT_MIN_PEAK = 0.05;

export const RELATIONSHIPS = ["Friend", "Family member", "Partner", "Colleague", "Voice actor (paid)", "Other"];

/** Attestations the user ticks, worded for who the voice belongs to. */
export function attestations(owner: Owner, speaker: string): { key: AttestKey; text: string }[] {
  const who = speaker.trim() || "The speaker";
  if (owner === "self") {
    return [
      { key: "own", text: "This is my own voice. I'm not recording anyone else." },
      { key: "private", text: "My recordings and the voice made from them stay on this Mac, for Hikari." },
    ];
  }
  return [
    { key: "present", text: `${who} is with me now and agreed to this freely, in their own words.` },
    { key: "adult", text: `${who} is 18 or older, or a parent or guardian has agreed for them.` },
    { key: "noDeception", text: `I won't use this voice to pass as ${who}, or to deceive or harm anyone.` },
    { key: "private", text: "The recordings and the voice stay on this Mac. They won't be shared, sold or published." },
    { key: "withdraw", text: `If ${who} changes their mind, I'll delete the voice and its recordings.` },
  ];
}

/** What the speaker reads aloud for the statement recording. */
export function consentStatement(speaker: string, date: Date, locale = "en-GB"): string {
  const day = date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  return `My name is ${speaker.trim()}, and today is ${day}. I agree that the person recording this may use my voice ` +
    `to make a voice for their Hikari companion app. It stays private on their computer, it won't be used to pretend ` +
    `to be me, and I can ask for it to be deleted at any time.`;
}

/** The steps for an owner, in order (for the step indicator). */
export function stepsFor(owner: Owner | undefined): ConsentStep[] {
  return owner === "other" ? ["owner", "speaker", "statement", "attest"] : ["owner", "attest"];
}

export const stepLabel: Record<ConsentStep, string> = {
  owner: "Whose voice", speaker: "Speaker", statement: "Statement", attest: "Confirm", submitting: "Saving", granted: "Done",
};

/** May the user leave the current step forward? */
export function canAdvance(s: ConsentState): boolean {
  switch (s.step) {
    case "owner":
      return !!s.owner;
    case "speaker":
      return s.speakerName.trim().length >= 2 && !!s.relationship;
    case "statement":
      return !!s.statement && s.statement.durationMs >= STATEMENT_MIN_MS && s.statement.peak >= STATEMENT_MIN_PEAK;
    case "attest":
      return !!s.owner && attestations(s.owner, s.speakerName).every((a) => s.attest[a.key] === true);
    default:
      return false;
  }
}

/** Dataset recording is allowed only once the core has confirmed consent. */
export const canRecord = (s: ConsentState) => s.step === "granted";

export function consentReducer(s: ConsentState, e: ConsentEvent): ConsentState {
  if (e.type === "reset") return initialConsent;
  if (e.type === "restore") return { ...initialConsent, step: "granted", owner: e.owner, speakerName: e.speakerName ?? "", consentId: e.consentId, grantedAt: e.at };
  // Once submitted, only the core's answer moves things on; once granted, only reset/restore does.
  if (s.step === "submitting") {
    if (e.type === "accepted") return { ...s, step: "granted", consentId: e.consentId, grantedAt: e.at, error: undefined };
    if (e.type === "refused") return { ...s, step: "attest", error: e.reason };
    return s;
  }
  if (s.step === "granted") return s;

  switch (e.type) {
    case "owner":
      if (s.step !== "owner") return s;
      // Switching owner starts the rest over: attestations and the statement belong to one person.
      return e.owner === s.owner ? s : { ...initialConsent, owner: e.owner };
    case "speaker": {
      if (s.step !== "speaker") return s;
      const speakerName = e.speakerName ?? s.speakerName;
      const renamed = speakerName.trim() !== s.speakerName.trim();
      return { ...s, speakerName, relationship: e.relationship ?? s.relationship, statement: renamed ? undefined : s.statement, attest: renamed ? {} : s.attest };
    }
    case "statement":
      return s.step === "statement" ? { ...s, statement: e.clip } : s;
    case "clearStatement":
      return s.step === "statement" ? { ...s, statement: undefined } : s;
    case "attest":
      return s.step === "attest" ? { ...s, attest: { ...s.attest, [e.key]: e.value }, error: undefined } : s;
    case "next": {
      if (!canAdvance(s)) return s;
      const steps = stepsFor(s.owner);
      const i = steps.indexOf(s.step);
      return i >= 0 && i < steps.length - 1 ? { ...s, step: steps[i + 1] } : s;
    }
    case "back": {
      const steps = stepsFor(s.owner);
      const i = steps.indexOf(s.step);
      return i > 0 ? { ...s, step: steps[i - 1], error: undefined } : s;
    }
    case "submit":
      return s.step === "attest" && canAdvance(s) ? { ...s, step: "submitting", error: undefined } : s;
    default:
      return s;
  }
}

/** The `consent.record` payload (`voice_lab.event.data`) sent on submit. */
export function consentRecord(s: ConsentState, statementText: string | undefined, now: number) {
  const owner = s.owner ?? "self";
  return {
    owner,
    speakerName: owner === "other" ? s.speakerName.trim() : undefined,
    relationship: owner === "other" ? s.relationship : undefined,
    attestations: attestations(owner, s.speakerName).map((a) => ({ key: a.key, text: a.text, agreed: s.attest[a.key] === true })),
    statement: owner === "other" && s.statement
      ? { text: statementText, encoding: "wav", sampleRate: s.statement.sampleRate, durationMs: Math.round(s.statement.durationMs), audio: s.statement.wavBase64 }
      : undefined,
    agreedAt: now,
    version: 1,
  };
}
