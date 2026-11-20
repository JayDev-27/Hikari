# 03 — Speech stack (STT, VAD/turn, TTS, voice conversion, eval, AEC)

Researched 2026-11-20 from HF model cards, the HF API, GitHub READMEs and PyPI. "Card" means the claim comes from the
model card and has not been checked independently. Nothing below was benchmarked on our own M2/M3 hardware: every
latency is the publisher's number (usually M4 Pro) or is marked **est.** The first item in the Hikari bench is
measuring these on the M2 16GB and the M3 8GB.

Budget reminder: 1.2 s from end of speech to first audio = VAD hangover / turn decision (~200–300 ms) + STT final
(~100–250 ms) + LLM first sentence (~400–600 ms) + TTS first chunk (~100–250 ms).

---

## 1. STT

### Findings
- **Hima-ASR (`Prahaladha/hima-asr`) exists and is the strongest local Hindi/Hinglish option.** It has 0.46B params
  (the `full-vocab` branch has 0.59B) and covers 11 Indic languages plus English. Its encoder starts from
  Qwen3-ASR-1.7B and its text writer from Gemma-3-270M. It ships MLX builds: `-mlx` fp16 (1.0 GB), `-mlx-8bit` (536 MB)
  and `-mlx-4bit` (379 MB), plus ONNX fp32/int8/q4. The card reports **73x real time for MLX 8/4-bit on an M4 Pro**.
  - `style="mixed"` writes English words in Latin letters and Hindi in Devanagari, which is the right format for Hinglish
    sent to an LLM.
  - A 17.5M "decision head" answers questions about emotion, intent and urgency from the same listen.
  - Input is 16 kHz, 1–30 s clips. There is no streaming decoder.
  - Hindi WER (card): FLEURS 5.7, Kathbath 3.4, Lahaja 8.8, Monsoon (conversational) 11.1, Gram Vaani 17.2.
    English: Svarah (Indian accent) 11.4.
- **The `Prahaladha-Reddy/hima` repo you named is on GitHub, not HF.** The HF URL returns 401. It holds the Apache-2.0
  **training code** for Hima-ASR (`src/`, `configs/`, `scripts/transcribe.py`). The checkpoints live under the HF user
  `Prahaladha`.
  - **Hima-ASR licence** (`license_name: apache-2.0-and-gemma`, NOTICE): Hima's own parts and the Qwen3-ASR-derived
    encoder are Apache-2.0. The writer is a **Gemma Model Derivative**, so the Gemma Terms of Use and the Prohibited Use
    Policy (§3.2) pass through to anyone who uses or redistributes it. Commercial use is allowed; the use restrictions
    have to be passed on to users.
- **`mlx-whisper` 0.4.3 (MIT)** with `mlx-community/whisper-large-v3-turbo` is the general multilingual fallback.
  - Repo sizes from the HF API: fp16 1.6 GB, `-8bit` 864 MB, `-4bit` / `-q4` 464 MB, `whisper-small-mlx` 481 MB,
    `whisper-small-mlx-q4` 197 MB.
  - Published speed: about 50x real time on an M2 Ultra (Awni Hannun via S. Willison), and about 2x faster than
    whisper.cpp. I found no M2-base number.
  - Whisper tends to answer Hinglish in Urdu script or translate it into English; see the baseline outputs on the
    Oriserve cards. `distil-whisper` is English-only and of no use here.
- **Oriserve Whisper-Hindi2Hinglish (all Apache-2.0)** outputs **romanized** Hinglish ("Mehnat to poora karte hain").
  Their WER is scored against romanized references, so it cannot be compared with Devanagari WER.
  - **Prime**: base whisper-large-v3, 6.2 GB repo. FLEURS 28.7, CV20 32.4, Indic-Voices 60.8.
  - **Apex**: base large-v3-turbo, 1.6 GB. FLEURS 29.8, CV 36.0, Indic-Voices 47.6.
  - **Swift**: base whisper-base, 0.3 GB. FLEURS 35.1, CV 38.7, IV 65.2.
  - None has an MLX build. Converting with mlx-whisper's `convert.py` should work (same architecture), but I have not
    verified it.
