/**
 * Detect a "switch character" request in typed chat (§3: mid-session persona
 * switching). English and Hinglish phrasings; names match a pack's id or display
 * name (first name is enough), case-insensitive, tolerant of one typo.
 *   "switch to Mao", "change to makima", "talk to reze", "Mao ko bulao",
 *   "makima se baat karni hai", "/switch rice"
 * Voice requests need STT, so the core detects those (it can emit the same switch).
 */
export interface Named {
  id: string;
  displayName: string;
}

const PATTERNS = [
  /^\/(?:switch|char(?:acter)?)\s+(.+)$/i,
  /\b(?:switch|change|swap)\s+(?:the\s+)?(?:character\s+)?(?:to|with)\s+(.+?)(?:\s+character)?[.!?]*$/i,
  /\b(?:talk|speak)\s+to\s+(.+?)[.!?]*$/i,
  /^(.+?)\s+(?:ko\s+bulao|ko\s+bula\s*do|se\s+baat\s+kar(?:ni|na|o|wa\s*do)?(?:\s+hai)?)[.!?]*$/i,
];

export function matchSwitch(text: string, packs: Named[]): Named | null {
  for (const re of PATTERNS) {
    const m = text.trim().match(re);
    if (!m) continue;
    const want = norm(m[1]);
    if (!want) continue;
    const found =
      packs.find((p) => [p.id, p.displayName, first(p.displayName)].some((n) => norm(n) === want)) ??
      packs.find((p) => [p.id, first(p.displayName)].some((n) => lev(norm(n), want) <= 1 && want.length >= 4));
    if (found) return found;
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\p{Script=Devanagari} ]/gu, "").replace(/\s+/g, " ").trim();
const first = (s: string) => s.split(/\s+/)[0];

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
