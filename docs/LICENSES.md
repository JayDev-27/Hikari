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
| Authored Cubism rigs, textures and motions (`characters/{makima,reze,rize,lu-guang,cheng-xiaoshi}/model/`) | Hikari rigs and illustrations based on official character sheets | Underlying franchise designs belong to their respective rights holders | See each pack’s source | committed |
| Hikari logo / app icon (`assets/brand/`) | artwork supplied for Hikari | — | — | committed |

Makima, Reze, Rize Kamishiro, Lu Guang and Cheng Xiaoshi use AI-generated fan illustrations with separately edited blink and speech frames. The franchise character designs belong to their respective rights holders. Each pack records its visual reference. [Link Click character sheets](https://link-click.jp/1st/character/) · [Chainsaw Man character sheets](https://chainsawman.dog/movie_reze/character/) · [Rize Kamishiro character sheet](https://www.marv.jp/special/tokyoghoul/first/chara_03.html)

The authored runtime models were exported with the MIT-licensed Stretchy Studio MOC3 writer at revision `24a83a2`. [Stretchy Studio exporter](https://github.com/MangoLion/stretchystudio/tree/24a83a27ba43e43e9d2e3de5e33994594e6199c2/src/io/live2d)
