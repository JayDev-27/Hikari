// Materialise authored packs in Vite's public directory. Sample models are fetched separately.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../characters/", import.meta.url));
const destination = fileURLToPath(new URL("../public/characters/", import.meta.url));
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (!entry.isDirectory() || !existsSync(join(source, entry.name, "character.json"))) continue;
  const target = join(destination, entry.name);
  mkdirSync(target, { recursive: true });
  for (const name of ["character.json", "persona.md", "model"]) {
    const path = join(source, entry.name, name);
    if (existsSync(path)) cpSync(path, join(target, name), { recursive: true });
  }
}
