# 05 — Mac control: MCP servers, TCC permissions, built-in tools, wake word

Researched 2026-11-20. The dev machine runs Darwin 27.2 (macOS 27.x "Golden Gate"), so macOS 27 TCC changes apply directly.
Status tags: **[verified]** = checked against the repo, registry or vendor page today; **[reported]** = secondary source only; **[unverified]** = known convention, test it on device.

## 1. MCP servers for macOS control

| Server | Repo / package | Version (date) | License | Install / transport | Approach | Maintenance |
|---|---|---|---|---|---|---|
| macOS Automator | steipete/macos-automator-mcp, npm `@steipete/macos-automator-mcp` | 0.4.7 (npm, 2026-09-01) | MIT | `npx -y --package @steipete/macos-automator-mcp macos-automator-mcp`, stdio, Node ≥ 24 | AppleScript/JXA. 2 tools: `execute_script` (inline, file or KB id) and `get_scripting_tips`. KB of 200+ recipes | **Archived 2026-09-13** (read-only) [verified] |
| Peekaboo | openclaw/Peekaboo (moved from steipete), npm `@steipete/peekaboo`, brew `openclaw/tap/peekaboo` | 4.9.9 (npm, 2026-11-16) | MIT | `npx -y @steipete/peekaboo mcp` or brew, then `peekaboo mcp`, stdio. Swift, macOS 15+ | Hybrid. `see` returns screenshot + AX UI map with element IDs, plus click/type/press/scroll/drag/set-value/app/window/menu/dialog/space/capture/agent. ScreenCaptureKit | Very active: 5.5k★, pushed 2026-11-17 [verified] |
| MacOS-MCP (CursorTouch) | CursorTouch/MacOS-MCP, PyPI `macos-mcp` | 0.4.7 | MIT | `uvx macos-mcp serve` (stdio default; SSE/HTTP optional). Python ≥ 3.11, macOS 12+ | AX tree first (`Snapshot` returns interactive elements and coordinates). Screenshot optional. Tools: Click, Type, Scroll, Move, Shortcut, App, Desktop, Shell, Scrape, Wait, Snapshot, Notification | Active: 247★, pushed 2026-11-02 [verified] |
| macos-ui-automation-mcp | mb-dev/macos-ui-automation-mcp, PyPI | 0.2.0 (2025-08-02) | MIT (PyPI) | clone + `uv sync`, or pip. FastMCP + PyObjC, stdio | Pure AX with JSONPath queries. 8 tools: find_elements(_in_app), click_by_accessibility_id, click_at_position, type_text_to_element_by_selector, get_app_overview, list_running_applications, check_accessibility_permissions. No screenshots | Stale: no push since 2025-08 [verified] |
| Daemon OS | hammadxcm/daemon-os | 1.0.1 | MIT | brew `hammadxcm/daemon-os/daemon-os`, then `daemon setup`. `daemon mcp`, stdio. Swift | AX tree first, screenshots only as fallback. 20 tools: 7 perception, 7 action, wait, 5 "recipes" | Tiny: 3★, 9 commits [verified] |
| MacWright | ruchit-p/macwright | no releases | MIT | clone, `npm run setup` (needs cliclick), stdio | AX (`read_ui`/`ax_click`) first, then OmniParser screenshots, then raw coordinates. 72 tools incl. `run_shell`, `run_applescript` | 0★, last push 2026-08 [verified] |
| Apple, first-party | none | — | — | — | At WWDC26, MCP shipped only in Xcode 27 agent tooling. Siri and App Intents got no MCP client or server [reported; one source claims system-wide support, unconfirmed] | — |

Others worth knowing: mattt/iMCP (Swift, EventKit/Contacts, v1.4.1, May 2026); supermemoryai/apple-mcp (archived 2026-01-01); dvcrn/mcp-server-siri-shortcuts (GPL-3.0, so avoid bundling); recursechat/mcp-server-apple-shortcuts (Apache-2.0) [reported, ChatForest].

