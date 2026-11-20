mod hotkeys;
mod stage;
mod tray;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_nspanel::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Arc::new(stage::StageState::default()))
        .invoke_handler(tauri::generate_handler![stage::set_click_through])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle();
            stage::setup(handle)?;
            tray::setup(handle)?;
            hotkeys::setup(handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hikari");
}
