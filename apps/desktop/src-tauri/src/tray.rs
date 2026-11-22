//! Menu-bar (tray) icon. Hikari runs as an accessory app: no Dock icon.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::stage::{self, STAGE};

/// Tray "Mute mic" item, kept so the ⌘⇧M hotkey can update its check mark.
pub struct MuteItem<R: Runtime>(pub CheckMenuItem<R>);

/// Single source of truth for mic mute (tray click and ⌘⇧M both land here).
pub fn set_muted<R: Runtime>(app: &AppHandle<R>, muted: bool) {
    if let Some(item) = app.try_state::<MuteItem<R>>() {
        let _ = item.0.set_checked(muted);
    }
    let _ = app.emit("hotkey://mute", muted);
}

pub fn toggle_muted<R: Runtime>(app: &AppHandle<R>) {
    let now = app.try_state::<MuteItem<R>>().and_then(|i| i.0.is_checked().ok()).unwrap_or(false);
    set_muted(app, !now);
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Hide Hikari", true, None::<&str>)?;
    let chat = MenuItem::with_id(app, "chat", "Chat…", true, None::<&str>)?;
    let studio = MenuItem::with_id(app, "studio", "Character Studio…", true, None::<&str>)?;
    let lock = CheckMenuItem::with_id(app, "lock", "Click-through lock", true, false, None::<&str>)?;
    let mute = CheckMenuItem::with_id(app, "mute", "Mute mic", true, false, None::<&str>)?;
    let panic = MenuItem::with_id(app, "panic", "Stop all actions", true, Some("CmdOrCtrl+Shift+Escape"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hikari", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &chat,
            &studio,
            &PredefinedMenuItem::separator(app)?,
            &lock,
            &mute,
            &PredefinedMenuItem::separator(app)?,
            &panic,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let toggle_c = toggle.clone();
    let lock_c = lock.clone();
    let mute_c = mute.clone();
    app.manage(MuteItem(mute.clone()));
    TrayIconBuilder::with_id("hikari")
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .icon_as_template(false)
        .tooltip("Hikari")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window(STAGE) {
                    let visible = w.is_visible().unwrap_or(true);
                    let _ = if visible { w.hide() } else { w.show() };
                    app.state::<std::sync::Arc<stage::StageState>>().visible.store(!visible, std::sync::atomic::Ordering::Relaxed);
                    // Frontend pauses its render loop while hidden.
                    let _ = app.emit_to(STAGE, "stage://visible", !visible);
                    let _ = toggle_c.set_text(if visible { "Show Hikari" } else { "Hide Hikari" });
                }
            }
            "chat" | "studio" => {
                if let Err(e) = crate::windows::show(app, ev.id().as_ref()) {
                    log::warn!("show window: {e}");
                }
            }
            "lock" => stage::set_locked(app, lock_c.is_checked().unwrap_or(false)),
            // The menu already flipped the check mark; broadcast the new value.
            "mute" => set_muted(app, mute_c.is_checked().unwrap_or(false)),
            "panic" => {
                let _ = app.emit("hotkey://panic", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
