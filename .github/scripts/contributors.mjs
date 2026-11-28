// Draw the README's contributor photos as one SVG (assets/readme/contributors.svg).
// Runs in .github/workflows/contributors.yml on every push to main, so a merged pull request shows its author's photo
// within minutes instead of waiting on an outside image cache. Bots are left out. No dependencies (Node 20+).
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node .github/scripts/contributors.mjs [out.svg]
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const repo = process.env.GITHUB_REPOSITORY ?? "JayDev-27/Hikari";
const out = process.argv[2] ?? "assets/readme/contributors.svg";
const SIZE = 64, GAP = 10, COLUMNS = 12, MAX = 120;
const headers = { Accept: "application/vnd.github+json", "User-Agent": "hikari-contributors" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const isBot = (c) => c.type !== "User" || c.login.endsWith("[bot]");
const esc = (s) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function contributors() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/contributors?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`contributors: HTTP ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  // The API already orders by number of commits, most first.
  return all.filter((c) => !isBot(c)).slice(0, MAX);
}

async function avatar(c) {
  const res = await fetch(`https://avatars.githubusercontent.com/u/${c.id}?s=${SIZE * 2}&v=4`, { headers: { "User-Agent": headers["User-Agent"] } });
  if (!res.ok) throw new Error(`avatar ${c.login}: HTTP ${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

const people = await contributors();
if (people.length === 0) throw new Error("no contributors found");
const images = await Promise.all(people.map(avatar));
const cols = Math.min(COLUMNS, people.length);
const rows = Math.ceil(people.length / cols);
const width = cols * SIZE + (cols - 1) * GAP + 4;
const height = rows * SIZE + (rows - 1) * GAP + 4;
const r = SIZE / 2;

const cells = people.map((c, i) => {
  const x = 2 + (i % cols) * (SIZE + GAP);
  const y = 2 + Math.floor(i / cols) * (SIZE + GAP);
  return `  <g transform="translate(${x} ${y})"><title>${esc(c.login)}</title>` +
    `<clipPath id="c${i}"><circle cx="${r}" cy="${r}" r="${r}"/></clipPath>` +
    `<image width="${SIZE}" height="${SIZE}" href="${images[i]}" clip-path="url(#c${i})"/>` +
    `<circle cx="${r}" cy="${r}" r="${r - 0.75}" fill="none" stroke="#c0c0c0" stroke-opacity="0.6" stroke-width="1.5"/></g>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`${people.length} contributors: ${people.map((c) => c.login).join(", ")}`)}">\n${cells.join("\n")}\n</svg>\n`;

if (existsSync(out) && readFileSync(out, "utf8") === svg) {
  console.log(`unchanged: ${people.length} contributors`);
} else {
  writeFileSync(out, svg);
  console.log(`wrote ${out}: ${people.map((c) => c.login).join(", ")}`);
}
