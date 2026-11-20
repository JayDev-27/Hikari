import React from "react";
import ReactDOM from "react-dom/client";
import { Stage } from "./stage/Stage";
import "./styles.css";
import { installDiagnostics } from "./diagnostics";

installDiagnostics();

// One bundle, several windows: route on the hash (stage / chat / settings / studio …).
const route = location.hash.replace(/^#\/?/, "") || "stage";

function App() {
  switch (route) {
    case "stage":
    default:
      return <Stage />;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