**Recommended set**
1. **Peekaboo** as the GUI-automation server, used for "act" and "sensitive" tiers. It is the only option that is well maintained and covers both AX and vision. Caveat: Peekaboo routes capture and input through a "Peekaboo Bridge" host process. TCC grants go to that host, not the shell that launched it (see its `docs/permissions.md`). We must decide whether the Hikari .app grants or Peekaboo.app grants. Test `--no-remote` so the grants land on Hikari as the responsible process.
2. **CursorTouch MacOS-MCP** as the fallback, or as an AX-only "lite" mode. It is Python + uvx and matches our core's stack. Disable its `Shell` tool, because Hikari has its own gated shell tool.
3. **Write our own small AppleScript/JXA tool in the Python core** (`osascript`, sensitive tier) instead of depending on the archived macos-automator-mcp. Its MIT-licensed recipe KB can be vendored as reference snippets.
4. Reject mb-dev (stale), Daemon OS and MacWright (immature, with unreviewed shell tools).

## 2. MCP client in Python

- `mcp` on PyPI: **2.3.0, released 2026-10-02**, MIT, Python ≥ 3.10 [verified]. v2 is a breaking release relative to 1.x.
- New high-level API: `Client(target)` used as an async context manager. The target can be a URL, a `StdioServerParameters`, a transport or an in-process server. There is no connect/close pair, and a `Client` can't be reused once its block exits. `ClientSession` and `stdio_client` still exist for low-level use.
- v2 renames attributes to snake_case: `input_schema`, `output_schema`, `is_error`, `structured_content`, `next_cursor`, `server_info`. Constructors still accept camelCase. Use `model_dump(by_alias=True)` for wire format. `McpError` is now `MCPError` (`e.message`). Timeouts are float seconds. HTTP uses `httpx2`.
- Stdio child env is a minimal allow-list (HOME, LOGNAME, PATH, SHELL, TERM, USER) plus `env=`. **PATH must include brew and node paths** when launching from a GUI app. Child stderr is inherited; use `Client(stdio_client(params, errlog=f))` to capture it.
- Error semantics: an exception thrown inside a tool comes back as `CallToolResult.is_error=True`. JSON-RPC and protocol errors raise `MCPError`.

```python
from mcp import Client, StdioServerParameters

params = StdioServerParameters(command="/opt/homebrew/bin/peekaboo", args=["mcp"],
                               env={"PATH": "/opt/homebrew/bin:/usr/bin:/bin"})

async def load_tools():
    async with Client(params) as c:            # spawns the child; cleans up on exit
        tools = (await c.list_tools()).tools     # paginate via next_cursor if needed
        oa = [{"type": "function", "function": {
                 "name": f"peekaboo__{t.name}"[:64],       # OpenAI: ^[a-zA-Z0-9_-]{1,64}$
                 "description": (t.description or "")[:1024],
                 "parameters": t.input_schema or {"type": "object", "properties": {}}}}
              for t in tools]
        res = await c.call_tool("see", {"app": "Safari"})
        # res.content: list of TextContent/ImageContent; res.structured_content; res.is_error
```

Schema-conversion notes: MCP `inputSchema` is already JSON Schema (`type: object`), so it passes straight through as `parameters`. Namespace names as `server__tool` to avoid collisions. Strip `$schema`. Inline `$ref`/`$defs` if the target model rejects them. For OpenAI `strict: true`, every property must be listed in `required` and `additionalProperties: false` must be set; leave `strict` off for third-party schemas. Map `ImageContent` to image input parts for vision models. Use tool `annotations` (`readOnlyHint`, `destructiveHint`) as **hints only** when assigning Hikari safety tiers. Keep a hand-maintained allow-list that maps tool to tier.

## 3. macOS TCC permissions

