#!/usr/bin/env node
// Release-bundle regression check (M8). Inspects a built Hikari.app (or a .dmg) without
// changing anything:
//   - bundle structure, Info.plist keys (identifier/version match tauri.conf.json,
//     NSMicrophoneUsageDescription, minimum macOS), size budget, code signature;
//   - no secrets or key files anywhere in the bundle or in the embedded frontend;
//   - Live2D Cubism Core: only the redistributable live2dcubismcore.min.js ships
//     (docs/LICENSES.md); no SDK zips, non-minified Core, typings or source maps;
//   - expected resources are embedded (index.html, every built-in character pack);
//   - with --launch: starts the app, finds the stage window, captures it and checks it is
//     transparent outside the character (alpha), floating, and click-through (the window
//     server's hit test at a transparent point does not land on the stage).
//
// Usage (from apps/desktop):
//   pnpm check:bundle                         # target/release/bundle/macos/Hikari.app
//   pnpm check:bundle path/to/Hikari.app
//   pnpm check:bundle path/to/Hikari.dmg      # mounts read-only, checks the app inside, detaches
//   pnpm check:bundle --launch [app|dmg]      # also launches it and checks the stage window
//   --no-live2d                               # built without the Cubism SDK: missing Core is a warning
// Exit code 1 if any check fails (warnings don't fail).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const conf = JSON.parse(readFileSync(join(here, "src-tauri/tauri.conf.json"), "utf8"));
const repoCharacters = fileURLToPath(new URL("../../../characters/", import.meta.url));

const SIZE_WARN_MB = 200;
const SIZE_FAIL_MB = 400;
const CUBISM_ALLOWED = new Set(["live2d/live2dcubismcore.min.js"]);
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|p12|p8|key|keystore|mobileprovision)|id_(rsa|ed25519|ecdsa)(\.pub)?|credentials\.json|\.netrc|\.npmrc)$/i;
const SECRET_TEXT = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-(proj-)?[A-Za-z0-9]{32,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key block", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}\b/],
];

// ---------- tiny reporter ----------
const results = [];
const pass = (msg) => results.push(["PASS", msg]);
const warn = (msg) => results.push(["WARN", msg]);
const fail = (msg) => results.push(["FAIL", msg]);
const check = (ok, msg, detail = "") => (ok ? pass(msg) : fail(detail ? `${msg}: ${detail}` : msg));

// ---------- args ----------
const args = process.argv.slice(2);
const launch = args.includes("--launch");
const noLive2d = args.includes("--no-live2d");
let target = args.find((a) => !a.startsWith("--")) ?? join(here, "src-tauri/target/release/bundle/macos", `${conf.productName}.app`);
if (!existsSync(target)) {
  console.error(`Not found: ${target}\nBuild first: pnpm build (or pnpm -F desktop tauri build --bundles app)`);
  process.exit(2);
}

let mount = null;
const cleanups = [];

