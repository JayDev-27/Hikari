# Character packs

Each character lives in `characters/<id>/`:

```
character.json   # committed
persona.md       # committed (M2)
model/           # NOT committed — fetched (samples) or imported by the user
```

## `character.json`

| Field | Type | Notes |
|---|---|---|
| `id` | string | folder name |
| `displayName` | string | |
| `renderer` | `"live2d"` \| `"vrm"` | |
| `modelPath` | string \| null | relative to the pack; `null` = empty slot ("Import your own model for this character") |
| `scale` | number? | fit multiplier |
| `expressionMap` | `{ [emotion]: expressionName \| index }` | emotions from the protocol `Emotion` enum |
| `motionMap` | `{ [gestureTag \| "idle" \| "tap" \| "tap_<area>"]: { group, index? } }` | gesture tags from protocol `GestureTag` |
| `hitAreas` | `{ [modelHitAreaName]: "head" \| "body" \| … }` | |
| `persona` | string | path to persona.md |
| `voice` | `{ engine, voiceId?, clonePath?, rvcModel? }` | |
| `defaultLanguage` | `"en"` \| `"hi"` \| `"hinglish"` | |
| `license` | `{ source, terms, url, credit? }` | shown on import and in About |
| `importSlot` | boolean? | ships without a model (franchise presets) |
| `imported` | boolean? | written by an import (user pack in the app data folder) |

Persona files follow [`PERSONA_FORMAT.md`](PERSONA_FORMAT.md). Imported packs live in `~/Library/Application Support/com.hikari.companion/characters/<id>/` and override a built-in pack with the same id.

Franchise personas (Reze, Makima, Rize) ship with `"modelPath": null`. Never add ripped or fan-extracted models.