- **`nitinh/whisperkit-hinglish-coreml`** (Apache-2.0) is Hinglish-Prime converted to CoreML for WhisperKit, with 4-bit
  palettization (2.9 GB → **889 MB**) and no retraining.
  - WhisperKit (argmax, MIT) is Swift-only and needs macOS 14+. It ships `whisperkit-cli` (Homebrew) and an "Argmax
    Local Server" for non-native apps, which is how Python would call it.
  - It is useful if we want ANE offload so the GPU stays free for the LLM.
- **`lightning-whisper-mlx` 0.0.10** has had no release since 2024 and has no licence metadata on PyPI. Rejected.
- **`parakeet-mlx` 0.7.0**: Parakeet v2 is English-only and v3 covers 25 European languages. **No Hindi.** Rejected.
- mlx-audio (now `Neywa-Labs/mlx-audio`, PyPI 0.6.7) also lists Qwen3-ASR, Voxtral Realtime and Nemotron 3.5 ASR. I
  have not checked their Hindi quality; Hima-ASR is a fine-tune of Qwen3-ASR for exactly this use.

### STT table
| Option | Repo id | Licence | Apple silicon | RAM / disk | Speed (published) | Decision |
|---|---|---|---|---|---|---|
| Hima-ASR MLX 4-bit | `Prahaladha/hima-asr-mlx-4bit` | Apache-2.0 + Gemma ToU | MLX GPU | 379 MB | 73x RT, M4 Pro | **Chosen: Lite** |
| Hima-ASR MLX 8-bit | `Prahaladha/hima-asr-mlx-8bit` | Apache-2.0 + Gemma ToU | MLX GPU | 536 MB | 73x RT, M4 Pro | **Chosen: Standard** |
| Hima-ASR fp16 | `Prahaladha/hima-asr-mlx` | same | MLX | 1.0 GB | 63x RT | Max (or 8-bit) |
| Hima-ASR ONNX q4 | `Prahaladha/hima-asr-ONNX` | same | CPU ORT | 360 MB | 31x RT, CPU | Fallback when GPU is busy |
| Whisper-turbo MLX 4-bit | `mlx-community/whisper-large-v3-turbo-4bit` | MIT (OpenAI) / repo apache-2.0 | MLX | 464 MB | ~50x RT, M2 Ultra | Fallback for languages outside Hima's 12 |
| Hinglish-Apex | `Oriserve/Whisper-Hindi2Hinglish-Apex` | Apache-2.0 | needs MLX conversion | 1.6 GB fp16 | — | Rejected: romanized only, no MLX |
| Hinglish-Prime (CoreML) | `nitinh/whisperkit-hinglish-coreml` | Apache-2.0 | ANE/GPU via WhisperKit | 889 MB | not published | Optional Max experiment (ANE offload) |
| Hinglish-Swift | `Oriserve/Whisper-Hindi2Hinglish-Swift` | Apache-2.0 | — | 0.3 GB | — | Rejected: weak WER |
| whisper-small q4 | `mlx-community/whisper-small-mlx-q4` | MIT | MLX | 197 MB | — | Rejected: Hindi too weak given Hima q4 is 379 MB |
| parakeet-mlx | `mlx-community/parakeet-tdt-0.6b-v3` | CC-BY-4.0 | MLX | 2.5 GB | — | Rejected: no Hindi |
| lightning-whisper-mlx | PyPI 0.0.10 | unclear | MLX | — | — | Rejected: unmaintained |

### Streaming strategy
Hima-ASR decodes whole clips, so we use VAD-segmented utterances. Because it runs at 73x real time, a 5 s utterance
should decode in roughly 70 ms on an M4 Pro and **~150–200 ms on an M2 (est.)**. To hide that time, we re-transcribe
the growing buffer about every 1 s while the user is still speaking. That gives partial text for the turn model and
lets the LLM prefetch.

