# 04 — LLM runtime, cloud routing, memory, Python bundling

Research date: 2026-11-20. Targets: M2 16GB (main), M3 8GB (Lite), 24GB (stretch). Python core, Tauri shell.
Labels: **[V]** = checked on a primary source this session. **[S]** = secondary or vendor-only source. **[I]** = my inference, check it before relying on it.

---

## 1. Local LLM runtime

### 1.1 Runtimes

| Option | Version (Nov 2026) | License | Apple-silicon | Tool calls + streaming | Verdict |
|---|---|---|---|---|---|
| **Ollama** | v0.40.16 (Nov 9) latest; v0.40.17-rc2 adds concurrent generation for MLX [V] | MIT | MLX engine: preview in 0.19 (Mar 2026), reportedly default from 0.30 (May 2026) [S]; `-mlx` / `-nvfp4` tags run on MLX, GGUF tags on llama.cpp [V] | Streams tool calls with an incremental, template-aware parser (since May 2025) [V]; OpenAI-compatible `/v1` | **Chosen.** One daemon, a model registry, both engines, KV snapshots, used by many apps |
| mlx-lm | 0.32.2 (Oct 16 2026) [V]; mlx 0.32.4 (wheels for macOS ≥14, arm64) [V] | MIT | Native | `mlx_lm.server` is "similar to" OpenAI and streams, but has **no documented tool calling** and is "not recommended for production" [V] | Rejected as the main runtime. Use it in-process for embeddings or experiments |
| LM Studio / `llmster` | 0.4.x (0.4.22 Aug 2026; 0.4.26 mentioned) [S] | Proprietary (free) | MLX engine with continuous batching since 0.4.2 [S] | Qwen 3.5 and Gemma 4 tool-call parser fixes shipped (0.4.7, 0.4.9) [S] | Optional "bring your own server" target, through the same OpenAI adapter. Not bundled (license) |

**Notes**
- On Ollama, MLX tags are not always smaller. `gemma4:e4b-mlx` is 9.5GB, while `e4b-it-qat` (GGUF) is 6.1GB. On 8–16GB, prefer QAT/q4 GGUF. Use `-nvfp4` or `-mlx` where the size is equal (12B) [V].
- Ollama says NVFP4 generates "about 20% faster than q4_K_M" on the updated MLX engine (Jun 2026) [V].
- Keep one model resident with `keep_alive=-1`. Warm it up at app start. Never load two chat models at once on 8GB.

### 1.2 Candidate models (Ollama tags, sizes from ollama.com tag pages) [V]

| Model | Tag | Disk/RAM (weights) | Tools | Hindi/Hinglish evidence | Notes |
|---|---|---|---|---|---|
| Qwen3.5 2B | `qwen3.5:2b-q4_K_M` | 1.9GB | yes | 201 languages on the model card; no Hindi breakdown [V] | Emergency tier only |
| **Qwen3.5 4B** | `qwen3.5:4b-q4_K_M` | 3.3GB | yes | same | **8GB pick** |
| Qwen3.5 9B | `qwen3.5:9b-q4_K_M` / `-nvfp4` | 6.6 / 7.2GB | yes | same | 16GB alternative (A/B against Gemma) |
| Gemma 4 E2B | `gemma4:e2b-it-qat` | 4.3GB | native function calling [V] | "35+ languages out of box, 140+ pretrain"; Hindi not named on the card [V] | Has an audio encoder (≤30s ASR), useful later |
| **Gemma 4 E4B** | `gemma4:e4b-it-qat` | 6.1GB | yes | Gemma 4 31B beats Sarvam-30B in every Indic language on L3Cube-IndicQuest v2, by the widest margin in Hindi [S] | **16GB pick** |
| **Gemma 4 12B** | `gemma4:12b-nvfp4` (MLX) / `12b-it-qat` | 7.7 / 7.2GB | yes | as above | **24GB pick**. Also fits 16GB if nothing else is heavy |
| Gemma 4 26B-A4B | `gemma4:26b-a4b-it-qat` | 16GB | yes | as above | MoE with 3.8B active, so fast, but 16GB leaves no room for STT/TTS on 24GB. Rejected for now |
| Qwen3.6 / 3.8 | `qwen3.6:27b`, `qwen3.8:27b` (18GB) | 18GB+ | yes | n/a | Too big. Qwen3.8-27B is the cloud pick on Groq/Cerebras |
| Sarvam-30B | HF `sarvamai/sarvam-30b-gguf` Q4_K_M | 19.6GB [V] | "can perform tool calls" [V] | Claims SOTA on 22 Indic languages; MILU 76.8 [V] | Rejected: too large, deprecated in Sarvam's own API (moved to 105B) [V], and below Gemma 4 on IndicQuest v2 [S] |
| Sarvam-M (24B) / Sarvam-1 | `sarvamai/sarvam-m-gguf` | ~14GB+ | weak | — | Rejected: superseded, removed from Sarvam API [V] |
| Llama 3.x / Phi | — | — | — | No 2026 Indic evidence | Rejected: older generations, weaker multilingual |

