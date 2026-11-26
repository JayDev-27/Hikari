//! First-run onboarding: shown at launch until the user finishes it once. The "done"
//! flag lives in `onboarding.json` in the app config dir (same pattern as `dock.json`).
//!
//! Reopen it later with the `onboarding_open` command (e.g. from Settings) or
//! `onboarding::open(app)` from Rust (e.g. a tray item); it restarts at the first step.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const WINDOW: &str = "onboarding";
const FILE: &str = "onboarding.json";
/// Bump to show onboarding again to everyone (e.g. a new required permission).
const VERSION: u32 = 1;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    /// Onboarding version the user completed (0 = never).
    #[serde(default)]
    done_version: u32,
}

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE))
}

fn parse(bytes: &[u8]) -> State {
    serde_json::from_slice(bytes).unwrap_or_default()
}

/// Has the current onboarding been completed? Missing/unreadable file → no.
pub fn is_done<R: Runtime>(app: &AppHandle<R>) -> bool {
    path(app)
        .and_then(|p| std::fs::read(p).ok())
        .is_some_and(|b| parse(&b).done_version >= VERSION)
}

fn save<R: Runtime>(app: &AppHandle<R>, done_version: u32) -> Result<(), String> {
    let p = path(app).ok_or("no config dir")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&State { done_version }).map_err(|e| e.to_string())?;
    std::fs::write(&p, json).map_err(|e| format!("save {}: {e}", p.display()))
}

/// Startup: show onboarding on first run (call from `setup`, after the stage exists).
pub fn setup<R: Runtime>(app: &AppHandle<R>) {
    if is_done(app) {
        return;
    }
    if let Err(e) = crate::windows::show(app, WINDOW) {
        log::warn!("onboarding: {e}");
    }
}

/// Show onboarding again from its first step.
pub fn open<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let _ = app.emit_to(WINDOW, "onboarding://restart", ());
    crate::windows::show(app, WINDOW)
}

#[tauri::command]
pub fn onboarding_open<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open(&app)
}

/// Mark onboarding complete and close its window.
#[tauri::command]
pub fn onboarding_finish<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    save(&app, VERSION)?;
    if let Some(w) = app.get_webview_window(WINDOW) {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_bad_file_means_not_done() {
        assert_eq!(parse(b"").done_version, 0);
        assert_eq!(parse(b"{not json").done_version, 0);
        assert_eq!(parse(b"{}").done_version, 0);
        assert_eq!(parse(br#"{"doneVersion":1}"#).done_version, 1);
    }

    #[test]
    fn round_trip() {
        let j = serde_json::to_vec(&State {
            done_version: VERSION,
        })
        .unwrap();
        assert!(parse(&j).done_version >= VERSION);
    }
}