---

## 2. VAD and end-of-turn

| Option | Repo / version | Licence | Runtime | Size | Hindi | Decision |
|---|---|---|---|---|---|---|
| Silero VAD | `silero-vad` 6.2.3 (PyPI; v6 line) / `onnx-community/silero-vad` | MIT (LICENSE file) | ONNX CPU; also `mlx-community/silero-vad` | ~2 MB | language-agnostic | **Chosen, all profiles** |
| Pipecat Smart Turn v3.2 | `pipecat-ai/smart-turn-v3` → `smart-turn-v3.2-cpu.onnx` | BSD-2-Clause | ONNX CPU (int8, 8.7 MB) | 8M params, Whisper-tiny encoder | Hindi acc 90.1%, FPR 8.6%, FNR 1.3% (v3.2 CPU bench) | **Chosen, all profiles** |
| LiveKit turn-detector (multilingual) | `livekit/turn-detector` (Qwen2.5-0.5B, ONNX q8) | **LiveKit Model License** | CPU | <500 MB RAM | Hindi TPR 99.4% / TNR 96.3% | **Rejected: licence** |
| Hima-ASR decision head | `decide/` in hima-asr | Apache + Gemma | shares the ASR pass | 17.5M | yes | Experimental: a yes/no "finished speaking?" question is possible, but end-of-turn support is still listed as planned |

- **LiveKit licence text (§3.b):** "not to use any LiveKit Models on a standalone basis or with any frameworks other
  than LiveKit Agents". It also forbids using its outputs to train other models. It is usable only if Hikari is built on
  LiveKit Agents, which it is not.
- **Smart Turn** works on raw audio (up to the last 8 s, 16 kHz), not on the transcript, so it handles code-switching
  without depending on the ASR. The blog reports about 12 ms per inference on CPU.
- **Pipeline:**
  1. Silero detects silence for 200 ms.
  2. Smart Turn scores the turn. If the probability is above 0.5, the turn ends.
  3. Otherwise wait for more speech, and force an end-of-turn after about 1.5 s of silence.

---

## 3. TTS