**Hindi evidence gap.** No public benchmark covers Hinglish (romanised, code-mixed) for these small models. The NVIDIA Hindi suite (2025) predates them, and IndicQuest v2 tested 31B models only. **Action:** build a 100-prompt in-house Hinglish eval (persona chat, a tool-call JSON check, Devanagari↔roman mirroring) and run it on Qwen3.5-4B/9B and Gemma4-E4B/12B before locking the defaults.

### 1.3 Tier table (chosen)

| Tier | Local chat model | Resident RAM budget | Cloud default |
|---|---|---|---|
| Lite, 8GB M3 | `qwen3.5:4b-q4_K_M` (fallback `qwen3.5:2b-q4_K_M`) | ~4GB LLM + ~0.3GB embedder | **Cloud-first**. Local is offline/privacy fallback only |
| Standard, 16GB M2 | `gemma4:e4b-it-qat` (A/B vs `qwen3.5:9b-q4_K_M`) | ~6–7GB | Hybrid: local first, cloud for long/complex turns |
| Pro, 24GB | `gemma4:12b-nvfp4` | ~8GB | Local first |

---

## 2. Cloud providers

### 2.1 Endpoints and defaults

| Provider | OpenAI-compatible base URL | Streaming tool calls | Low-latency default | Free tier (verified) | Rate-limit signal |
|---|---|---|---|---|---|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` [V] (beta) | yes (streaming + function calling) [V] | `gemini-3.8-flash`, `gemini-3.5-flash-lite`; alias `gemini-flash-latest` [V]. Thinking can't be turned off on Gemini 3/4; use `reasoning_effort: "minimal"` [V] | Per-model limits only shown in AI Studio; RPD resets at midnight Pacific [V] | 429 `RESOURCE_EXHAUSTED` [V] |
| Groq | `https://api.groq.com/openai/v1` | yes | `qwen/qwen3.8-27b` (450 t/s, preview), `openai/gpt-oss-20b` (1000 t/s), `llama-3.1-8b-instant` [V] | Base dev limits, e.g. qwen3.8-27b 30 RPM / 1K RPD / 8K TPM / 200K TPD [V] | 429 + `retry-after`; `x-ratelimit-{limit,remaining,reset}-{requests,tokens}` [V] |
| Cerebras | `https://api.cerebras.ai/v1` | yes [I] | `qwen-3.8-27b` (~1850 t/s), `gpt-oss-120b` (~3000 t/s) [V] | $5 trial credits; qwen 300 RPM [V] | 429; message says which TPM was hit [V] |
| OpenRouter | `https://openrouter.ai/api/v1` | yes (provider-dependent) | any `:free` model as last resort | `:free`: 20 RPM; 50 RPD (<10 credits bought) or 1000 RPD [V] | 429 + `X-RateLimit-*`; **mid-stream 429 arrives as an SSE chunk with `finish_reason:"error"`** [V]; 402 = credits |
| Anthropic | `https://api.anthropic.com/v1/` (compat layer, "not production-ready") [V] | yes | `claude-haiku-5-5` | none | `retry-after`, `x-ratelimit-remaining-*`; 529 overloaded. Use the **native** Messages API |
| OpenAI | `https://api.openai.com/v1` | yes | `gpt-6-luna` ($0.10/$0.50 per MTok) [V] | none | 429 + `x-ratelimit-*` |
| DeepSeek | `https://api.deepseek.com` (also `/anthropic`) [V] | yes | `deepseek-flash` (= V4.1-Flash-1017) [V] | none | 429 |
| Mistral | `https://api.mistral.ai/v1` (native); `/openai/v1` is public preview [V] | yes | `mistral-small-4-0-26-03`, `ministral-3-8b-25-12` [V] | not documented on models page | 429 |
| Together | `https://api.together.ai/v1` [V] | yes (tools, `tool_choice`) [V] | e.g. `MiniMaxAI/MiniMax-M3.1-Flash` | trial credits | 429 |
| Sarvam | OpenAI-compatible `/v2` (Token Factory) [V] | n/a | `Sarvam 105B Conversations` (32K, no reasoning) [V] | shared credits | — |

