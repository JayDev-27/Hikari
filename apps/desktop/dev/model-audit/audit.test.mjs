// Every installed Live2D pack must pass the Cubism standard audit with 0 errors
// (warnings are advisory). Skipped when Cubism Core or the packs are absent — both are
// git-ignored (licensed / large), so CI without them stays green.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditModel, auditPack } from "./audit.mjs";
import { coreAvailable } from "./core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../public/characters");
const packs = existsSync(root)
  ? readdirSync(root)
      .sort()
      .filter((id) => {
        const dir = join(root, id);
        if (!statSync(dir).isDirectory() || !existsSync(join(dir, "character.json"))) return false;
        const pj = JSON.parse(readFileSync(join(dir, "character.json"), "utf8"));
        return pj.modelPath?.endsWith(".model3.json") && existsSync(join(dir, pj.modelPath));
      })
  : [];

describe.skipIf(!coreAvailable() || packs.length === 0)("Live2D pack audit", () => {
  it.each(packs)("%s has no Cubism standard errors", async (id) => {
    const dir = join(root, id);
    const pj = JSON.parse(readFileSync(join(dir, "character.json"), "utf8"));
    const r = await auditModel(join(dir, pj.modelPath));
    for (const x of auditPack(dir, r)) if (x.level === "error") r.errors.push({ code: x.code, msg: x.msg });
    expect(r.errors.map((e) => `[${e.code}] ${e.msg}`)).toEqual([]);
  }, 30_000);
});