| Permission | Needed for | Check API | Prompt / plist | Settings deep link (anchor) |
|---|---|---|---|---|
| Accessibility (macOS 27: "Device Control and Data Access"; 27.3: split, see below) | AX tree reading, AX actions, CGEvent posting | `AXIsProcessTrusted()` / `AXIsProcessTrustedWithOptions({kAXTrustedCheckOptionPrompt: true})` | no plist key; user toggles it in Settings | `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` |
| Screen Recording ("Screen & System Audio Recording" since 14) | screenshots, ScreenCaptureKit | `CGPreflightScreenCaptureAccess()` (no prompt), `CGRequestScreenCaptureAccess()` (prompts; relaunch usually needed) | none | `…?Privacy_ScreenCapture` |
| Automation (Apple Events, per target app) | osascript to Music, Calendar, Finder, System Events | `AEDeterminePermissionToAutomateTarget` (prompt optional) | `NSAppleEventsUsageDescription` + hardened-runtime entitlement `com.apple.security.automation.apple-events` | `…?Privacy_Automation` |
| Microphone | voice input, wake word | `AVCaptureDevice.authorizationStatus(for: .audio)` | `NSMicrophoneUsageDescription` + `com.apple.security.device.audio-input` (hardened runtime) | `…?Privacy_Microphone` |
| Input Monitoring | only CGEventTap / global key listening | `CGPreflightListenEventAccess()` / `CGRequestListenEventAccess()` | none | `…?Privacy_ListenEvent` [unverified] |
| Calendars / Reminders (if EventKit) | native event and reminder access | `EKEventStore.authorizationStatus(for:)` | `NSCalendarsFullAccessUsageDescription`, `NSRemindersFullAccessUsageDescription` (macOS 14+) | `…?Privacy_Calendars` / `Privacy_Reminders` [unverified] |

- **Screen Recording re-prompt:** since macOS 15 the system re-confirms the grant **monthly** ("Allow For One Month"). The 15.1 update dropped the reboot/logout prompts. There is no developer bypass. No change to this cadence has been reported for 26 or 27. On 26.1, bare (non-bundled) executables reportedly don't appear in the Screen Recording list. **Always capture from a bundled, signed .app identity** [reported].
- **macOS 27 / 27.3 changes (affects us now):** macOS 27 renamed the Accessibility list to "Device Control and Data Access". The `Privacy_Accessibility` anchor reportedly still works on 27.2.1. In **27.3 beta 2 (2026-11-16)** Apple splits that setting into **"Accessibility"** (assistive tech, entitlement-gated for new installs) and **"System & App Protection Override"** (apps that control other apps). The new setting allows grants **per target app**, an **"ask every time"** mode, a **menu-bar indicator** while one app controls another, and limited Full Disk Access to chosen folders. Existing grants survive the update. Entitlement details are "available soon". The override may have to be added manually with "+" rather than prompted [reported, mjtsai]. Peekaboo already documents macOS 27 naming and an "Event Synthesizing" permission. **Action:** feature-detect at runtime, never hard-code pane names, plan onboarding around per-app override grants, and re-test on 27.3 betas.
- **Responsible process (sidecars):** TCC charges a protected operation to the *responsible code*. It finds that code by walking child → parent. A Python core or `node`/`uvx` MCP server spawned directly by the Tauri .app (via `posix_spawn` / `Command`) is normally attributed to **Hikari.app**. One grant covers everything, and the prompt text comes from Hikari's Info.plist, so **all usage-description keys must live in the Tauri bundle's Info.plist**. The chain breaks if a child daemonizes, re-parents to launchd, is launched via `open`/LaunchServices or as a launchd agent, or uses `responsibility_spawnattrs_setdisclaim`. Apple DTS (Quinn) confirmed in testing that a `Process`-spawned child inherited the parent's Input Monitoring. He also warned that this doesn't always behave as expected, so test each permission. `com.apple.security.inherit` is an App Sandbox entitlement and does **not** pass on TCC grants. Implication: `AXIsProcessTrusted()` called from the Python child reports the responsible app's status. This is fine, but call the checks from the Rust/Tauri side as well to be sure. Servers with their own host app (Peekaboo Bridge) take grants under *their* identity.
- **Global hotkey:** `tauri-plugin-global-shortcut` uses the `global-hotkey` crate. On macOS the crate registers normal shortcuts with Carbon **`RegisterEventHotKey`**, which needs **no** Input Monitoring or Accessibility. Only *media-key* hotkeys use a `CGEventTap` and need the permission [verified in source]. On Sequoia+, a shortcut must include a modifier other than Shift or Option alone.
- Deep links: the legacy `com.apple.preference.security?Privacy_*` anchors still route on Ventura through 27.2 [reported]. The Keyb project reports that Apple is phasing out the link in 27.3. Fall back to plain `x-apple.systempreferences:com.apple.preference.security` and show the written path.

## 4. Built-in tool implementation notes