### Hima TTS Nano: verified facts (`Prahaladha/hima-tts-nano-hi`)
- **Size and format:** 61.9M params, F32 safetensors, **24 kHz** mono. Hindi in Devanagari, with English words allowed
  in Latin script (the card's examples are Hinglish). A Telugu sibling exists (`-te`).
- **Architecture** (config.yaml + files): an autoregressive transformer (d_model 576) that predicts continuous latents
  at 12.5 Hz through a flow-matching head (4 steps). The audio decoder is the **Kyutai Mimi** codec. The speaker
  conditioning slot is 192-dim (`spk_dim`, ECAPA-sized). Defaults: guidance 1.25, temperature 0.3.
- **Voices:** six built-in voices (Meera, Sneha, Nandini female; Siddharth, Ishaan, Nikhil male). They come from
  `voices/adapter.safetensors` plus `voices/voices.safetensors` and `voices.json`.
  - **Zero-shot clone** from 5–10 s of WAV (needs `speechbrain`).
  - Random voices by seed.
  - **Saved voices** as `.safetensors` (`make_voice(...)`, `--save-voice`). The card says they are portable across the
    PyTorch, ONNX and MLX builds.
- **Builds and published speed (M4 Pro):**
  | Build | Speed |
  |---|---|
  | PyTorch CPU | 6x RT |
  | `-ONNX` | 10x RT; 15x with int8 (int8 has CER 3.1%) |
  | `-mlx-fp16` | 29x RT; 70x batched |
  | `-mlx-8bit` | 50x batched |
- **Quality:** CER is 3.3% (Sarvam saaras v4 as judge) and 4.1% (Hima-ASR as judge) on 1,202 Hindi sentences.
- **Streaming:** none. Text is split at sentence ends and synthesised one sentence at a time.
  - The card has no emotion or style control; only seed and voice choice.
  - There are no phoneme or word timings.
  - **Est.** first audio on an M2 for a short first sentence (~2 s of audio) at 29x RT ÷ ~2.5 (M2 vs M4 Pro) is about
    **150–250 ms**. That is acceptable if the LLM output is cut into short first clauses.
- **Fine-tuning and adapter code:** in **`github.com/Prahaladha-Reddy/hima-finetune`** (code licence MIT).
  - It trains a LoRA-style adapter of about 5M parameters on the frozen base, using 30–45 min of clean single-speaker
    audio per voice.
  - It runs on one free Colab/Kaggle T4, about 5.4 min per 40-min voice.
  - Steps: `get` → `prepare` → `train` → `export`, plus an optional `transcribe` (with Hima-ASR) and `distill` (with
    Maya 2 Native, which needs an L4/A100).
  - Output: `voices/adapter.safetensors` plus voice prints.
  - **This is the path to a custom "Hikari" voice without RVC.**
- **LICENCE: unresolved.** The model card front-matter says only `license: other`, with **no licence name, no link, no
  LICENSE file in the repo, and no terms text anywhere on the card**. The same holds for the `-ONNX`, `-mlx-fp16` and
  `-mlx-8bit` repos.
  - The only licence file is `hima_tts/codec/LICENSE`, which is MIT text for the Mimi codec code.
  - hima-finetune's README says Hima TTS has "its own licence: see the model card", but the card has none.
  - Distilled data inherits Mimi's **CC-BY-4.0** (attribution) and Wikipedia's CC BY-SA.
  - Legally, no grant means all rights are reserved. **Use it for local prototyping only. Ask the author (HF
    discussion on the repo) for an explicit licence before shipping or redistributing weights or adapters.** Keep a
    licensed fallback wired in.

### Alternatives
| Option | Repo id | Licence | Hindi / Hinglish | Apple silicon | Size | Streaming / first audio | Clone | Emotion | Decision |
|---|---|---|---|---|---|---|---|---|---|
| **Hima TTS Nano** | `Prahaladha/hima-tts-nano-hi-mlx-8bit` / `-mlx-fp16` / `-ONNX` | **"other", no terms** | native Hi + Latin English | MLX + ONNX | ~250 MB fp32 base; 8-bit smaller | sentence-level; est. 150–250 ms on M2 | 5–10 s zero-shot + adapters | none | **Chosen: Lite & Standard (pending licence)** |
| **Maya 2 Native** | `maya-research/maya2-native`; MLX: `aruntemme/maya2-native-mlx-8bit` (community, 3.3 GB) | **Apache-2.0** (Mimi CC-BY-4.0) | 11 Indic + En; code-mix CER 3.5–4.1% (v2 scorer) | mlx-audio `maya2` (stream=True, 0.32 s chunks) | 2.5B; 5 GB bf16 / 3.1 GB 8-bit | true streaming, 80 ms frames; TTFA p50 111 ms **on an NVIDIA GPU**; Mac not measured | zero-shot `icl_spk` + ECAPA | `[laughs]`, `[sighs]`, `[whispers]`, `[sad]`, `[excited]` (best effort) | **Chosen: Max; licensed fallback on Standard** |
| Chatterbox Multilingual V3 | `ResembleAI/chatterbox`; MLX `mlx-community/chatterbox-multilingual-v3` (2.7 GB) | MIT (outputs watermarked by Perth) | Hindi among 23; Hindi single-language pack; Indic LoRA `reenigne314/chatterbox-indic-lora` | mlx-audio | 0.5B | streaming not stated in mlx-audio | yes | exaggeration knob | Shortlist: best emotion control under MIT; Hinglish quality unverified |
| Kokoro-82M | `mlx-community/Kokoro-82M-4bit` / `hexgrad/Kokoro-82M` | Apache-2.0 | Hindi 2F/2M via espeak-ng G2P; weak code-switch | mlx-audio | 82M | very fast | no | no | Rejected for Hindi; **only option here with word timestamps (KPipeline, English path)** |
| IndicF5 | `ai4bharat/IndicF5` (gated) | MIT per card | 11 Indic | PyTorch (MPS) only | ~1.4 GB | non-streaming flow-matching, multi-step | yes (ref clip + text) | via reference | Rejected: latency |
| Indic Parler-TTS | `ai4bharat/indic-parler-tts` (gated) | Apache-2.0 | 18 Indic + En | PyTorch only | ~0.9B | slow AR | no | text-described style | Rejected: speed, no clone |
| Svara-TTS / Orpheus-hi | `kenpath/svara-tts-v1`, `canopylabs/3b-hi-ft-research_release` | Apache-2.0 | Indic / Hindi | GGUF/MLX community only | 3B | AR SNAC | limited | tags | Rejected: 3B for no gain over Maya |
| rumik-oss 1 | `rumik-ai/rumik-oss-1-mlx-4bit` | **CC-BY-NC-4.0** | 22 Indic + En, expressive | mlx-audio | 3B (1.9 GB q4) | — | — | description + vocalizations | Rejected: non-commercial |
| OmniVoice | `k2-fsa/OmniVoice`, `mlx-community/OmniVoice-bf16` | code Apache-2.0, **weights CC-BY-NC** | 646 langs incl. hi | mlx-audio | ~0.6B | RTF 0.025, non-AR | yes | nonverbal tags | Rejected: NC |
| XTTS-v2 | `coqui/XTTS-v2` | **CPML** (non-commercial; Coqui defunct) | hi | PyTorch | 2 GB | streaming | yes | via ref | Rejected: licence, abandoned |
| MOSS-TTS-Nano | `mlx-community/MOSS-TTS-Nano-100M` | Apache-2.0 | **no Hindi** (20 langs) | mlx-audio | 0.1B | streaming | yes | — | Rejected |
| Qwen3-TTS | `Qwen/Qwen3-TTS-12Hz-0.6B-Base` | Apache-2.0 | **no Hindi** (10 langs) | mlx-audio (streaming) | 0.6/1.7B | streaming | yes | voice design | Rejected for Hindi; keep for English persona tests |
| CosyVoice 3 | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` | Apache-2.0 | **no Hindi** (9 langs) | PyTorch | 0.5B | streaming | yes | instruct | Rejected |
| GPT-SoVITS | `RVC-Boss/GPT-SoVITS` (GitHub) | MIT | zh/en/ja/ko/yue only | PyTorch | — | — | few-shot | — | Rejected: no Hindi |

- **mlx-audio TTS models with Indic support:** Kokoro (hi), Maya2 Native, rumik-oss-1, OmniVoice and Chatterbox v3.
  Hima, IndicF5, CosyVoice and Orpheus are not in mlx-audio; Hima has its own MLX package.
- **Timings:** only Kokoro gives word timestamps natively. For mouth movement and captions on Hima or Maya, either
  - derive visemes from audio energy, or
  - run a forced aligner on the TTS output (mlx-audio has `Qwen3-ForcedAligner`; its Hindi coverage is not verified).

---

## 4. RVC vs. TTS fine-tune

### Findings
- **RVC on Mac:**
  - Applio (MIT; installs on macOS via `run-install.sh`) and `rvc-python` 0.1.5 run on PyTorch MPS. Forum reports show
    MPS op errors.
  - MLX pieces exist: `lexandstuff/rvc-mlx-weights` (MIT; v2 f0G 32/40/48k, about 110 MB each) and `mlx-contentvec`
    0.1.1. Their README points to `lucasnewman/rvc-mlx`, which now returns **404**, and mlx-contentvec says the full
    RVC-MLX pipeline is "coming soon". **No working MLX RVC pipeline and no published Mac latency.**
  - Expect a ContentVec + RMVPE + synth chunk to add 100–300 ms (est.) and roughly 400–600 MB RAM.
- **Seed-VC** (`Plachta/Seed-VC`, **GPL-3.0**):
  - Real-time mode reports about 300 ms algorithm delay plus about 100 ms device delay on an RTX 3060-laptop class GPU
    (430 ms in one config). The README strongly recommends a GPU.
  - Zero-shot, no training needed.
  - Rejected: GPL is incompatible with distribution, and the delay is too high.
- **Trade-off:**
  - Neutral TTS → RVC doubles the work (two models, two windows of latency), smears prosody and Hinglish phonetics, and
    adds artefacts at chunk joins.
  - A **Hima adapter fine-tune** (hima-finetune, about 5M params, 30–45 min of data, a T4 for about 5 min) or a
    **Maya clone or fine-tune** puts the identity in a single pass at zero added latency.
- **Decision:**
  - Use TTS adapters or clones for the Hikari voice. **Do not use RVC in the live loop.**
  - RVC is only acceptable **offline**, to convert a licensed source voice into training data for the adapter.
  - Get the speaker's consent and keep licence records for any voice.

| Option | Licence | Apple silicon | Added latency | Decision |
|---|---|---|---|---|
| Hima adapter (`hima-finetune`) | code MIT; base licence unresolved | adapter runs in MLX/ONNX | 0 | **Chosen** |
| Maya 2 clone (`icl_spk`) | Apache-2.0 | mlx-audio | 0 | Chosen (Max / fallback) |
| Applio / rvc-python | MIT | MPS (fragile) | 100–300 ms est. | Rejected live; offline data tool only |
| rvc-mlx | MIT weights | pipeline repo missing | unknown | Rejected (immature) |
| Seed-VC | GPL-3.0 | MPS untested | ~400 ms (GPU) | Rejected |

---

## 5. Voice evaluation harness (offline, run in CI on TTS changes)

| Metric | Tool / repo | Licence | Notes |
|---|---|---|---|
| Speaker similarity | `speechbrain/spkrec-ecapa-voxceleb` | Apache-2.0 | cosine of ECAPA embeddings, reference vs. output; already a dependency of Hima clone and Maya. Target ≥0.75 for own-voice adapters (tune on our data) |
| Speaker similarity (second opinion) | `Wespeaker/wespeaker-voxceleb-resnet34-LM` (code Apache-2.0) | **CC-BY-4.0** weights | catches ECAPA blind spots |
| Naturalness | UTMOSv2 (`sarulab-speech/UTMOSv2`, VoiceMOS 2024 T05) | MIT | trained mostly on English and Japanese, so on Hindi use it only as a relative score |
| Intelligibility | CER via **Hima-ASR** (`style="mixed"`) + whisper-large-v3-turbo as a second judge | see §1 | follows the Hima and Maya cards' ASR-judge method; normalise Latin ↔ Devanagari for code-mixed words or CER is inflated (Maya shows 10.6% → 3.5%) |
| Latency | own harness | — | TTFA p50/p95, RTF, peak RSS per profile |

Test set: about 200 Hinglish companion lines. Mix short replies, numbers, English brand names and emotional lines.

---

## 6. Echo cancellation for barge-in (macOS)

- **WKWebView getUserMedia:** available through `WKUIDelegate requestMediaCapturePermissionFor` (macOS 12+ per Apple
  docs). Safari/WebKit on macOS enables `echoCancellation` by default, according to an Apple engineer on the developer
  forums. Known WebKit bugs: changes in channel count when AEC is toggled (bug 281978; Safari 26 forum thread).
  **Caveat:** the canceller only has a reference for audio played *by that same WebKit pipeline*. If Python plays TTS
  through CoreAudio directly, the WebView AEC will not remove it.
- **VoiceProcessingIO** (`kAudioUnitSubType_VoiceProcessingIO` / `AVAudioEngine.inputNode.setVoiceProcessingEnabled(true)`):
  Apple's system AEC, noise suppression and AGC. It is the most robust option, but it needs a Swift/ObjC helper, and
  playback must go through the same engine.
- **WebRTC APM in Python:** `livekit` rtc SDK (Apache-2.0; the restrictive licence covers only the turn-detector
  *model*). `rtc.AudioProcessingModule(echo_cancellation=True, noise_suppression=True, high_pass_filter=True,
  auto_gain_control=True)` runs AEC3.
  - It needs 10 ms frames, processes them in place, and needs `set_stream_delay_ms`.
  - We own the TTS stream, so we feed it as the render reference.
  - It is weak with long or variable delay paths, such as Bluetooth.
- **Decision:**
  1. **Standard/Max:** use a native Swift audio helper with VoiceProcessingIO that does both capture and TTS playback, and
     streams 16 kHz mic PCM to Python over a local socket.
  2. **Fallback:** if the UI captures audio, play TTS through WebAudio in the same WebView with `echoCancellation: true`.
  3. **Lite / no helper:** use LiveKit APM in Python with the TTS PCM as reference.
- **For all modes:** barge-in triggers on Silero speech for at least 250 ms *after* AEC. Duck TTS at once, then cut it
  off after Smart Turn or ASR confirms the user is speaking. With headphones detected, AEC can be off.

---

## 7. Picks per hardware profile

| Stage | Lite (M3 8 GB, ≤2.5 GB speech+LLM budget) | Standard (M2 16 GB) | Max (≥32 GB / M-Pro/Max) |
|---|---|---|---|
| VAD | Silero VAD 6.x ONNX (~2 MB) | same | same |
| Turn | Smart Turn v3.2 CPU ONNX (8.7 MB) | same | same + Hima decision-head experiment |
| STT | `Prahaladha/hima-asr-mlx-4bit` (379 MB) or `-ONNX` q4 on CPU to free the GPU | `Prahaladha/hima-asr-mlx-8bit` (536 MB) | `Prahaladha/hima-asr-mlx-8bit` or fp16; optional WhisperKit Hinglish-Prime on the ANE |
| STT fallback | — | `mlx-community/whisper-large-v3-turbo-4bit` (on demand, other languages) | `…-turbo-8bit` |
| TTS | `Prahaladha/hima-tts-nano-hi-ONNX` int8 (CPU, keeps the GPU for the LLM) | `Prahaladha/hima-tts-nano-hi-mlx-fp16` + Hikari adapter | `maya-research/maya2-native` via mlx-audio (8-bit, streaming, emotion tags); Hima as low-latency path |
| TTS licensed fallback | Kokoro-82M hi (Apache) | `aruntemme/maya2-native-mlx-8bit` (3.1 GB, Apache) or Chatterbox MV3 (MIT) | Chatterbox MV3 |
| AEC | LiveKit APM (Python) | Swift VoiceProcessingIO helper | same |
| Eval | ECAPA + UTMOSv2 + Hima/Whisper CER | same | same + WeSpeaker |

Estimated speech RAM: Lite about 0.7 GB (ASR q4 + TTS int8 + VAD/turn). Standard about 1.0 GB. Max about 4.5 GB with
Maya 8-bit. Maya on a 16 GB machine running an LLM is tight, so load it on demand only.

**Open actions**
1. Ask the Hima author for an explicit TTS licence.
2. Benchmark TTFA and RTF on the M2 and M3 for Hima-TTS MLX/ONNX, Maya-8bit (mlx-audio) and Hima-ASR 4/8-bit.
3. Do a blind listening test of Hinglish companion lines: Hima vs. Maya vs. Chatterbox-hi.
4. Prototype the Swift VPIO helper.

---

## Sources
- https://huggingface.co/Prahaladha/hima-tts-nano-hi (+ `/raw/main/README.md`, `/raw/main/config.yaml`, `/raw/main/hima_tts/codec/LICENSE`, HF API file listing)
- https://huggingface.co/Prahaladha/hima-tts-nano-hi-mlx-8bit · https://huggingface.co/Prahaladha/hima-tts-nano-hi-mlx-fp16 · https://huggingface.co/Prahaladha/hima-tts-nano-hi-ONNX
- https://github.com/Prahaladha-Reddy/hima-finetune (README, LICENSE-THIRD-PARTY)
- https://github.com/Prahaladha-Reddy/hima (Apache-2.0 training code)
- https://huggingface.co/Prahaladha/hima-asr (+ NOTICE) · https://huggingface.co/Prahaladha/hima-asr-mlx-4bit · https://huggingface.co/Prahaladha/hima-asr-mlx-8bit · https://huggingface.co/Prahaladha/hima-asr-ONNX
- https://huggingface.co/mlx-community/whisper-large-v3-turbo · https://huggingface.co/mlx-community/whisper-large-v3-turbo-4bit · https://huggingface.co/mlx-community/whisper-large-v3-turbo-8bit · https://pypi.org/project/mlx-whisper/
- https://simonwillison.net/2024/Oct/1/whisper-large-v3-turbo-model/ · https://notes.billmill.org/dev_blog/2026/01/updated_my_mlx_whisper_vs._whisper.cpp_benchmark.html
- https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Prime · https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex · https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Swift
- https://huggingface.co/nitinh/whisperkit-hinglish-coreml · https://github.com/argmaxinc/WhisperKit
- https://pypi.org/project/lightning-whisper-mlx/ · https://pypi.org/project/parakeet-mlx/ · https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- https://github.com/snakers4/silero-vad · https://pypi.org/project/silero-vad/ · https://huggingface.co/onnx-community/silero-vad
- https://huggingface.co/pipecat-ai/smart-turn-v3 (+ benchmarks/smart-turn-v3.2-cpu.md) · https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/
- https://huggingface.co/livekit/turn-detector (+ LICENSE)
- https://github.com/Blaizzy/mlx-audio (→ Neywa-Labs/mlx-audio; README, `mlx_audio/tts/models/maya2/README.md`, `qwen3_tts/README.md`)
- https://huggingface.co/maya-research/maya2-native · https://huggingface.co/aruntemme/maya2-native-mlx-8bit
- https://huggingface.co/ResembleAI/chatterbox · https://huggingface.co/mlx-community/chatterbox-multilingual-v3 · https://huggingface.co/reenigne314/chatterbox-indic-lora · https://huggingface.co/mdSana/My-Chatterbox-hi
- https://huggingface.co/hexgrad/Kokoro-82M (VOICES.md) · https://huggingface.co/ai4bharat/IndicF5 · https://huggingface.co/ai4bharat/indic-parler-tts
- https://huggingface.co/coqui/XTTS-v2 · https://huggingface.co/k2-fsa/OmniVoice · https://huggingface.co/mlx-community/MOSS-TTS-Nano-100M · https://huggingface.co/rumik-ai/rumik-oss-1
- https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base · https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512 · https://huggingface.co/kenpath/svara-tts-v1 · https://huggingface.co/canopylabs/3b-hi-ft-research_release
- https://huggingface.co/lexandstuff/rvc-mlx-weights · https://pypi.org/project/mlx-contentvec/ · https://github.com/IAHispano/Applio · https://pypi.org/project/rvc-python/ · https://github.com/NevilPatel01/RVC-WebUI-MacOS
- https://huggingface.co/Plachta/Seed-VC · https://pypi.org/project/seed-vc/
- https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb · https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34-LM · https://github.com/sarulab-speech/UTMOSv2
- https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:) · https://developer.apple.com/forums/thread/804765 · https://bugs.webkit.org/show_bug.cgi?id=281978 · https://developer.chrome.com/blog/macos-native-echo-cancellation
- https://docs.livekit.io/reference/python/livekit/rtc/apm.html
