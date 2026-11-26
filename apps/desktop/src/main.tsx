import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { Stage } from "./stage/Stage";
import { Studio } from "./studio/Studio";
import { Chat } from "./chat/Chat";

// Panels that open rarely load on demand, so the stage's bundle stays small.
const Settings = lazy(() => import("./settings/Settings").then((m) => ({ default: m.Settings })));
const Memory = lazy(() => import("./memory/Memory").then((m) => ({ default: m.Memory })));
const VoiceLab = lazy(() => import("./voicelab/VoiceLab").then((m) => ({ default: m.VoiceLab })));
const Activity = lazy(() => import("./activity/Activity").then((m) => ({ default: m.Activity })));
const Confirm = lazy(() => import("./activity/Confirm").then((m) => ({ default: m.Confirm })));
const Onboarding = lazy(() => import("./onboarding/Onboarding").then((m) => ({ default: m.Onboarding })));
import "./styles.css";
import { installDiagnostics } from "./diagnostics";

installDiagnostics();

// One bundle, several windows: route on the hash (stage / chat / settings / studio …).
const route = (location.hash.replace(/^#\/?/, "").split("?")[0]) || "stage";
// Panels are normal opaque windows; only the stage is transparent.
if (route !== "stage") document.documentElement.classList.add("panel");

function App() {
  switch (route) {
    case "studio":
      return <Studio />;
    case "chat":
      return <Chat />;
    case "settings":
      return <Suspense fallback={null}><Settings /></Suspense>;
    case "memory":
      return <Suspense fallback={null}><Memory /></Suspense>;
    case "voicelab":
      return <Suspense fallback={null}><VoiceLab /></Suspense>;
    case "activity":
      return <Suspense fallback={null}><Activity /></Suspense>;
    case "confirm":
      return <Suspense fallback={null}><Confirm /></Suspense>;
    case "onboarding":
      return <Suspense fallback={null}><Onboarding /></Suspense>;
    case "stage":
    default:
      return <Stage />;
  }
}

// Dev-only rig test (renders a model through bare Cubism, see src/dev/rigtest.ts).
if (import.meta.env.DEV && route === "rigtest") {
  void import("./dev/rigtest").then((m) => m.mount());
} else if (import.meta.env.DEV && route === "tuner") {
  // Dev-only animation tuner (src/tuner): states, gestures, emotions, visemes and the layer numbers, live.
  void import("./tuner/mount").then((m) => m.mount());
} else
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
