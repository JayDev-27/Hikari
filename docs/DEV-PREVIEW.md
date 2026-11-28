# Browser preview

Use the browser preview for React and CSS work when you do not need a native macOS window or a Rust/Tauri command. It runs the same desktop UI bundle in Vite; it does not build or launch the native app.

## Start the preview

From the repository root, install dependencies once and start the desktop app's Vite server:

~~~bash
pnpm install
pnpm -F desktop dev
~~~

Open [http://localhost:1420](http://localhost:1420). The route is selected from the URL hash, so you can paste a route into the address bar or open several routes in separate tabs. The examples below assume the server is still running.

## Window routes

| Route | Window | What to expect in a browser |
|---|---|---|
| `#/` or `#/stage` | Stage | The avatar stage and caption bubble. The page renders the character model, but it is not a floating desktop window; native window dragging and desktop integration are unavailable. Without the Python core, live conversation and voice events are not connected. Double-clicking the stage plays the built-in mock turn. |
| `#/studio` | Character Studio | Browse and search character packs, inspect the selected character, and change the active character for the preview. Importing a file or folder needs the native Hikari app; the browser shows an explanatory error instead of opening a native file picker. |
| `#/chat` | Chat | The message composer and transcript. Typed messages are echoed locally; no AI response is generated. Use `window.hikariChat([...])` to inject a transcript, including a streaming reply. |
| `#/settings` | Settings | General, Providers, Performance and About pages. Provider statuses, memory usage, app size, key presence and startup settings use development sample/in-memory values. They are not the Mac's Keychain, real hardware statistics or LaunchAgent settings. You can deep-link to a page, for example `#/settings?page=providers`. |
| `#/memory` | Memories | A seeded set of sample memories is served by a stand-in core. Search, filters, edit and forget flows can be tried without the Python core. Use `#/memory?core=manual` to send requests without automatic replies and inject your own `memory.results`; use `#/memory?core=offline` to see the disconnected state. |
| `#/voicelab` | Voice Lab | Consent, Record, Train, Evaluate and Compare flows, backed by a development stand-in core. It starts with a sample ready voice and synthetic hum audio, not a real person's voice or a trained model. Use `#/voicelab?core=manual` to drive core replies yourself, or `#/voicelab?core=offline` to see the offline state. Browser microphone capture still requires browser permission. |
| `#/activity` | Activity | The action audit timeline. Browser records are stored in localStorage and broadcast to other preview tabs. Export downloads a JSONL file; Show in Finder is not available in a browser. |
| `#/confirm` | Confirm | The action-approval dialog. It is idle until a `tool.request` event is injected. Approving or denying writes to the browser preview audit log and records a `tool.confirm` message locally; it does not execute a real tool. |
| `#/onboarding` | Onboarding | The first-run welcome, character selection, permission, brain and talking steps. Permission states are simulated in DEV mode; no macOS permission prompt is opened and the browser cannot relaunch the native app. Progress is saved in localStorage under `hikari.onboarding`. |
| `#/tuner` | Animation tuner (DEV only) | A developer tool for inspecting and changing animation states, gestures, emotions, visemes and layer numbers. It is not part of the normal app windows. |
| `#/rigtest` | Rig test (DEV only) | A lower-level renderer test that mounts the bare Cubism rig. This is a developer utility, not a normal app window. |

Unknown hashes fall back to the Stage route. The Settings page query and the `core=` preview modes are hash query parameters, for example `http://localhost:1420/#/memory?core=manual`.

## Console hooks

Open the browser developer tools, select the Console, and run the examples after the matching route has loaded. These globals are installed only by the Vite development build; they are not production APIs.

### Core event bus — `window.hikariCore`

The bridge exposes `inject(type, payload, turnId?)` to deliver a protocol event to listeners in the current preview window. On the manual Memories route, this injects one result for the pending query:

~~~js
window.hikariCore.inject("memory.results", {
  items: [{
    id: "preview-memory-1",
    kind: "fact",
    text: "This memory was injected from the browser console.",
    namespace: localStorage.getItem("hikari.character") || "hiyori",
    confidence: 0.98,
    importance: 0.8,
    createdAt: Date.now()
  }],
  total: 1
});
~~~

Navigate to `#/memory?core=manual` before running it. The namespace is taken from the active character preference so the item appears in that character's list. The bus also records outbound `sendToCore` calls; inspect the latest ones with:

~~~js
window.hikariCore.sent.slice(-10)
~~~

For example, a Memory search records a `memory.query` message there.

### Chat transcript — `window.hikariChat`

On `#/chat`, pass an array of `ChatEvent` objects. A `her` event with `append: true` appends streamed text to the current reply, and `end` closes that reply:

~~~js
window.hikariChat([
  { kind: "user", text: "Hi Hikari.", turnId: "preview-1", via: "text" },
  { kind: "her", text: "Hello! ", turnId: "preview-1", append: true },
  { kind: "her", text: "This is a browser preview.", turnId: "preview-1", append: true },
  { kind: "end", text: "", turnId: "preview-1" }
]);
~~~

### Memory stand-in failure switch — `window.hikariMemory`

On the default `#/memory` route (stand-in core mode), set the next edit or delete operation to fail. Then edit or forget a memory to see the UI roll the optimistic change back:

~~~js
window.hikariMemory.failNext = true;
~~~

This switch is not present in `core=manual` or `core=offline` mode, because those modes do not create the stand-in core.

### Confirmation panic — `window.hikariPanic`

On `#/confirm`, inject an action-tier request to put a confirmation in the queue, then call the panic hook to clear the preview queue:

~~~js
window.hikariCore.inject("tool.request", {
  callId: "preview-action-1",
  tool: "demo.preview",
  tier: "act",
  summary: "Preview a pending action",
  args: { example: true },
  needsConfirmation: true
}, "preview-turn");

window.hikariPanic();
~~~

The request and panic are written to the local preview audit log. No external action is run.

### Onboarding permissions — `window.hikariPermissions`

On `#/onboarding`, navigate to the Permissions step, then change the simulated microphone permission:

~~~js
window.hikariPermissions.set("microphone", "denied");
window.hikariPermissions.get();
~~~

The UI polls the simulated report while the Permissions step is visible, so the status updates on its next refresh. Supported statuses are `granted`, `notDetermined`, `denied`, `restricted` and `unsupported`.

## What the browser preview does not replace

The preview is for fast UI iteration, not a substitute for native verification. It cannot reproduce macOS window behavior, native file/folder dialogs, Keychain access, LaunchAgent changes, real TCC permission prompts, Finder reveal, or the native Rust commands. Browser sample data and stand-in cores are development conveniences; they do not represent a running production core. Use the native app before merging changes that depend on those capabilities.

Useful implementation references: [route switch](../apps/desktop/src/main.tsx), [core bridge](../apps/desktop/src/ui/coreBridge.ts), [Chat preview](../apps/desktop/src/chat/Chat.tsx), [panel preview modes](../apps/desktop/src/memory/link.ts), [Onboarding permission stand-in](../apps/desktop/src/onboarding/permissions.ts), and [Activity browser audit store](../apps/desktop/src/activity/auditStore.ts).
