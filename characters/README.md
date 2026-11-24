# Character packs

Each character lives in `characters/<id>/`:

```
character.json   # committed
persona.md       # committed (M2)
model/           # authored Cubism exports for Makima, Reze, Rize, Lu Guang and Cheng Xiaoshi. Sample models are fetched separately.
```

## `character.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | folder name |
| `displayName` | string | |
| `renderer` | `"live2d"` \| `"vrm"` | |
| `modelPath` | string \| null | relative to the pack; `null` = empty slot ("Import your own model for this character") |
| `scale` | number? | fit multiplier |
| `gazeScale` | number? | amplitude of cursor tracking, with 1 as the default |
| `speech` | object? | supplies a default emotion, fallback motions, per-emotion motions and the interval between gestures during speech |
| `signatureMotions` | string[]? | motion-map names cycled during idle time on stage and on click in Studio |
| `expressionMap` | `{ [emotion]: expressionName \| index }` | emotions from the protocol `Emotion` enum |
| `motionMap` | `{ [gestureTag \| "idle" \| "tap" \| "tap_<area>"]: { group, index? } }` | gesture tags from protocol `GestureTag` |
| `hitAreas` | `{ [modelHitAreaName]: "head" \| "body" \| … }` | |
| `persona` | string | path to persona.md |
| `voice` | `{ engine, voiceId?, clonePath?, rvcModel? }` | |
| `defaultLanguage` | `"en"` \| `"hi"` \| `"hinglish"` | |
| `license` | `{ source, terms, url, credit? }` | shown on import and in About |
| `importSlot` | boolean? | accepts a custom replacement for this character |
| `imported` | boolean? | written by an import (user pack in the app data folder) |

Persona files follow [`PERSONA_FORMAT.md`](PERSONA_FORMAT.md). Imported packs live in `~/Library/Application Support/com.hikari.companion/characters/<id>/` and override a built-in pack with the same id.

Makima, Reze, Rize, Lu Guang and Cheng Xiaoshi have built-in Live2D models with physics, expressions and gesture motions. Removing an imported replacement restores the built-in rig.

## Checking and fixing a Live2D rig

Run from the repo root (the audit needs Cubism Core in `apps/desktop/public/live2d/`, see the main README):

```bash
node apps/desktop/scripts/sync-packs.mjs   # copy packs into public/characters (pnpm dev/build do this already)
pnpm -F desktop audit:models            # 0 errors expected; warnings are advisory (-v adds notes)
pnpm -F desktop fix:models --dry        # what the fixer would change (swing caps, lids, Breath, motions, cdi3)
pnpm -F desktop fix:models reze         # apply to one rig; originals are kept in characters/reze/source/original-model/
```

The audit is calibrated on the official Hiyori/Haru/Mao samples, so it only reports things they don't do. The fixer only edits numbers in place (no structural changes); anything that needs new layers or deformers (separate irises, lashes, hair strands, ears, a real neck) has to be done in a Cubism editor from layered art. The same checks run on every installed pack in `pnpm -F desktop test`.
