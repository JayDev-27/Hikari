import React from "react";
import ReactDOM from "react-dom/client";
import { Tuner } from "./Tuner";

/** Dev-only entry for `#/tuner` (main.tsx imports this lazily under import.meta.env.DEV). */
export function mount(): void {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Tuner />
    </React.StrictMode>,
  );
}