- **Volume:** `osascript -e 'set volume output volume 40'`, `… output muted true`, `get volume settings`. Standard Additions sends no Apple Event to another app, so no Automation prompt [unverified on 27].
- **Brightness:** there is no public API. Options: (a) brew `brightness` (nriley, BSD-2), which uses undocumented calls that differ on Apple Silicon; (b) the private `DisplayServices` framework (`DisplayServicesSetBrightness`) via ctypes; (c) `m1ddc` for external DDC displays. Treat it as best-effort and feature-detect.
- **Do Not Disturb / Focus:** there is no supported CLI. Use **Shortcuts**: ship or ask the user to install shortcuts named "Hikari Focus On/Off" that use the "Set Focus" action, then run `shortcuts run "Hikari Focus On"`. sindresorhus/do-not-disturb-cli exists but is not validated on 26/27.
- **Shortcuts CLI:** `shortcuts list [--folders] [-f Folder]`, `shortcuts run "Name" [-i path] [-o path] [--output-type UTI]` (exit 0 or 1), `shortcuts view`. Shortcuts that ask questions block the process, so add a timeout. This is a good generic "act" tool: expose the user's shortcuts list as an enum.
- **Spotlight:** `mdfind -name foo`, `mdfind -onlyin ~/Documents 'kMDItemContentType == "com.adobe.pdf"'`, `mdfind 'kMDItemDisplayName == "*report*"c'`. Use `mdls` for metadata. Read tier; no TCC is needed beyond normal file access to protected folders.
- **Calendar / Reminders:** AppleScript (`tell application "Calendar"`) works but is slow on large calendars and needs an Automation grant. Prefer **EventKit via PyObjC** (`pyobjc-framework-EventKit`, `requestFullAccessToEvents` / `requestFullAccessToReminders`, macOS 14+). Its Info.plist keys must be in Hikari.app (responsible process). Creating or deleting events goes in the sensitive tier.
- **Music / Spotify:** `tell application "Music" to playpause | next track | previous track`, and `get name of current track`. Spotify keeps an AppleScript dictionary (`playpause`, `next track`, `player state`, `current track`) that has occasionally broken across releases. Check with `osascript -e 'id of app "Spotify"'` and handle errors. Each target app triggers its own Automation prompt.

## 5. Local wake word (Apple Silicon)

| Option | Version | License | Notes | Decision |
|---|---|---|---|---|
| **sherpa-onnx KWS** | 2.0.2 (PyPI, 2026-11-19) | Apache-2.0 (code) | Arm64 wheels for CPython 3.8–3.15. **Open-vocabulary**: "hey hikari" as tokens in a keywords file, no training. `sherpa_onnx.KeywordSpotter(...)`, `create_stream / is_ready / decode_stream / get_result`. Per-keyword boost `:x` and threshold `#y`. Models: gigaspeech-3.3M (en), zh-en-3M-2025-12-20. Very active (16k★) | **Chosen**. Tune threshold for false accepts and verify the model files' license |
| openWakeWord | 0.6.0 (2024-02-11); repo pushed 2025-12 | Code Apache-2.0; **pretrained models CC BY-NC-SA 4.0** | ONNX runtime works on macOS. A custom "hey hikari" model needs synthetic-data training (Colab). Release cadence stalled | Fallback. Only a self-trained model, never bundled pretrained models, if Hikari may go commercial |
| Picovoice Porcupine | pvporcupine 4.0.3 | Proprietary, AccessKey validated online | Free Tier reportedly **discontinued 2026-06-30**: keys disabled, "no non-commercial tier planned" (HA forum relaying a Picovoice email). FAQ says there are no personal plans | **Rejected**: licensing and online dependency |

## Recommendation summary

