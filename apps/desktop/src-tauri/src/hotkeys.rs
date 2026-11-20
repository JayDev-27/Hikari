//! Global hotkeys. Defaults (configurable later from Settings):
//!   Option+Space          push-to-talk (hold)
//!   Cmd+Shift+M           toggle mic mute
//!   Cmd+Shift+Escape      PANIC: stop speech + cancel every agent action

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Serialize)]
struct Ptt {
    pressed: bool,
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let ptt = Shortcut::new(Some(Modifiers::ALT), Code::Space);
    let mute = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyM);
    let panic = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Escape);

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, sc, ev| {
                if sc == &ptt {
                    let _ = app.emit("hotkey://ptt", Ptt { pressed: ev.state() == ShortcutState::Pressed });
                } else if ev.state() == ShortcutState::Pressed {
                    if sc == &mute {
                        let _ = app.emit("hotkey://mute-toggle", ());
                    } else if sc == &panic {
                        let _ = app.emit("hotkey://panic", ());
                    }
                }
            })
            .build(),
    )?;
    let gs = app.global_shortcut();
    for sc in [ptt, mute, panic] {
        if let Err(e) = gs.register(sc) {
            log::warn!("hotkey {sc:?} unavailable: {e}");
        }
    }
    Ok(())
}
