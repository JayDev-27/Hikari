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

Franchise personas (Reze, Makima, Rize) ship with `"modelPath": null`. Never add ripped or fan-extracted models.