async function main() {
  try {
    if (extname(target) === ".dmg") target = checkDmg(target);
    checkApp(target);
    if (launch) await checkLaunch(target);
  } finally {
    for (const c of cleanups.reverse()) c();
    if (mount) detach(mount);
  }

  for (const [k, m] of results) console.log(`${k === "PASS" ? "✓" : k === "WARN" ? "!" : "✗"} ${k}  ${m}`);
  const failed = results.filter(([k]) => k === "FAIL").length;
  const warned = results.filter(([k]) => k === "WARN").length;
  console.log(`\n${failed ? "FAILED" : "OK"}: ${results.length - failed - warned} passed, ${warned} warnings, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ---------- dmg ----------
function checkDmg(dmg) {
  pass(`dmg ${basename(dmg)} (${mb(statSync(dmg).size)} MB)`);
  execFileSync("hdiutil", ["verify", "-quiet", dmg], { stdio: "pipe" });
  pass("dmg checksum verifies (hdiutil verify)");
  mount = mkdtempSync(join(tmpdir(), "hikari-dmg-"));
  execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg], { stdio: "pipe" });
  const entries = readdirSync(mount);
  const app = entries.find((e) => e.endsWith(".app"));
  check(!!app, "dmg contains the app", entries.join(", "));
  const apps = join(mount, "Applications");
  check(existsSync(apps) && lstatSync(apps).isSymbolicLink() && readlinkSync(apps) === "/Applications", "dmg has the /Applications drop link");
  return join(mount, app ?? "");
}

function detach(dir) {
  try {
    execFileSync("hdiutil", ["detach", "-quiet", dir], { stdio: "pipe" });
  } catch {
    execFileSync("hdiutil", ["detach", "-force", "-quiet", dir], { stdio: "pipe" });
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------- app ----------
function checkApp(app) {
  const plistPath = join(app, "Contents/Info.plist");
  check(existsSync(plistPath), "Contents/Info.plist exists");
  const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], { encoding: "utf8" }));
  check(plist.CFBundleIdentifier === conf.identifier, `CFBundleIdentifier is ${conf.identifier}`, plist.CFBundleIdentifier);
  check(plist.CFBundleShortVersionString === conf.version, `version is ${conf.version}`, plist.CFBundleShortVersionString);
  check(plist.CFBundleName === conf.productName || plist.CFBundleDisplayName === conf.productName, `bundle name is ${conf.productName}`);
  const mic = plist.NSMicrophoneUsageDescription;
  check(typeof mic === "string" && mic.length > 20, "NSMicrophoneUsageDescription present (macOS kills the app on mic access without it)");
  const minOs = conf.bundle?.macOS?.minimumSystemVersion;
  check(!minOs || plist.LSMinimumSystemVersion === minOs, `LSMinimumSystemVersion is ${minOs}`, plist.LSMinimumSystemVersion);
  // A runtime accessory app; LSUIElement would also hide the menu bar app from ⌘Tab when "Show in Dock" is on.
  if (plist.LSUIElement) warn("LSUIElement is set: the Dock toggle (dock.rs) expects it unset");

  const exe = join(app, "Contents/MacOS", plist.CFBundleExecutable ?? "");
  check(existsSync(exe), `executable Contents/MacOS/${plist.CFBundleExecutable}`);
  const icon = plist.CFBundleIconFile && join(app, "Contents/Resources", plist.CFBundleIconFile.replace(/(\.icns)?$/, ".icns"));
  check(!!icon && existsSync(icon), "app icon (.icns) present");

  // Size
  const files = walk(app);
  const total = files.reduce((n, f) => n + f.size, 0);
  const totalMb = mb(total);
  if (totalMb > SIZE_FAIL_MB) fail(`app size ${totalMb} MB > ${SIZE_FAIL_MB} MB budget`);
  else if (totalMb > SIZE_WARN_MB) warn(`app size ${totalMb} MB (warn above ${SIZE_WARN_MB} MB)`);
  else pass(`app size ${totalMb} MB (executable ${mb(statSync(exe).size)} MB, ${files.length} files)`);

  // Files on disk: no key/secret files anywhere in the bundle.
  const secretFiles = files.filter((f) => SECRET_FILE.test(f.rel));
  check(!secretFiles.length, "no .env / key / credential files in the bundle", secretFiles.map((f) => f.rel).join(", "));
  const looseCubism = files.filter((f) => /live2dcubismcore/i.test(f.rel));
  check(!looseCubism.length, "no loose Cubism Core files in the bundle (it is embedded with the frontend)", looseCubism.map((f) => f.rel).join(", "));

  // Code signature. Without bundle.macOS.signingIdentity Tauri leaves only the linker's
  // ad-hoc signature on the executable: the bundle isn't sealed (Info.plist not bound) and
  // Entitlements.plist isn't applied.
  const sig = stderrOf("codesign", ["-dvv", app]);
  if (/Sealed Resources=none/.test(sig) || /Info\.plist=not bound/.test(sig)) {
    warn("bundle not sealed (only the linker's ad-hoc signature on the executable): set bundle.macOS.signingIdentity (\"-\" for ad hoc, or a Developer ID) so Info.plist is bound and Entitlements.plist applies");
  } else {
    try {
      execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
      pass("code signature verifies (bundle sealed)");
    } catch (e) {
      fail(`code signature invalid: ${String(e.stderr ?? e).trim().split("\n")[0]}`);
    }
  }
  if (/Signature=adhoc/.test(sig)) warn("signed ad hoc, no Developer ID: Gatekeeper blocks it on other Macs, and TCC grants reset on every rebuild");
  else if (/Authority=/.test(sig)) pass(`signed by ${sig.match(/Authority=([^\n]+)/)[1]}`);

  // Embedded frontend: Tauri compiles dist/ into the executable. Asset paths are stored in
  // clear text (contents are compressed), so list them straight from the binary.
  const bin = readFileSync(exe);
  const text = bin.toString("latin1");
  // Paths are packed back to back without separators, so match up to a known extension.
  const EXT = "json|png|jpe?g|webp|gif|svg|js|mjs|css|html|moc3|iki|vrm|glb|wav|mp3|ogg|md|txt|map|zip|7z|gz|tar|woff2?|ttf|otf|wasm|ico|env|pem|key|p12|p8";
  const pathRe = new RegExp(`/((?:assets|characters|live2d)/[A-Za-z0-9._@%+\\-/]*?\\.(?:${EXT}))(?![A-Za-z0-9])`, "g");
  const embedded = [...new Set([...text.matchAll(pathRe)].map((m) => m[1]))];
  check(text.includes("/index.html"), "frontend embedded (index.html)");
  check(embedded.some((p) => /^assets\/index-.*\.js$/.test(p)), "frontend JS bundle embedded");
  const cubism = embedded.filter((p) => /live2dcubismcore/i.test(p) || p.startsWith("live2d/"));
  const extra = cubism.filter((p) => !CUBISM_ALLOWED.has(p));
  check(!extra.length, "Cubism Core: only the redistributable live2dcubismcore.min.js is embedded", extra.join(", "));
  if (cubism.includes("live2d/live2dcubismcore.min.js")) pass("Cubism Core embedded (Live2D characters can render)");
  else if (noLive2d) warn("Cubism Core not embedded (--no-live2d): Live2D characters won't render");
  else fail("Cubism Core not embedded: Live2D characters won't render (pnpm -F desktop fetch:assets --sdk <zip>, then rebuild; or pass --no-live2d)");
  const zips = embedded.filter((p) => /\.(zip|7z|tar|gz)$/i.test(p));
  check(!zips.length, "no archives embedded", zips.join(", "));
  const maps = embedded.filter((p) => p.endsWith(".map"));
  if (maps.length) warn(`${maps.length} source maps embedded (${maps.slice(0, 3).join(", ")}…)`);
  else pass("no source maps embedded");
  const secretPaths = embedded.filter((p) => SECRET_FILE.test(p));
  check(!secretPaths.length, "no key/secret files embedded in the frontend", secretPaths.join(", "));

  // Every built-in character pack ships.
  const builtins = readdirSync(repoCharacters, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(repoCharacters, d.name, "character.json")))
    .map((d) => d.name);
  const missingPacks = builtins.filter((id) => !embedded.some((p) => p.startsWith(`characters/${id}/`)));
  check(!missingPacks.length, `all ${builtins.length} built-in character packs embedded`, `missing ${missingPacks.join(", ")}`);
  const missingModels = builtins.filter((id) => {
    const j = JSON.parse(readFileSync(join(repoCharacters, id, "character.json"), "utf8"));
    return j.modelPath && !embedded.includes(`characters/${id}/${j.modelPath}`);
  });
  check(!missingModels.length, "every built-in model file embedded", missingModels.join(", "));

  // Secrets in clear text: the Rust side of the binary, plus dist/ (the embedded frontend,
  // compressed inside the binary) when it matches this build.
  const hits = SECRET_TEXT.filter(([, re]) => re.test(text)).map(([n]) => n);
  check(!hits.length, "no API keys / private keys in the executable", hits.join(", "));
  // dist/ next to the src-tauri/ that built this app (this checkout's by default).
  const m = app.match(/^(.*)\/src-tauri\/target\//);
  const dist = join(m ? m[1] : here, "dist");
  if (existsSync(join(dist, "index.html")) && !mount && Math.abs(statSync(join(dist, "index.html")).mtimeMs - statSync(exe).mtimeMs) < 3 * 3600e3) {
    const distHits = [];
    for (const f of walk(dist)) {
      if (!/\.(js|mjs|json|html|css|md|txt|svg)$/i.test(f.rel) || f.size > 20e6) continue;
      const s = readFileSync(f.path, "utf8");
      for (const [n, re] of SECRET_TEXT) if (re.test(s)) distHits.push(`${n} in ${f.rel}`);
    }
    check(!distHits.length, "no API keys / private keys in the frontend (dist/)", distHits.join(", "));
  } else {
    warn("frontend text not scanned for keys (dist/ is missing or from a different build)");
  }
}

/** codesign -d prints its details on stderr. */
function stderrOf(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

// ---------- launch: stage transparency + click-through ----------
async function checkLaunch(app) {
  const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")], { encoding: "utf8" }));
  const exeName = plist.CFBundleExecutable;
  const running = pgrep(`${conf.productName}.app/Contents/MacOS/${exeName}`);
  if (running.length) {
    warn(`skipping --launch: ${conf.productName} is already running (pid ${running.join(", ")}); quit it first`);
    return;
  }
  const probe = buildProbe();
  const exe = join(app, "Contents/MacOS", exeName);
  const child = spawn(exe, [], { stdio: "ignore", detached: true });
  cleanups.push(() => {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      /* gone */
    }
  });
  let win = null;
  for (let i = 0; i < 40 && !win; i++) {
    await sleep(500);
    win = probeJson(probe, ["find", String(child.pid), "Hikari"]).find((w) => w.onscreen);
  }
  check(!!win, `launched from ${app.includes("/Volumes/") || mount ? "the dmg" : "the bundle"}: stage window on screen`);
  if (!win) return;
  pass(`stage window ${win.w}×${win.h} at level ${win.layer} (floating: ${win.layer > 0 ? "yes" : "no"})`);
  if (win.layer <= 0) fail("stage is not above normal windows");
  await sleep(6000); // model load + first idle frames
  // Re-read: the stage becomes an NSPanel after it first appears, which can change the id.
  win = probeJson(probe, ["find", String(child.pid), "Hikari"]).find((w) => w.onscreen) ?? win;
  let clear = null;
  if (!probeJson(probe, ["cancapture"]).granted) {
    warn("transparency not checked: this terminal lacks Screen Recording (System Settings → Privacy & Security → Screen Recording)");
  } else {
    clear = await checkPixels(probe, win);
  }
  // Click-through: the window server's hit test at a transparent point must skip the stage.
  // The stage only takes the mouse while the cursor is over her, so with the cursor elsewhere
  // this also catches a stage that swallows clicks everywhere. Without a capture, use the
  // top-left margin, which every character leaves clear (stage fit: 6 % sides, 4 % top).
  const [fx, fy] = clear ?? [0.03, 0.02];
  const pt = { x: win.x + fx * win.w, y: win.y + fy * win.h };
  const hit = probeJson(probe, ["hit", String(pt.x), String(pt.y)]);
  check(hit.window !== win.id, `click-through at a transparent point (${Math.round(pt.x)}, ${Math.round(pt.y)}): clicks reach the window below`, `hit the stage (window ${hit.window})`);
}

async function checkPixels(probe, win) {
  const png = join(mkdtempSync(join(tmpdir(), "hikari-cap-")), "stage.png");
  cleanups.push(() => rmSync(join(png, ".."), { recursive: true, force: true }));
  let a = null;
  // A cold first launch can take longer than the initial wait to load the model: retry.
  for (let i = 0; i < 4 && !(a?.opaque > 0); i++) {
    if (i) await sleep(4000);
    try {
      execFileSync("screencapture", ["-x", "-o", "-l", String(win.id), png], { stdio: "pipe" });
    } catch {
      warn("could not capture the stage window");
      return null;
    }
    a = probeJson(probe, ["alpha", png]);
  }
  if (a.opaque === 0 && a.transparent === 0) {
    warn("stage capture is empty");
    return null;
  }
  check(a.cornersTransparent, "stage corners fully transparent (no window background)", JSON.stringify(a.corners));
  check(a.transparent > 0.35, `stage is mostly transparent (${pct(a.transparent)} clear pixels)`);
  check(a.opaque > 0.03, `character drawn (${pct(a.opaque)} opaque pixels)`);
  return a.clearPoint ?? null;
}

function buildProbe() {
  const dir = mkdtempSync(join(tmpdir(), "hikari-probe-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, "probe.swift");
  writeFileSync(src, PROBE_SWIFT);
  const bin = join(dir, "probe");
  execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "pipe" });
  return bin;
}
const probeJson = (bin, argv) => JSON.parse(execFileSync(bin, argv, { encoding: "utf8" }));

const PROBE_SWIFT = String.raw`
import AppKit
import CoreGraphics
import ImageIO
func out(_ v: Any) { let d = try! JSONSerialization.data(withJSONObject: v); print(String(data: d, encoding: .utf8)!) }
let a = CommandLine.arguments
switch a[1] {
case "find": // windows of a pid with a title: [{id,x,y,w,h,layer,onscreen}]
  let pid = Int(a[2])!, title = a[3]
  let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
  var r: [[String: Any]] = []
  for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid && (w[kCGWindowName as String] as? String) == title {
    let b = w[kCGWindowBounds as String] as! [String: CGFloat]
    r.append(["id": w[kCGWindowNumber as String]!, "x": b["X"]!, "y": b["Y"]!, "w": b["Width"]!, "h": b["Height"]!,
              "layer": w[kCGWindowLayer as String]!, "onscreen": (w[kCGWindowIsOnscreen as String] as? Bool) ?? false])
  }
  out(r)
case "alpha": // alpha statistics of a PNG
  let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: a[2]) as CFURL, nil)!
  let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
  let w = img.width, h = img.height
  var px = [UInt8](repeating: 0, count: w * h * 4)
  let ctx = CGContext(data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  var clear = 0, opaque = 0
  var clearPoint: [Double]? = nil
  for y in 0..<h { for x in 0..<w {
    let al = px[(y * w + x) * 4 + 3]
    if al == 0 { clear += 1; if clearPoint == nil && x > w / 10 && y > h / 3 { clearPoint = [Double(x) / Double(w), Double(y) / Double(h)] } }
    else if al == 255 { opaque += 1 }
  } }
  // CGContext rows are bottom-up relative to the PNG: flip y for the reported point.
  if let p = clearPoint { clearPoint = [p[0], 1 - p[1]] }
  let corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)].map { Int(px[($0.1 * w + $0.0) * 4 + 3]) }
  var r: [String: Any] = ["w": w, "h": h, "transparent": Double(clear) / Double(w * h), "opaque": Double(opaque) / Double(w * h),
                          "corners": corners, "cornersTransparent": corners.allSatisfy { $0 == 0 }]
  if let p = clearPoint { r["clearPoint"] = p }
  out(r)
case "hit": // frontmost window that a mouse-down at (x, y) (CG global, top-left origin) would reach
  let x = Double(a[2])!, y = Double(a[3])!
  let mainH = CGDisplayBounds(CGMainDisplayID()).height
  let n = NSWindow.windowNumber(at: NSPoint(x: x, y: mainH - y), belowWindowWithWindowNumber: 0)
  out(["window": n])
case "cancapture": // can this process capture other apps' windows?
  out(["granted": CGPreflightScreenCaptureAccess()])
default: exit(2)
}
`;

// ---------- helpers ----------
function walk(dir) {
  const outList = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else outList.push({ path: p, rel: relative(dir, p), size: statSync(p).size });
    }
  }
  return outList;
}
function pgrep(pattern) {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
const mb = (n) => Math.round((n / 1048576) * 10) / 10;
const pct = (f) => `${Math.round(f * 1000) / 10} %`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await main();
