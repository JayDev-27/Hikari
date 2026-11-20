#!/usr/bin/env node
// Fetches avatar assets that must NOT be committed (see docs/LICENSES.md):
//   1. Live2D sample models (Free Material License) from Live2D's official
//      CubismWebSamples repo → public/characters/<id>/model/
//   2. Live2D Cubism Core (Live2D Proprietary Software License) from the
//      "Cubism SDK for Web" zip that YOU download (accepting Live2D's terms) from
//      https://www.live2d.com/en/sdk/download/web/ → public/live2d/
//   3. Copies characters/<id>/character.json packs into public/characters/.
//
// Usage: pnpm fetch:assets [--sdk ~/Downloads/CubismSdkForWeb-5-r.5.zip]
//   Without --sdk it looks for ~/Downloads/CubismSdkForWeb-*.zip.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(app, "../..");
const pub = join(app, "public");
const SAMPLES_REPO = "https://github.com/Live2D/CubismWebSamples.git";
// Pinned commit-ish for reproducibility; bump deliberately.
const SAMPLES_REF = "develop";
const LIVE2D_SAMPLES = { hiyori: "Hiyori", haru: "Haru" };

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

function fetchSamples() {
  const missing = Object.entries(LIVE2D_SAMPLES).filter(([id]) => !existsSync(join(pub, "characters", id, "model")));
  if (!missing.length) return console.log("✓ Live2D sample models already present");
  const tmp = mkdtempSync(join(tmpdir(), "hikari-l2d-"));
  try {
    run("git", ["clone", "--depth=1", "--filter=blob:none", "--sparse", "-b", SAMPLES_REF, SAMPLES_REPO, tmp]);
    run("git", ["-C", tmp, "sparse-checkout", "set", ...missing.map(([, d]) => `Samples/Resources/${d}`)]);
    for (const [id, dir] of missing) {
      const src = join(tmp, "Samples/Resources", dir);
      const dst = join(pub, "characters", id, "model");
      mkdirSync(dst, { recursive: true });
      cpSync(src, dst, { recursive: true });
      // Free Material License: sample *sound data* may not be redistributed. Drop it.
      for (const f of walk(dst)) if (/\.(wav|mp3|ogg)$/i.test(f)) rmSync(f);
      console.log(`✓ ${dir} → public/characters/${id}/model`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function fetchCore() {
  const out = join(pub, "live2d", "live2dcubismcore.min.js");
  if (existsSync(out)) return console.log("✓ Cubism Core already present");
  const argi = process.argv.indexOf("--sdk");
  let zip = argi > 0 ? process.argv[argi + 1] : null;
  if (!zip) {
    const dl = join(homedir(), "Downloads");
    const hit = existsSync(dl) && readdirSync(dl).filter((f) => /^CubismSdkForWeb-.*\.zip$/.test(f)).sort().at(-1);
    zip = hit ? join(dl, hit) : null;
  }
  if (!zip || !existsSync(zip)) {
    console.warn(
      "! Cubism Core not installed. Download 'Cubism SDK for Web' from https://www.live2d.com/en/sdk/download/web/\n" +
        "  (this means accepting Live2D's license), then re-run: pnpm fetch:assets --sdk <path-to-zip>",
    );
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "hikari-sdk-"));
  try {
    run("unzip", ["-q", zip, "-d", tmp]);
    const files = walk(tmp);
    const core = files.find((f) => f.endsWith("Core/live2dcubismcore.min.js"));
    const redist = files.find((f) => f.endsWith("RedistributableFiles.txt"));
    if (!core) throw new Error("live2dcubismcore.min.js not found in SDK zip");
    if (!redist || !readFileSync(redist, "utf8").includes("live2dcubismcore.min.js")) {
      throw new Error("live2dcubismcore.min.js is not listed in RedistributableFiles.txt — refusing to bundle");
    }
    mkdirSync(dirname(out), { recursive: true });
    cpSync(core, out);
    console.log(`✓ Cubism Core from ${zip}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function copyPacks() {
  const src = join(repoRoot, "characters");
  for (const id of readdirSync(src)) {
    const f = join(src, id, "character.json");
    if (!existsSync(f)) continue;
    mkdirSync(join(pub, "characters", id), { recursive: true });
    cpSync(f, join(pub, "characters", id, "character.json"));
    const persona = join(src, id, "persona.md");
    if (existsSync(persona)) cpSync(persona, join(pub, "characters", id, "persona.md"));
  }
  console.log("✓ character packs copied");
}

function* walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

fetchSamples();
copyPacks();
fetchCore();
