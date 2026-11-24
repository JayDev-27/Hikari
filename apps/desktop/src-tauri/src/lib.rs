mod hotkeys;
mod packs;
mod windows;
mod stage;
mod tray;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                // Keep dependency chatter out of the debug log.
                .level_for("tao", log::LevelFilter::Info)
                .level_for("wry", log::LevelFilter::Info)
                .level_for("tauri", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_dialog::init())
        // Imported character packs: hikari-pack://localhost/<id>/<path> (real slashes, so
        // the Live2D engine's relative texture paths resolve; asset:// encodes them).
        .register_asynchronous_uri_scheme_protocol(packs::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || responder.respond(packs::serve(&app, &req)));
        })
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Arc::new(stage::StageState::default()))
        .invoke_handler(tauri::generate_handler![
            stage::set_click_through,
            packs::list_user_packs,
            packs::import_model,
            packs::delete_user_pack,
            windows::show_window,
        ])
        .on_window_event(windows::on_window_event)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle();
            stage::setup(handle)?;
            tray::setup(handle)?;
            hotkeys::setup(handle)?;
            // Debug builds: HIKARI_OPEN=studio,chat opens those panels at launch (testing without the tray).
            #[cfg(debug_assertions)]
            if let Ok(list) = std::env::var("HIKARI_OPEN") {
                for label in list.split(',').map(str::trim) {
                    if let Err(e) = windows::show(handle, label) {
                        log::warn!("HIKARI_OPEN {label}: {e}");
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hikari");
}
