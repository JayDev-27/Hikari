import type { MemoryItem, MemoryQuery, MessageType, PayloadMap } from "@hikari/protocol";

/**
 * DEV browser preview only: a stand-in for the core's memory service, so the Memories window can be tried without
 * B's core. Never used in the app (the window shows the offline state there instead). Answers like the real core
 * should: filters by q (substring), kind and namespace, newest first, pages by offset/limit, reports a total.
 */
type Reply = { [K in MessageType]: { type: K; payload: PayloadMap[K] } }[MessageType];

const H = 3_600_000;
const D = 24 * H;

const SAMPLES: [MemoryItem["kind"], string, string, number, number, string?][] = [
  // kind, namespace, text, importance, confidence, emotion
  ["fact", "hiyori", "You prefer your nickname to your full name, except when your mum is cross.", 0.95, 0.98],
  ["fact", "hiyori", "You're building a desktop companion app with a friend, split into the body and the brain.", 0.85, 0.92],
  ["fact", "hiyori", "You drink your chai with extra ginger and no sugar.", 0.55, 0.9, "joy"],
  ["fact", "hiyori", "Your sister's birthday is on 14 December.", 0.9, 0.86],
  ["fact", "hiyori", "You prefer dark mode after sunset but light mode while working.", 0.3, 0.64],
  ["fact", "hiyori", "आपको बारिश में पुराने हिंदी गाने सुनना पसंद है।", 0.5, 0.81, "joy"],
  ["fact", "hiyori", "You have a cat called Mochi who knocks pens off the desk.", 0.7, 0.95, "fun"],
  ["fact", "hiyori", "You run on Sunday mornings, usually 5 km by the lake.", 0.45, 0.72],
  ["fact", "hiyori", "You might be allergic to peanuts — you mentioned it once, unsure.", 0.6, 0.38],
  ["episode", "hiyori", "You were nervous before the Thursday demo; she reminded you to breathe and you nailed it.", 0.8, 0.9, "joy"],
  ["episode", "hiyori", "Late-night debugging session: the lip-sync drifted 40 ms and you found it was the analyser node.", 0.6, 0.88, "thinking"],
  ["episode", "hiyori", "You two argued playfully about whether pineapple belongs on pizza. She lost.", 0.25, 0.97, "teasing"],
  ["episode", "hiyori", "You told her about your trip to Rishikesh and the rafting accident that wasn't.", 0.5, 0.84, "surprised"],
  ["episode", "hiyori", "Mochi walked across the keyboard mid-sentence and sent half a message.", 0.2, 0.99, "fun"],
  ["self", "hiyori", "She gets shy when you compliment her drawings.", 0.6, 0.75, "shy"],
  ["self", "hiyori", "She likes to end long explanations with a tiny joke.", 0.4, 0.7],
  ["self", "hiyori", "She promised to remind you about water breaks every two hours.", 0.75, 0.9],
  ["summary", "hiyori", "Week of 16 Nov: mostly work on the stage renderer, one stressful demo, two evenings of music talk.", 0.7, 0.85],
  ["summary", "hiyori", "Week of 9 Nov: planning the app split, talked about your sister's wedding preparations.", 0.65, 0.8],
  ["fact", "makima", "You take your coffee black. She approves.", 0.4, 0.9],
  ["fact", "makima", "You asked her not to bring up work after 10 pm.", 0.85, 0.95],
  ["episode", "makima", "She beat you at chess in 23 moves and didn't let you forget it.", 0.35, 0.97, "teasing"],
  ["self", "makima", "She prefers short answers unless you ask for more.", 0.5, 0.8],
  ["fact", "reze", "You're learning to swim this winter.", 0.55, 0.88],
  ["episode", "reze", "Café talk about summer festivals and fireworks over the river.", 0.45, 0.9, "joy"],
];

const TOPICS = ["the new hotkey", "Mochi's vet visit", "monsoon plans", "a Hindi poem", "the VRM import", "your favourite ramen",
  "an old college friend", "the Tauri update", "weekend cricket", "a sci-fi novel", "the voice training plan", "your morning routine",
  "the trip to Jaipur", "a bug in the tray menu", "late-night snacks", "the rain sounds playlist", "a podcast on memory", "Diwali lights",
  "a broken headphone cable", "the sunrise run", "coffee vs chai", "a movie night", "the plant on your desk", "the panic hotkey",
  "a museum visit", "the pixel art idea", "your sister's playlist", "the stage transparency bug", "a quiz night", "the cat's new toy"];

export function sampleMemories(now: number, main = "hiyori"): MemoryItem[] {
  const items: MemoryItem[] = SAMPLES.map(([kind, ns, text, importance, confidence, emotion], i) => ({
    id: `mem-${i + 1}`, kind, namespace: ns === "hiyori" ? main : ns, text, importance, confidence, emotion,
    createdAt: now - (i * 7 + 2) * H - (i % 3) * D, sourceTurnId: `turn-${100 + i}`,
  }));
  // Enough everyday episodes that the list pages.
  TOPICS.forEach((t, i) => items.push({
    id: `mem-ep-${i + 1}`, kind: "episode", namespace: main, text: `You chatted about ${t}.`,
    importance: 0.15 + ((i * 37) % 50) / 100, confidence: 0.7 + ((i * 13) % 30) / 100, createdAt: now - (i + 2) * D - 5 * H,
  }));
  return items;
}

export class FakeMemoryCore {
  items: MemoryItem[];
  /** Make the next edit or delete fail (to see the rollback). */
  failNext = false;

  /** `main` is the character most samples belong to (the preview's active character). */
  constructor(now = Date.now(), main = "hiyori") {
    this.items = sampleMemories(now, main);
  }

  query(q: MemoryQuery): PayloadMap["memory.results"] {
    const needle = q.q?.toLowerCase();
    const hits = this.items
      .filter((i) => (!q.kind || i.kind === q.kind) && (!q.namespace || i.namespace === q.namespace) && (!needle || i.text.toLowerCase().includes(needle)))
      .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0) || a.id.localeCompare(b.id));
    const offset = q.offset ?? 0;
    return { items: hits.slice(offset, offset + (q.limit ?? 40)), total: hits.length };
  }

  /** What the core would send back for a message from the UI. */
  handle<T extends MessageType>(type: T, payload: PayloadMap[T]): Reply[] {
    if (type === "memory.query") return [{ type: "memory.results", payload: this.query(payload as MemoryQuery) }];
    if (type === "memory.upsert" || type === "memory.delete") {
      if (this.failNext) {
        this.failNext = false;
        return [{ type: "error", payload: { code: `${type.replace(".", "_")}_failed`, message: "The memory store is locked (simulated failure).", recoverable: true } }];
      }
      if (type === "memory.upsert") {
        const item = payload as MemoryItem;
        this.items = this.items.some((i) => i.id === item.id) ? this.items.map((i) => (i.id === item.id ? item : i)) : [item, ...this.items];
      } else {
        const gone = new Set((payload as PayloadMap["memory.delete"]).ids);
        this.items = this.items.filter((i) => !gone.has(i.id));
      }
    }
    return [];
  }
}
