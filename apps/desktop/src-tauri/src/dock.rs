//! "Show in Dock" preference: Regular activation policy (Dock icon + ⌘Tab) or
//! Accessory (menu bar only, the default). Persisted as a tiny JSON file in the
//! app config dir and applied at startup.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::stage::STAGE;

const FILE: &str = "dock.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Prefs {
    #[serde(default)]
    show_in_dock: bool,
}

/// Current value, so Reopen handling and the tray agree without re-reading disk.
pub struct DockState(pub AtomicBool);

fn path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(FILE))
}

/// Saved preference; missing or unreadable file → false (accessory).
pub fn load<R: Runtime>(app: &AppHandle<R>) -> bool {
    path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Prefs>(&b).ok())
        .unwrap_or_default()
        .show_in_dock
}

fn save<R: Runtime>(app: &AppHandle<R>, show: bool) {
    let Some(p) = path(app) else { return };
    let res = p
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let json = serde_json::to_vec_pretty(&Prefs { show_in_dock: show })
                .map_err(std::io::Error::other)?;
            std::fs::write(&p, json)
        });
    if let Err(e) = res {
        log::warn!("save {}: {e}", p.display());
    }
}

#[cfg(target_os = "macos")]
fn policy(show: bool) -> tauri::ActivationPolicy {
    if show {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    }
}

/// Startup: read the preference and apply it (call from `setup`).
pub fn init<R: Runtime>(app: &AppHandle<R>) -> bool {
    let show = load(app);
    app.manage(DockState(AtomicBool::new(show)));
    #[cfg(target_os = "macos")]
    if let Err(e) = app.set_activation_policy(policy(show)) {
        log::warn!("activation policy: {e}");
    }
    show
}

/// Tray toggle: switch policy, persist, and keep the user's windows where they were.
pub fn set_shown<R: Runtime>(app: &AppHandle<R>, show: bool) {
    if let Some(s) = app.try_state::<DockState>() {
        s.0.store(show, Ordering::Relaxed);
    }
    save(app, show);

    #[cfg(target_os = "macos")]
    {
        // Snapshot which panels are open (and which one has focus) before AppKit
        // reshuffles windows: dropping to Accessory deactivates the app, which can
        // order its windows out and leave nothing focused.
        let open: Vec<String> = crate::windows::PANELS
            .iter()
            .filter(|l| {
                app.get_webview_window(l)
                    .is_some_and(|w| w.is_visible().unwrap_or(false))
            })
            .map(|l| l.to_string())
            .collect();
        let focused = open.iter().find(|l| {
            app.get_webview_window(l)
                .is_some_and(|w| w.is_focused().unwrap_or(false))
        });
        let focused = focused.cloned();

        if let Err(e) = app.set_activation_policy(policy(show)) {
            log::warn!("activation policy: {e}");
            return;
        }
        // The policy change is applied asynchronously on the main thread; restore
        // once it has settled.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || restore(&app2, show, &open, focused.as_deref()));
        });
    }
}

#[cfg(target_os = "macos")]
fn restore<R: Runtime>(app: &AppHandle<R>, show: bool, open: &[String], focused: Option<&str>) {
    reshow_stage(app);
    for label in open {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.show();
        }
    }
    let target = focused.or(open.first().map(String::as_str));
    if let Some(w) = target.and_then(|l| app.get_webview_window(l)) {
        let _ = app.show();
        let _ = w.set_focus();
    } else if show {
        // Becoming a regular app: activate so the Dock icon and menu bar appear
        // as Hikari's straight away.
        let _ = app.show();
    }
}

/// Put the (non-activating, floating) stage panel back on screen if the user
/// has it shown, without making it key.
#[cfg(target_os = "macos")]
pub fn reshow_stage<R: Runtime>(app: &AppHandle<R>) {
    use std::sync::Arc;
    use tauri_nspanel::ManagerExt;
    let visible = app
        .state::<Arc<crate::stage::StageState>>()
        .visible
        .load(Ordering::Relaxed);
    if !visible {
        return;
    }
    match app.get_webview_panel(STAGE) {
        Ok(panel) => panel.order_front_regardless(),
        Err(_) => {
            if let Some(w) = app.get_webview_window(STAGE) {
                let _ = w.show();
            }
        }
    }
}
