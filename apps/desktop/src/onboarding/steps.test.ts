import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  START,
  STEPS,
  flow,
  permissionSummary,
  permissionView,
  permissionsContinueLabel,
  restoreFlow,
  tagline,
  type FlowState,
  type PermissionStatus,
} from "./steps";

describe("onboarding flow", () => {
  it("walks forward through every step and stops at the end", () => {
    let s: FlowState = START;
    const seen = [s.step];
    for (let i = 0; i < STEPS.length + 2; i++) {
      s = flow(s, { type: "next" });
      seen.push(s.step);
    }
    expect([...new Set(seen)]).toEqual([...STEPS]);
    expect(s).toEqual({ step: "done", reached: "done" });
  });

  it("goes back without forgetting how far the user got", () => {
    let s = flow(flow(flow(START, { type: "next" }), { type: "next" }), { type: "next" });
    expect(s).toEqual({ step: "brain", reached: "brain" });
    s = flow(flow(s, { type: "back" }), { type: "back" });
    expect(s).toEqual({ step: "character", reached: "brain" });
    expect(flow(START, { type: "back" })).toEqual(START);
    // Moving forward again doesn't lower the high-water mark.
    expect(flow(s, { type: "next" }).reached).toBe("brain");
  });

  it("jumps only to steps already reached", () => {
    const s: FlowState = { step: "welcome", reached: "permissions" };
    expect(flow(s, { type: "goto", step: "permissions" }).step).toBe("permissions");
    expect(flow(s, { type: "goto", step: "character" }).step).toBe("character");
    expect(flow(s, { type: "goto", step: "done" })).toBe(s);
  });

  it("restarts from the welcome step", () => {
    expect(flow({ step: "talk", reached: "done" }, { type: "restart" })).toEqual(START);
  });

  it("restores a saved position and rejects junk", () => {
    expect(restoreFlow(JSON.stringify({ step: "permissions", reached: "brain" }))).toEqual({ step: "permissions", reached: "brain" });
    expect(restoreFlow(null)).toEqual(START);
    expect(restoreFlow("{bad")).toEqual(START);
    expect(restoreFlow(JSON.stringify({ step: "nope", reached: "done" }))).toEqual(START);
    // A step beyond the recorded high-water mark is inconsistent.
    expect(restoreFlow(JSON.stringify({ step: "done", reached: "welcome" }))).toEqual(START);
  });
});

describe("permission status presentation", () => {
  const all: PermissionStatus[] = ["granted", "notDetermined", "denied", "restricted", "unsupported"];

  it("maps each status to a label, tone and action", () => {
    expect(permissionView("microphone", "granted")).toMatchObject({ tone: "ok", action: null });
    expect(permissionView("microphone", "notDetermined")).toMatchObject({ tone: "idle", action: "request" });
    expect(permissionView("microphone", "denied")).toMatchObject({ tone: "warn", action: "settings" });
    expect(permissionView("microphone", "restricted")).toMatchObject({ tone: "muted", action: null });
    expect(permissionView("microphone", "unsupported")).toMatchObject({ tone: "muted", action: null });
  });

  it("gives every actionable state a button label", () => {
    for (const p of PERMISSIONS)
      for (const s of all) {
        const v = permissionView(p.id, s);
        expect(v.label).toBeTruthy();
        if (v.action) expect(v.actionLabel).toBeTruthy();
      }
  });

  it("tells the user Screen Recording needs a relaunch", () => {
    expect(permissionView("screenRecording", "denied").hint).toMatch(/reopen/i);
    expect(permissionView("accessibility", "denied").hint).not.toMatch(/reopen/i);
  });

  it("marks only the microphone as required", () => {
    expect(PERMISSIONS.filter((p) => !p.optional).map((p) => p.id)).toEqual(["microphone"]);
  });

  it("labels Continue by microphone state", () => {
    const r = { microphone: "granted", accessibility: "notDetermined", screenRecording: "denied" } as const;
    expect(permissionsContinueLabel(r)).toBe("Continue");
    expect(permissionsContinueLabel({ ...r, microphone: "denied" })).toBe("Continue Without Mic");
    expect(permissionsContinueLabel({ ...r, microphone: "notDetermined" })).toBe("Continue Without Mic");
    expect(permissionsContinueLabel(null)).toBe("Continue");
  });

  it("summarises the permissions for the final step", () => {
    expect(permissionSummary({ microphone: "granted", accessibility: "granted", screenRecording: "granted" })).toBe("Microphone on · Mac control ready");
    expect(permissionSummary({ microphone: "denied", accessibility: "granted", screenRecording: "notDetermined" })).toBe("Microphone off · Mac control partly set up");
    expect(permissionSummary({ microphone: "granted", accessibility: "denied", screenRecording: "denied" })).toBe("Microphone on · Mac control off");
  });
});

describe("character tagline", () => {
  it("takes the first clause of the Identity section", () => {
    const md = "# Hiyori\n\n## Identity\nHiyori is your cheerful, high-energy desktop companion: the genki friend. She's an adult.\n\n## Backstory\nx";
    expect(tagline(md)).toBe("Your cheerful, high-energy desktop companion");
  });
  it("handles the franchise personas' 'X, playing your companion:' opener", () => {
    const md = "## Identity\nReze, playing your companion: a warm café girl with a mischievous streak. An adult.";
    expect(tagline(md)).toBe("A warm café girl with a mischievous streak");
  });
  it("is empty without an Identity section", () => {
    expect(tagline("# Nobody")).toBe("");
  });
});
