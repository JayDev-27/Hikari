import React from "react";
import ReactDOM from "react-dom/client";
import { Stage } from "./stage/Stage";
import { Studio } from "./studio/Studio";
import { Chat } from "./chat/Chat";
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
    case "stage":
    default:
      return <Stage />;
  }
}

// Dev-only rig test (renders a model through bare Cubism, see src/dev/rigtest.ts).
if (import.meta.env.DEV && route === "rigtest") {
  void import("./dev/rigtest").then((m) => m.mount());
} else
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
