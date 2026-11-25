import type { Emotion, Language } from "@hikari/protocol";

export interface SpeechAnimation {
  defaultEmotion: Emotion;
  motions: string[];
  emotionMotions: Partial<Record<Emotion, string[]>>;
  intervalMs: number;
}

/** `characters/<id>/character.json` as stored (see characters/README.md). */
export interface PoseRig {
  hands: { drawable: string; wrist: [number, number]; breadth?: number }[];
  joinedBreadth?: number;
  arms?: { drawable: string; handDrawable?: string; centers: [number, number, number] }[];
  grip?: {
    drawable: string;
    arms: string[];
    file: string;
    origin: [number, number];
    size: [number, number];
    bodyIndices: [number, number];
    bodyPoints: [number, number, number, number];
  };
}

export interface CharacterJson {
  poseRig?: PoseRig;
  id: string;
  displayName: string;
  renderer: "live2d" | "vrm" | "iki";
  /** Relative to the pack folder; null = empty import slot (franchise presets). */
  modelPath: string | null;
  scale?: number;
  gazeScale?: number;
  speech?: SpeechAnimation;
  signatureMotions?: string[];
  /** Iki: degrees a gesture may swing an upper arm out before the art opens at the armpit. */
  armLiftMax?: number;
  /** Iki idle motion and weight-shift frequency multiplier. */
  idleTempo?: number;
  /** Iki idle sway and weight-shift amplitude multiplier. */
  idleAmplitude?: number;
  /** Iki gesture spring damping ratio. The default is critically damped. */
  springDamping?: number;
  expressionMap?: Partial<Record<Emotion, string | number>>;
  /** Iki groups can also name a procedural gesture listed in signatureMotions. */
  motionMap?: Record<string, { group: string; index?: number }>;
  hitAreas?: Record<string, string>;
  persona?: string | null;
  voice?: { engine: string; voiceId?: string; clonePath?: string; rvcModel?: string };
  defaultLanguage?: Language;
  /** The user can import a replacement into this character slot. */
  importSlot?: boolean;
  /** Created by the user's import (lives in the app data folder). */
  imported?: boolean;
  license: { source: string; terms: string; url: string; credit?: string; vrm?: unknown };
}

/** A pack resolved for the runtime. */
export interface CharacterPack extends CharacterJson {
  source: "builtin" | "user";
  /** Absolute URL the webview can load, or null for an empty slot. */
  modelUrl: string | null;
  /** persona.md contents (built-in persona, also kept for imported slot models). */
  personaText: string;
  /** Square profile portrait (characters/<id>/avatar.webp), when the pack has one. */
  avatarUrl?: string;
}

export const DEFAULT_CHARACTER = "hiyori";
export const ACTIVE_KEY = "hikari.character";

export function activeCharacterId(): string {
  // Dev/testing: VITE_CHARACTER=<id> picks the starting character.
  if (import.meta.env.DEV && import.meta.env.VITE_CHARACTER) return import.meta.env.VITE_CHARACTER as string;
  try {
    return localStorage.getItem(ACTIVE_KEY) || DEFAULT_CHARACTER;
  } catch {
    return DEFAULT_CHARACTER;
  }
}

export function setActiveCharacterId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* storage unavailable: selection lasts this session */
  }
}
