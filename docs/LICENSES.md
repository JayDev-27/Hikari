# Third-party models & assets

Nothing in this table is committed to git unless marked "committed".

| Asset | Source | Licence / terms | Obligations | Status |
|---|---|---|---|---|
| Live2D Cubism Core for Web | Cubism SDK for Web 5-r.5 zip (user downloads from live2d.com) | Live2D Proprietary Software License | Ship only files in `RedistributableFiles.txt`, inside the app; pass PSLA-equivalent terms to end users (EULA/About); never in repo; SDK Release License needed if publisher ≥ ¥10M/yr | fetched by `pnpm fetch:assets --sdk …` |
| Hiyori (Live2D sample) | github.com/Live2D/CubismWebSamples | Free Material License (Original Character) | Credit "This content uses sample data owned and copyrighted by Live2D Inc."; no design changes; commercial only < ¥10M; no sexual/violent/political content; no sample sounds | fetched |
| Haru (Live2D sample) | same | Free Material License | Credit; < ¥10M; no sample sounds | fetched |
| VRM1_Constraint_Twist_Sample | github.com/vrm-c/vrm-specification | VRM Public License 1.0 (redistribution + corporate OK) | Credit "(c) 2022 pixiv Inc." | M3 |
| Seed-san | github.com/vrm-c/vrm-specification | VRM Public License 1.0 | Credit required: "Seed-san model by VirtualCast, Inc." | M3 |
| Hima TTS Nano (`Prahaladha/hima-tts-nano-hi`) | Hugging Face | **`other`, no licence text — all rights reserved** | Do not ship until the author grants a licence | B, prototype only |
| Hima-ASR (`Prahaladha/hima-asr-mlx-*`) | Hugging Face | Apache-2.0 + Gemma terms | Pass on Gemma prohibited-use policy | B |
| Character packs (`characters/*/character.json`, persona.md) | this repo | project licence | — | committed |

Franchise personas (Reze, Makima, Rize Kamishiro) ship as **persona text + empty model slot** only. No fan-ripped models, art, or voice-actor audio, ever.
