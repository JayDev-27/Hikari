// node call.mjs <server-cwd> <tool> <args.json | '{"json":1}'>   — one MCP tools/call against iki's server.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const REPO = (await import("node:path")).resolve(process.env.IKI_REPO ?? "../iki") + "";
const req = createRequire(REPO + "/packages/mcp/package.json");
const { Client } = await import(req.resolve("@modelcontextprotocol/sdk/client/index.js"));
const { StdioClientTransport } = await import(req.resolve("@modelcontextprotocol/sdk/client/stdio.js"));
const [cwd, tool, raw = "{}"] = process.argv.slice(2);
const args = existsSync(raw) ? JSON.parse(readFileSync(raw, "utf8")) : JSON.parse(raw);
const transport = new StdioClientTransport({ command: process.execPath, args: [REPO + "/packages/mcp/dist/cli.js"], cwd, stderr: "inherit" });
const client = new Client({ name: "hikari-iki", version: "0.0.1" });
await client.connect(transport);
if (tool === "--list") {
  const { tools } = await client.listTools();
  for (const t of tools) console.log(t.name + " — " + (t.description ?? "").split("\n")[0].slice(0, 160));
} else {
  const r = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 1_800_000 });
  for (const c of r.content ?? []) console.log(c.type === "text" ? c.text : `[${c.type}]`);
  if (r.isError) process.exitCode = 1;
}
await client.close();