**Default cloud chain (voice turn, TTFT matters most):** Groq `qwen/qwen3.8-27b` → Cerebras `qwen-3.8-27b` → Gemini `gemini-3.8-flash` (minimal reasoning) → OpenRouter `:free` → local. For "quality" turns (long reasoning, memory consolidation), use Gemini Flash or Claude Haiku.

### 2.2 Cloud STT / TTS fallbacks (Hindi)

| Kind | Option | Hindi | Latency / limits | Verdict |
|---|---|---|---|---|
| STT | Groq `whisper-large-v3-turbo` | yes (Whisper) | 20 RPM, 2K RPD, 7.2K audio-sec/hr [V] | **Chosen** first cloud STT fallback (cheap, fast) |
| STT | Sarvam **Saaras v4** (default; v3 still live) | 22 Indic languages + English; `codemix`/`translit` modes [V] | — | **Chosen** for Hinglish-heavy users (code-mix output mode) |
| STT | OpenAI `gpt-live-transcribe` / `gpt-transcribe` [V] | Hindi not broken out [S] | whisper-1 and gpt-4o-transcribe reportedly shut down 2027-02-26 [S] | Optional |
| STT | ElevenLabs `scribe_v3_live` [V] | — | realtime | Optional |
| TTS | Sarvam **Bulbul v3** (stable, default) / Bulbul v4 Flash (200+ personas, 10 languages) [V] | hi-IN native | <250ms first byte over WebSocket (vendor); ≤2,500 chars/msg, <500 recommended; 24kHz [S] | **Chosen** Hindi cloud TTS |
| TTS | ElevenLabs `eleven_flash_v2_5` (~100ms, 32 languages incl. hi), `eleven_v4_turbo` (~100ms, 90+) [V] | yes | independent median ~177–185ms [S] | **Chosen** second (best voices, pricier) |
| TTS | Cartesia Sonic 3.6 | marketed as "native Hinglish" [S] | vendor <90ms; independent 270–440ms [S] | Optional |
| TTS | Gemini `gemini-3.8-flash-tts` / `-lite-tts` [V] | — | — | Optional (same key as LLM) |

### 2.3 Abstraction: LiteLLM vs thin adapters → **own thin adapters**

| Option | Version | License | Pros | Cons | Verdict |
|---|---|---|---|---|---|
| LiteLLM | 1.110.2 (Nov 20 2026) [V] | MIT | 100+ providers, cost maps | Two PyPI compromises: 1.82.7/1.82.8 (Mar 24 2026, credential stealer, confirmed by several outlets) [V]; 1.107.0 (Oct 21 2026, single source) [S]. PyInstaller misses `tiktoken_ext` hidden imports and tokenizer data [V]. Import-time cost-map fetch was reported to slow CLI startup [S]. Heavy dependency tree | **Rejected** for runtime; read it as a reference only |
| **Thin adapters on `httpx` (async, HTTP/2)** | — | — | ~600 LOC; two wire formats cover everything; full control over SSE parsing, TTFT timeouts, hedging; tiny bundle | We maintain the quirks | **Chosen** |

