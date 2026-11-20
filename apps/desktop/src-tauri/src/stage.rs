//! Stage window: transparent, always-on-top, on all Spaces, per-pixel click-through.
//!
//! Click-through strategy (same family as BongoCat / WindowPet): while a window
//! ignores cursor events the webview receives no mouse events at all, so the
//! frontend can't hit-test by itself. A Rust thread polls the *global* cursor
//! position (~30 Hz, only emitting on change) and sends it to the stage in window
//! coordinates; the frontend hit-tests against the avatar's alpha / hit areas and
//! calls `set_click_through` only when the answer flips.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub const STAGE: &str = "stage";

#[derive(Default)]
pub struct StageState {
    /// Current ignore-cursor-events value, to avoid redundant AppKit calls.
    pub ignoring: AtomicBool,
    /// User lock from the tray: "always click-through" (she can't be grabbed).
    pub locked: AtomicBool,
}

#[derive(Clone, Serialize)]
struct CursorEvent {
    /// Cursor in stage-window logical px (may be outside the window).
    x: f64,
    y: f64,
    inside: bool,
    /// Cursor in global logical px, for eye-follow across the whole screen.
    gx: f64,
    gy: f64,
}

#[tauri::command]
pub fn set_click_through<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, Arc<StageState>>,
    ignore: bool,
) -> Result<(), String> {
    let ignore = ignore || state.locked.load(Ordering::Relaxed);
    if state.ignoring.swap(ignore, Ordering::Relaxed) != ignore {
        window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn set_locked<R: Runtime>(app: &AppHandle<R>, locked: bool) {
    let state = app.state::<Arc<StageState>>();
    state.locked.store(locked, Ordering::Relaxed);
    if let Some(w) = app.get_webview_window(STAGE) {
        let _ = w.set_ignore_cursor_events(locked);
        state.ignoring.store(locked, Ordering::Relaxed);
    }
}

/// Extra AppKit tweaks Tauri doesn't expose: float over fullscreen apps and
/// join every Space (incl. fullscreen Spaces) without stealing focus.
#[cfg(target_os = "macos")]
fn macos_float<R: Runtime>(window: &WebviewWindow<R>) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(ptr) = window.ns_window() else { return };
    // Called from the Tauri `setup` hook, which runs on the main thread (AppKit requirement).
    // SAFETY: `ns_window` returns a live NSWindow pointer owned by tao for this window's lifetime.
    let ns: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
    ns.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    // NSStatusWindowLevel (25): above normal and fullscreen app windows.
    ns.setLevel(25);
    ns.setHasShadow(false);
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let window = app
        .get_webview_window(STAGE)
        .expect("stage window declared in tauri.conf.json");

    // Park her bottom-right of the primary monitor, above the Dock.
    if let Ok(Some(mon)) = window.primary_monitor() {
        let scale = mon.scale_factor();
        let area = mon.work_area();
        let size = window.outer_size()?;
        let x = area.position.x + area.size.width as i32 - size.width as i32 - (24.0 * scale) as i32;
        let y = area.position.y + area.size.height as i32 - size.height as i32;
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }

    #[cfg(target_os = "macos")]
    macos_float(&window);

    // Start click-through; the first cursor event over her flips it off.
    window.set_ignore_cursor_events(true)?;
    app.state::<Arc<StageState>>().ignoring.store(true, Ordering::Relaxed);

    spawn_cursor_poll(window);
    Ok(())
}

fn spawn_cursor_poll<R: Runtime>(window: WebviewWindow<R>) {
    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN, 0i32, 0i32);
        loop {
            std::thread::sleep(Duration::from_millis(33));
            let (Ok(cur), Ok(pos), Ok(size), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let key = (cur.x, cur.y, pos.x, pos.y);
            if key == last {
                continue;
            }
            last = key;
            let rx = cur.x - pos.x as f64;
            let ry = cur.y - pos.y as f64;
            let inside = rx >= 0.0 && ry >= 0.0 && rx < size.width as f64 && ry < size.height as f64;
            let _ = window.emit_to(
                STAGE,
                "stage://cursor",
                CursorEvent { x: rx / scale, y: ry / scale, inside, gx: cur.x / scale, gy: cur.y / scale },
            );
        }
    });
}
