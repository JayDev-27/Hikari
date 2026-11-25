//! Secondary windows (Character Studio, Chat): shown on demand, hidden on close.

use tauri::{AppHandle, Manager, Runtime, Window, WindowEvent};

/// Windows the frontend may ask to show. Anything else is refused.
pub const PANELS: [&str; 2] = ["studio", "chat"];

#[tauri::command]
pub fn show_window<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    show(&app, &label)
}

pub fn show<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<(), String> {
    if !PANELS.contains(&label) {
        return Err(format!("unknown window {label}"));
    }
    let w = app.get_webview_window(label).ok_or("window missing")?;
    w.show().map_err(|e| e.to_string())?;
    w.unminimize().map_err(|e| e.to_string())?;
    // Accessory app (no Dock icon): activate so the panel takes keyboard focus.
    #[cfg(target_os = "macos")]
    let _ = app.show();
    w.set_focus().map_err(|e| e.to_string())
}

/// Closing a panel hides it (keeps its state); the stage and the app keep running.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event
        && PANELS.contains(&window.label())
    {
        api.prevent_close();
        let _ = window.hide();
    }
}