Design:
- `Provider` protocol: `stream(messages, tools, opts) -> AsyncIterator[Delta]`, where `Delta` ∈ {text, tool_call_delta(index, id, name, args_fragment), usage, done(reason), error(kind, retry_after)}.
- Adapters:
  - (1) `openai_chat`. Covers Ollama, Groq, Cerebras, OpenRouter, Gemini, DeepSeek, Mistral, Together, OpenAI and Sarvam, with per-provider quirk flags (`supports_prefill`, `reasoning_param`, `strict_tools`, `stream_usage`).
  - (2) `anthropic_messages` (native).
  - (3) optional `gemini_native`, later, for Live audio.
- Router: an ordered chain per *intent* (voice-fast, quality, background). It keeps a health and cooldown table fed by `retry-after` / `x-ratelimit-reset-*` and by 429/5xx/529 responses.
  - **TTFT budget hedging:** if the first token hasn't arrived within ~1.2s on voice turns, start the next provider in parallel and keep whichever answers first.
  - Circuit breaker: 3 failures → 60s cooldown.
- Tool calls: accumulate argument fragments by `index`; JSON-parse only on `finish_reason=tool_calls`. Run tools only after the stream completes. Never let a half-received tool call cross a failover.

### 2.4 Mid-stream continuation (provider dies after N tokens)

| Provider | Assistant prefill / continue | How |
|---|---|---|
| DeepSeek | yes (beta) [V] | `base_url=https://api.deepseek.com/beta`; last message `{"role":"assistant","content":partial,"prefix":true}` |
| Mistral | yes [V] | `"prefix": true` on the last assistant message (native endpoint; not documented for `/openai/v1`) |
| Anthropic | **no** on Claude 4.6+ / 5.x: 400 "Prefilling assistant messages is not supported" [V] | Fall back to the instruction strategy below |
| Ollama / llama.cpp | likely: a trailing assistant message is continued by the chat template [I] | Verify per model template; otherwise use `/api/generate` with `raw:true` plus a hand-built prompt |
| OpenAI, Gemini, Groq, Cerebras | not a documented feature [I] | Instruction strategy |

Instruction strategy: append a user/system note such as *"Your previous reply was cut off after: «…last ~200 chars…». Continue exactly from there; do not repeat."*, then de-duplicate overlap by longest suffix/prefix match before sending text to TTS. Because TTS is sentence-chunked, it is simpler to **drop the incomplete sentence and regenerate from the last completed sentence boundary**.

---

## 3. Long-term memory

### 3.1 Storage

| Option | Version | License | macOS arm64 | Verdict |
|---|---|---|---|---|
| **sqlite-vec** | 0.1.9 (Mar 31 2026); 0.1.10a4 pre-release [V] | MIT / Apache-2.0 | wheel `macosx_11_0_arm64`, 165kB [V] | **Chosen**. Brute-force KNN is fine below ~100k memories; supports `float[256]`/int8/bit |
| SQLite FTS5 | built into SQLite | public domain | yes | **Chosen** for the lexical side |
| SQLite `vec1` (official ANN) | 0.7 (Jul 2026), "testing insufficient" [S] | public domain | build yourself | Watch; possible ANN upgrade later |
| sqliteai/sqlite-vector | — | Elastic 2.0 [S] | — | Rejected (license) |

**Hindi gotcha [V]:** the FTS5 `unicode61` default `categories` is `L* N* Co`. That excludes `M*` marks, so Devanagari matras and viramas become separators and Hindi words get split. Use `tokenize="unicode61 remove_diacritics 0 categories 'L* N* Co M*'"`. A second `trigram` FTS table helps Hinglish spelling variants (`kya`/`kyaa`), but trigram can't match queries shorter than 3 chars.
**Python gotcha [V]:** stock macOS/python.org `sqlite3` may lack `enable_load_extension`. Check this on the bundled interpreter at startup. If it's missing, depend on `pysqlite3`/`apsw`.

### 3.2 Memory frameworks and benchmarks

