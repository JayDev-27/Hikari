//! Stage window: transparent, always-on-top, on all Spaces, per-pixel click-through.
//!
//! Click-through strategy (same family as BongoCat / WindowPet): while a window
//! ignores cursor events the webview receives no mouse events at all, so the
//! frontend can't hit-test by itself. A Rust thread polls the *global* cursor
//! position (30 Hz near her / 8 Hz otherwise, only emitting on change) and sends it to the stage in window
//! coordinates; the frontend hit-tests against the avatar's alpha / hit areas and
//! calls `set_click_through` only when the answer flips.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub const STAGE: &str = "stage";

pub struct StageState {
    /// Current ignore-cursor-events value, to avoid redundant AppKit calls.
    pub ignoring: AtomicBool,
    /// User lock from the tray: "always click-through" (she can't be grabbed).
    pub locked: AtomicBool,
    /// Stage shown (tray "Hide Hikari" clears it): pauses cursor polling.
    pub visible: AtomicBool,
}

impl Default for StageState {
    fn default() -> Self {
        Self { ignoring: AtomicBool::new(false), locked: AtomicBool::new(false), visible: AtomicBool::new(true) }
    }
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
        log::debug!("stage click-through: {}", if ignore { "on (clicks pass through)" } else { "off (Hikari takes clicks)" });
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

#[cfg(target_os = "macos")]
tauri_nspanel::tauri_panel! {
    panel!(StagePanel {
        config: {
            // Key only when needed (e.g. a future text field), never main:
            // clicking/dragging her must not steal focus from the user's app.
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })
}

/// Convert the stage into a non-activating NSPanel that floats over every
/// Space, including other apps' fullscreen Spaces (plain NSWindow + setLevel
/// does neither reliably and activates Hikari on click).
#[cfg(target_os = "macos")]
fn macos_float(window: &WebviewWindow) -> tauri::Result<()> {
    use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt};
    let panel = window
        .to_panel::<StagePanel>()
        .map_err(|e| tauri::Error::Anyhow(anyhow::anyhow!("to_panel: {e:?}")))?;
    if let Err(e) = panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().into()) {
        log::warn!("stage style mask: {e:?}");
    }
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .full_screen_auxiliary()
            .stationary()
            .ignores_cycle()
            .into(),
    );
    // Floating (4) sits above normal app windows but below the menu bar and
    // system UI; with FullScreenAuxiliary it also shows over fullscreen apps.
    panel.set_level(PanelLevel::Floating.value());
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_has_shadow(false);
    panel.order_front_regardless();
    Ok(())
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
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
    macos_float(&window)?;

    // Start click-through; the first cursor event over her flips it off.
    window.set_ignore_cursor_events(true)?;
    app.state::<Arc<StageState>>().ignoring.store(true, Ordering::Relaxed);

    spawn_cursor_poll(window, app.state::<Arc<StageState>>().inner().clone());
    Ok(())
}

/// Stage geometry in global logical points, cached from window events so the
/// poll thread never makes a main-thread round trip (each Tauri window getter
/// is a synchronous hop to the event loop — polling four of them at 30 Hz cost
/// ~5 % CPU while idle).
#[derive(Clone, Copy, Default)]
struct Geometry {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn read_geometry<R: Runtime>(w: &WebviewWindow<R>) -> Option<Geometry> {
    let scale = w.scale_factor().ok()?;
    let pos = w.outer_position().ok()?;
    let size = w.outer_size().ok()?;
    Some(Geometry {
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        w: size.width as f64 / scale,
        h: size.height as f64 / scale,
    })
}

/// Global cursor in logical points (top-left origin of the main display).
#[cfg(target_os = "macos")]
fn cursor_points<R: Runtime>(_w: &WebviewWindow<R>) -> Option<(f64, f64)> {
    use objc2_core_graphics::CGEvent;
    // CGEventCreate + CGEventGetLocation: thread-safe, no main-thread hop, no TCC permission.
    let ev = CGEvent::new(None)?;
    let p = CGEvent::location(Some(&ev));
    Some((p.x, p.y))
}

#[cfg(not(target_os = "macos"))]
fn cursor_points<R: Runtime>(w: &WebviewWindow<R>) -> Option<(f64, f64)> {
    let scale = w.scale_factor().ok()?;
    let c = w.cursor_position().ok()?;
    Some((c.x / scale, c.y / scale))
}

/// Polls 30 Hz while the cursor is near her or moving (smooth hover + eye-follow),
/// 8 Hz when it is far away and still, and not at all while she is hidden.
/// Emits only on change.
fn spawn_cursor_poll<R: Runtime>(window: WebviewWindow<R>, state: Arc<StageState>) {
    let geo = Arc::new(std::sync::RwLock::new(read_geometry(&window).unwrap_or_default()));
    {
        let geo = geo.clone();
        let w = window.clone();
        window.on_window_event(move |ev| {
            let relevant = matches!(
                ev,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            );
            if let (true, Some(g)) = (relevant, read_geometry(&w)) {
                *geo.write().unwrap() = g;
            }
        });
    }
    std::thread::spawn(move || {
        const NEAR: f64 = 160.0; // points around the window that count as "near"
        let mut last = (f64::NAN, f64::NAN, f64::NAN, f64::NAN);
        let mut last_motion = std::time::Instant::now();
        loop {
            if !state.visible.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(250));
                continue;
            }
            let Some((cx, cy)) = cursor_points(&window) else {
                std::thread::sleep(Duration::from_millis(125));
                continue;
            };
            let g = *geo.read().unwrap();
            let key = (cx, cy, g.x, g.y);
            let changed = key != last;
            if changed {
                last = key;
                last_motion = std::time::Instant::now();
                let (rx, ry) = (cx - g.x, cy - g.y);
                let inside = rx >= 0.0 && ry >= 0.0 && rx < g.w && ry < g.h;
                let _ = window.emit_to(STAGE, "stage://cursor", CursorEvent { x: rx, y: ry, inside, gx: cx, gy: cy });
            }
            let near = cx > g.x - NEAR && cx < g.x + g.w + NEAR && cy > g.y - NEAR && cy < g.y + g.h + NEAR;
            let recent = last_motion.elapsed() < Duration::from_secs(1);
            std::thread::sleep(Duration::from_millis(if near || recent { 33 } else { 125 }));
        }
    });
}
