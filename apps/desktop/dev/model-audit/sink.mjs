#!/usr/bin/env node
// Tiny receiver so the in-browser rig test (src/dev/rigtest.ts) can hand rendered sheets
// back to the file system. POST /<name> writes the body to <out-dir>/<name>.
//   node dev/model-audit/sink.mjs <out-dir> [port=18777]
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? ".");
const port = Number(process.argv[3] ?? 18777);
mkdirSync(out, { recursive: true });

createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (req.method !== "POST") return res.writeHead(405, cors).end();
  const name = basename(decodeURIComponent((req.url ?? "/x").slice(1)).replace(/[^\w.\- ]/g, "_")) || "upload";
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    writeFileSync(join(out, name), Buffer.concat(chunks));
    console.log(`saved ${name} (${Buffer.concat(chunks).length} bytes)`);
    res.writeHead(200, cors).end("ok");
  });
}).listen(port, "127.0.0.1", () => console.log(`sink on http://127.0.0.1:${port} → ${out}`));