| System | Version | License | Local fit | Published results | Verdict |
|---|---|---|---|---|---|
| mem0 (OSS `mem0ai`) | 2.2.1 (Sep 2026) [V] | Apache-2.0 | Needs an external vector DB + LLM; default LLM is `gpt-5-mini` | LoCoMo 92.5, LongMemEval 94.4, BEAM-1M 64.1, but from the **managed platform** with optimisations not in OSS [V] | Rejected as a dependency; **borrow** its ADD/UPDATE/DELETE/NOOP extraction pattern |
| Zep / Graphiti | graphiti-core 0.31.2 (Oct 2026) [V] | Apache-2.0 | Needs Neo4j/FalkorDB; Kuzu driver deprecated [V]; FalkorDB Lite needs Py ≥3.12 | LongMemEval 71.2% (GPT-4o) self, 75.1% third-party; LoCoMo 80–85% (disputed) [S] | Rejected (graph DB too heavy for 8GB); **borrow** bi-temporal validity (`valid_from`/`valid_to`) |
| Letta (MemGPT) | server sleep-time agents being replaced by client subagents (2026) [S] | Apache-2.0 | Full agent server | LoCoMo ~83% (roundup) [S] | Rejected (it's a framework, not a library); **borrow** core memory blocks + background "sleep-time" consolidation |
| A-Mem | NeurIPS 2025 paper [V] | MIT (code) | library-ish | LoCoMo F1 45.85 vs MemGPT 25.52 with GPT-4o-mini [S] | **Borrow** note linking + memory evolution |
| OpenMemory (CaviraOSS, HMD v2) | openmemory-py 1.2.x [S] | Apache-2.0 [I] | SQLite default | none independent | Rejected (immature); different from Mem0's OpenMemory MCP |

Caveat [V]: Pollertlam & Kornsuwannawit (arXiv 2603.04814, Mar 2026) found **long-context GPT-5-mini beats Mem0-style fact memory on LongMemEval and LoCoMo recall**. Memory wins on cost after ~10 turns at 100k context, and on persona consistency. Benchmarks across vendors are not comparable (different judges and setups) [S]. **Implication:** keep a generous recent-transcript window (last N turns plus a rolling summary) *and* retrieval. Don't rely on extracted facts alone.

### 3.3 Local embedding models

| Model | Params | Dims | Ctx | Hindi | Formats | License | Verdict |
|---|---|---|---|---|---|---|---|
| **EmbeddingGemma-300m** | 308M | 768 (MRL 512/256/128) | 2048 | 100+ languages; MMTEB-v2 61.15 (Q8: 60.93) [V] | ONNX (`onnx-community/embeddinggemma-300m-ONNX`), MLX (`mlx-community/embeddinggemma-300m-4bit…bf16`), GGUF (`ggml-org/…qat-q8_0`) [V] | Gemma terms (gated on HF) [V] | **Chosen (all tiers)**: store 256-d MRL (~0.2GB RAM at 4–8bit [I]). Prompts: `task: search result \| query: …` / `title: none \| text: …` |
| Qwen3-Embedding-0.6B | 0.6B | 32–1024 MRL | 32K | 100+; MMTEB 64.33 [V] | GGUF/Ollama `qwen3-embedding:0.6b` [V] | Apache-2.0 | **Alternative** on 16/24GB if the Hinglish eval favours it (Apache licence is cleaner) |
| EmbeddingGemma 2 | 740M, multimodal, 8K ctx (Oct 2026) [S] | — | — | "100+ languages" [S] | HF/Kaggle | Apache-2.0 [S] | Watch; re-evaluate in Q1 |
| bge-m3 | ~568M [I] | 1024 + sparse + ColBERT [V] | 8192 | 100+ [V] | ONNX/GGUF | MIT | Rejected: 2× the RAM of EmbeddingGemma; sparse mode is redundant with FTS5 |
| multilingual-e5-small | ~118M [I] | 384 [I] | 512 | ~100 [I] | ONNX | MIT | Emergency fallback only |
| granite-embedding-278m-multilingual | 278M | — | — | **Hindi not supported** [V] | — | Apache-2.0 | Rejected |

Run the embedder in-process with ONNX Runtime (CoreML EP), or with MLX, so it doesn't hold an Ollama model slot. Store `model_id` + `dim` per vector so the embedder can be re-embedded or migrated later.

### 3.4 Recommended design

```sql
-- episodic: every turn (source of truth, never deleted by consolidation)
CREATE TABLE turns(id INTEGER PRIMARY KEY, session_id TEXT, ts INTEGER, role TEXT,
  text TEXT, lang TEXT, text_roman TEXT);              -- text_roman = transliterated copy for Hinglish matching
-- semantic facts / preferences / events (Graphiti-style bi-temporal)
CREATE TABLE memories(id INTEGER PRIMARY KEY, kind TEXT CHECK(kind IN('fact','pref','event','relationship','summary')),
  subject TEXT, predicate TEXT, object TEXT, text TEXT, text_roman TEXT,
  importance REAL, confidence REAL, created_at INTEGER, last_accessed INTEGER, access_count INTEGER,
  valid_from INTEGER, valid_to INTEGER, superseded_by INTEGER REFERENCES memories(id),
  source_turn_ids TEXT, embed_model TEXT);
CREATE VIRTUAL TABLE memories_fts USING fts5(text, text_roman, content='memories', content_rowid='id',
  tokenize="unicode61 remove_diacritics 0 categories 'L* N* Co M*'");
CREATE VIRTUAL TABLE memories_tri USING fts5(text_roman, content='memories', content_rowid='id', tokenize='trigram');
CREATE VIRTUAL TABLE memories_vec USING vec0(embedding float[256] distance_metric=cosine);   -- rowid = memories.id
CREATE TABLE links(src INTEGER, dst INTEGER, rel TEXT, weight REAL);   -- A-Mem style note links
CREATE TABLE core_blocks(name TEXT PRIMARY KEY, text TEXT, updated_at INTEGER); -- Letta-style: user_profile, persona, ongoing
```

**Retrieval (per user turn, budget <40ms local):**
1. Embed the query (~10ms).
2. Candidates: vec KNN k=30 + FTS5 bm25 k=30 + trigram k=15 (`WHERE valid_to IS NULL`).
3. **RRF:** `score = Σ w_i/(60+rank_i)` with w_vec=1.0, w_fts=1.0, w_tri=0.5 (pattern from Alex Garcia's sqlite-vec hybrid post, k=60 [V]).
4. Re-weight: `final = rrf · (1 + 0.3·importance) · recency_decay(half-life 30d, refreshed on access)`.
5. Top 6–8 go into the prompt with the `core_blocks`, the last 8–12 turns and a rolling session summary.
6. Optional 1-hop expansion over `links`.

**Write path (async, after the TTS response finishes; never on the hot path):**
1. A small LLM call extracts candidate facts as JSON `{subject,predicate,object,text,kind,importance}` (local model, or cloud "background" intent).
2. For each candidate, retrieve the top-5 similar memories (same subject/predicate first). The LLM picks **ADD / UPDATE / SUPERSEDE / NOOP** (mem0 pattern).
3. **Contradiction:** SUPERSEDE sets `valid_to=now`, `superseded_by=new.id` on the old row, so it is kept for "you used to…". Prefer user-stated over inferred facts, and newer over older. Confidence < 0.5 → keep it as `event`, not `fact`.

**Consolidation ("sleep-time", on idle or once a day):**
- Cluster events older than 7 days into `summary` memories.
- Decay `importance` of memories not accessed in 90 days.
- Merge near-duplicates (cosine > 0.92, same subject).
- Rewrite `core_blocks.user_profile`, capped at ~400 tokens.
- Run consolidation on cloud when available. On 8GB, fall back to a local model only on AC power and idle.

**Privacy:** keep the DB in the app's data dir. Optional SQLCipher. Add a "forget" tool that hard-deletes a row plus its FTS/vec rows, and an export command.

---

## 4. Python sidecar bundling (Tauri + MLX)

| Option | Version | Pros | Cons | Verdict |
|---|---|---|---|---|
| **python-build-standalone + uv-synced venv** (relocatable interpreter in `Resources/`, launcher as Tauri sidecar) | uv-managed PBS CPython 3.12/3.13 | Wheels installed unmodified, so `mlx.metallib` stays next to `libmlx.dylib`; fast startup (no onefile unpack); deterministic `uv.lock`; easy to update the Python layer | Must patch libpython install name to `@rpath` (`install_name_tool -id @rpath/libpython3.13.dylib`) [V, pytauri guide]; must sign every `.so`/`.dylib` inside-out; larger bundle | **Chosen** |
| PyInstaller | 6.22.3 (Sep 2026) [V] | Familiar; one binary | MLX has no hook: you must collect `mlx.metallib` next to the dylib by hand [S/I]; tiktoken-style hidden imports [V]; onefile unpacks to tmp on each start (slow, and the unpacked files fail notarisation); signatures break when Tauri copies the bundle, so re-sign after assembly [S] | Rejected (fallback only, onedir mode) |
| Nuitka | — | Compiled, smaller | Long builds; nanobind/MLX + Metal resource layout not validated anywhere I found | Rejected |
| System / Homebrew Python | — | — | Not shippable | Rejected |

**MLX-specific [S]:**
- MLX looks for `mlx.metallib` colocated with `libmlx.dylib`.
- Putting it in `Contents/Frameworks` breaks codesign, and putting it in `Resources` breaks lookup. Keep it inside `site-packages/mlx/lib/` under `Contents/Resources/python/…`.
- Use the PyPI wheel's metallib, not a locally built one.
- mlx needs macOS ≥ 14 [V]. Set the app's `minimumSystemVersion` to 14.0.

**Signing/notarisation checklist:**
1. Hardened runtime (`--options runtime`) on every Mach-O. Notarisation requires it [S].
2. Sign inside-out: all `*.so`/`*.dylib` → `python3` executable → sidecar launcher → `.app`. Don't use `--deep` [S].
3. Entitlements: start with none. Add `com.apple.security.cs.disable-library-validation` only if loading fails, and `allow-jit` only if a dependency needs it [S].
4. Strip `__pycache__` and tests, and precompile `.pyc` before signing. Writing to the bundle at runtime invalidates the signature, so set `PYTHONDONTWRITEBYTECODE=1` and keep caches in `~/Library/Caches/Hikari`.
5. `xcrun notarytool submit --wait`, then `stapler staple`.
6. Don't list the Python tree directly in Tauri `bundle.resources` without the rpath fix [V, pytauri].
7. Sanity-check at first launch: `sqlite3.Connection.enable_load_extension`, `import mlx.core; mx.metal.is_available()`, Ollama reachable.

Ollama itself is **not bundled**. Detect it, offer an install link, or use the user's LM Studio. Shipping Ollama.app inside Hikari doubles signing complexity [I].

---

## 5. Decisions summary

| Area | Decision |
|---|---|
| Local runtime | Ollama ≥0.40.16 over the OpenAI `/v1` API; MLX tags where they're not larger than GGUF QAT |
| 8 / 16 / 24GB | `qwen3.5:4b-q4_K_M` / `gemma4:e4b-it-qat` / `gemma4:12b-nvfp4`, confirmed by the in-house Hinglish eval |
| Cloud chain (voice) | Groq qwen3.8-27b → Cerebras qwen-3.8-27b → Gemini 3.8 Flash → OpenRouter :free → local |
| Abstraction | Own `httpx` adapters (openai_chat + anthropic_messages), router with health, cooldown and TTFT hedging; no LiteLLM |
| Continuation | Drop the partial sentence and regenerate; use prefix/prefill where supported (DeepSeek, Mistral, Ollama [I]) |
| STT/TTS cloud | Groq whisper-large-v3-turbo + Sarvam Saaras v4 / Sarvam Bulbul v3 + ElevenLabs flash_v2_5 |
| Memory | SQLite + sqlite-vec 0.1.9 + FTS5 (M* categories) + trigram, RRF k=60, bi-temporal facts, mem0-style ADD/UPDATE/SUPERSEDE, sleep-time consolidation |
| Embeddings | EmbeddingGemma-300m @256-d (ONNX/MLX); alternative Qwen3-Embedding-0.6B |
| Bundling | python-build-standalone + uv venv in `Resources`, Tauri sidecar launcher, inside-out hardened-runtime signing |

## Sources
- https://github.com/ollama/ollama/releases
- https://ollama.com/blog/mlx · https://ollama.com/blog/mlx-performance · https://ollama.com/blog/streaming-tool
- https://dev.to/jovan_chan_9500711396d4e6/ollama-v030-on-apple-silicon-what-the-stable-mlx-release-actually-changed-from-the-preview-25h7
- https://ollama.com/library/gemma4/tags · https://ollama.com/library/qwen3.5/tags · https://ollama.com/library/qwen3.8 · https://ollama.com/search?q=qwen
- https://gemma.ai/models/gemma-4/model-card/ · https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/
- https://huggingface.co/Qwen/Qwen3.5-9B · https://rits.shanghai.nyu.edu/ai/qwen-3-5-small-models-9b-parameters-that-beat-120b/
- https://huggingface.co/sarvamai · https://huggingface.co/sarvamai/sarvam-30b · https://huggingface.co/sarvamai/sarvam-30b-gguf
- https://arxiv.org/pdf/2608.15535 (L3Cube-IndicQuest v2) · https://arxiv.org/html/2508.19831v1 (Hindi LLM suite)
- https://pypi.org/project/mlx/ · https://pypi.org/project/mlx-lm/ · https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md
- https://lmstudio.ai/changelog/lmstudio-v0.4.0 · https://lmstudio.ai/changelog/lmstudio-v0.4.22
- https://aistudio.google.com/docs/openai · https://aistudio.google.com/docs/rate-limits · https://aistudio.google.com/docs/models
- https://console.groq.com/docs/rate-limits · https://console.groq.com/docs/models
- https://inference-docs.cerebras.ai/support/rate-limits · https://inference-docs.cerebras.ai/models/overview
- https://openrouter.ai/docs/api/reference/limits
- https://platform.claude.com/docs/en/api/openai-sdk · https://www.agno.com/articles/fix-assistant-message-prefill-compatibility-for-claude-4-6-across-all-providers.md
- https://developers.openai.com/api/docs/models · https://www.developersdigest.tech/blog/whisper-1-gpt-4o-transcribe-deprecation
- https://api-docs.deepseek.com/ · https://api-docs.deepseek.com/guides/chat_prefix_completion
- https://docs.mistral.ai/capabilities/completion/prefix/ · https://docs.mistral.ai/getting-started/models/
- https://docs.together.ai/docs/openai-api-compatibility
- https://docs.sarvam.ai/api-reference-docs/getting-started/models · https://sarvam.ai/blogs/bulbul-v3 · https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/text-to-speech/streaming-api/web-socket
- https://elevenlabs.io/docs/overview/models · https://www.cekura.ai/blogs/elevenlabs-vs-cartesia · https://cartesia.ai/blog/cartesia-vs-elevenlabs
- https://pypi.org/project/litellm/ · https://research.jfrog.com/post/litellm-compromised-teampcp/ · https://bleepingcomputer.com/news/security/popular-litellm-pypi-package-compromised-in-teampcp-supply-chain-attack · https://www.mend.io/?p=26750 · https://github.com/openai/tiktoken/issues/469 · https://docs.litellm.ai/blog/introducing-litellm-core
- https://pypi.org/project/sqlite-vec/ · https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html · https://sqlite.org/fts5.html · https://sqlite.org/vec1/doc/trunk/doc/vec1.md · https://til.simonwillison.net/sqlite/sqlite-extensions-python-macos
- https://pypi.org/project/mem0ai/ · https://mem0.ai/blog/state-of-ai-agent-memory-2026 · https://pypi.org/project/graphiti-core/ · https://arxiv.org/abs/2603.04814 · https://arxiv.org/abs/2502.12110 · https://letta.com/blog/sleep-time-compute · https://letta.com/blog/our-next-phase · https://github.com/CaviraOSS/OpenMemory
- https://huggingface.co/google/embeddinggemma-300m · https://huggingface.co/models?search=embeddinggemma-300m · https://huggingface.co/Qwen/Qwen3-Embedding-0.6B · https://huggingface.co/BAAI/bge-m3 · https://huggingface.co/ibm-granite/granite-embedding-278m-multilingual · https://www.fonearena.com/blog/494313/google-embeddinggemma-2.html
- https://pypi.org/project/pyinstaller/ · https://upd.dev/ml-explore/mlx/issues/1286 · https://pytauri.github.io/pytauri/0.7/usage/tutorial/build-standalone · https://timetobuildbob.github.io/blog/four-prs-to-sign-one-app · https://developer.apple.com/forums/thread/679044 · https://www.github.com/spyder-ide/spyder/wiki/Dev:-Codesigning-the-macOS-Standalone-Application