| Option | Version | License | Notes | Chosen / rejected (why) |
|---|---|---|---|---|
| Peekaboo MCP | 4.9.9 | MIT | AX + vision, very active, macOS 15+ | **Chosen**, primary GUI control. Settle which process holds the TCC grants (Bridge host) |
| CursorTouch MacOS-MCP | 0.4.7 | MIT | Python/uvx, AX-first | **Chosen**, fallback or lite mode, Shell tool disabled |
| macos-automator-mcp | 0.4.7 | MIT | Archived 2026-09-13 | **Rejected** as a dependency. Build our own osascript tool and vendor the recipes |
| mb-dev macos-ui-automation-mcp | 0.2.0 | MIT | Stale since 2025-08 | Rejected |
| Daemon OS | 1.0.1 | MIT | 3★, very new | Rejected (immature); revisit later |
| MacWright | none | MIT | 0★, 72 tools incl. shell | Rejected |
| Apple first-party MCP | — | — | Xcode 27 only | N/A. Watch App Intents |
| `mcp` Python SDK | 2.3.0 | MIT | v2 `Client` API, snake_case | **Chosen**. Pin `mcp>=2.3,<3` |
| sherpa-onnx KWS | 2.0.2 | Apache-2.0 | Open-vocabulary, arm64 wheels | **Chosen** |
| openWakeWord | 0.6.0 | Apache / CC BY-NC-SA models | Stalled releases | Fallback only |
| Porcupine | 4.0.3 | Proprietary | Free tier ended | Rejected |

## Sources
- https://github.com/steipete/macos-automator-mcp (archived flag and push date via GitHub API) · https://www.npmjs.com/package/@steipete/macos-automator-mcp
- https://github.com/openclaw/Peekaboo · https://github.com/openclaw/Peekaboo/blob/main/docs/permissions.md · https://www.npmjs.com/package/@steipete/peekaboo
- https://github.com/CursorTouch/MacOS-MCP · https://pypi.org/project/macos-mcp/
- https://pypi.org/project/macos-ui-automation-mcp/ · https://github.com/mb-dev/macos-ui-automation-mcp
- https://github.com/hammadxcm/daemon-os · https://github.com/ruchit-p/macwright
- https://chatforest.com/reviews/apple-macos-mcp-servers/ · https://www.stork.ai/blog/wwdc-2026-graded-what-apple-shipped-ios-27 · https://developer.apple.com/videos/play/wwdc2026/102/
- https://9to5mac.com/2025/09/22/macos-tahoe-26-1-beta-1-mcp-integration/
- https://pypi.org/project/mcp/2.3.0/ · https://py.sdk.modelcontextprotocol.io/client/ · https://py.sdk.modelcontextprotocol.io/client/transports/ · https://py.sdk.modelcontextprotocol.io/migration/
- https://developer.apple.com/news?id=oqng0zjk · https://mjtsai.com/blog/2026/11/17/system-app-protection-override/ · https://512pixels.net/2026/11/macos-27-3-bringing-new/ · https://support.apple.com/en-us/149699 · https://www.fonearena.com/blog/497107/macos-27-3-beta-2-privacy-controls-ai-apps.html
- https://github.com/Seb-GRAF/StableBar/pull/738 · https://github.com/ZevEisenberg/Keyb/issues/46
- https://www.macrumors.com/2024/08/15/macos-sequoia-screen-recording-app-permissions/ · https://macrumors.com/2024/10/07/apple-screen-recording-popup-update · https://developer.apple.com/forums/thread/807898
- https://developer.apple.com/forums/thread/805245 · https://www.qt.io/blog/the-curious-case-of-the-responsible-process · https://developer.apple.com/forums/thread/731504
- https://github.com/bvanpeski/SystemPreferences/blob/main/macos_preferencepanes-Ventura.md · https://gist.github.com/rmcdongit/f66ff91e0dad78d4d6346a75ded4b751
- https://github.com/tauri-apps/global-hotkey (src/platform_impl/macos/mod.rs) · https://developer.apple.com/forums/thread/735223 · https://developer.apple.com/forums/thread/763878
- https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess() · https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription · https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents(completion:)
- https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac · https://heyfocus.com/blog/how-to-turn-on-mac-focus-mode-from-the-terminal · https://github.com/sindresorhus/do-not-disturb-cli
- https://raw.githubusercontent.com/nriley/brightness/master/README.md · https://github.com/waydabber/m1ddc
- https://community.spotify.com/t5/Desktop-Mac/AppleScript-completely-broken/m-p/5530329
- https://k2-fsa.github.io/sherpa/onnx/kws/index.html · https://pypi.org/project/sherpa-onnx/ · https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/keyword-spotter.py
- https://github.com/dscripka/openWakeWord · https://pypi.org/project/openwakeword/
- https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744 · https://picovoice.ai/docs/faq/general/ · https://pypi.org/project/pvporcupine/
