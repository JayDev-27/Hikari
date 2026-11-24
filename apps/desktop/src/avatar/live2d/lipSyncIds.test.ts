import { describe, expect, it } from "vitest";
import { lipSyncIds } from "./lipSyncIds";

const internal = (Groups: unknown) => ({ settings: { json: { Groups } } });
const known = { ParamMouthOpenY: 8, ParamA: 3, ParamEyeLOpen: 1 };

describe("lipSyncIds", () => {
  it("uses the model's LipSync group (the official Mao drives ParamA, not ParamMouthOpenY)", () => {
    expect(lipSyncIds(internal([{ Target: "Parameter", Name: "LipSync", Ids: ["ParamA"] }]), known)).toEqual(["ParamA"]);
  });

  it("supports several lip-sync parameters and ignores ones the moc doesn't have", () => {
    expect(lipSyncIds(internal([{ Target: "Parameter", Name: "LipSync", Ids: ["ParamA", "ParamGhost", "ParamMouthOpenY"] }]), known)).toEqual(["ParamA", "ParamMouthOpenY"]);
  });

  it("falls back to ParamMouthOpenY when the model declares no group", () => {
    expect(lipSyncIds(internal([]), known)).toEqual(["ParamMouthOpenY"]);
    expect(lipSyncIds({}, known)).toEqual(["ParamMouthOpenY"]);
  });

  it("returns nothing when there is no mouth parameter at all", () => {
    expect(lipSyncIds(internal([]), { ParamEyeLOpen: 1 })).toEqual([]);
  });
});
