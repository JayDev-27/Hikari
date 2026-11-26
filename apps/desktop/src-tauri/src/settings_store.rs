//! Settings the core needs (provider and model per capability, hardware profile, default language), kept as
//! `settings.json` in the app config dir. The Settings window owns the shape (`src/settings/model.ts` validates
//! it); this side only checks it's a JSON object of sane size, writes it atomically and tells every window
//! (`settings://changed`), so the stage or the sidecar supervisor can forward it to the core once the protocol has
//! a message for it. API keys are never in here: they live in the Keychain (`secrets.rs`).

use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const FILE: &str = "settings.json";
const MAX_BYTES: usize = 64 * 1024;
pub const CHANGED: &str = "settings://changed";

fn path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join(FILE))
        .map_err(|e| e.to_string())
}

/// Saved settings, or `null` if there are none yet (or the file is unreadable: the UI falls back to defaults).
pub fn load_from(p: &Path) -> Value {
    std::fs::read(p)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(Value::is_object)
        .unwrap_or(Value::Null)
}

pub fn save_to(p: &Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("settings must be a JSON object".into());
    }
    let json = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if json.len() > MAX_BYTES {
        return Err("settings are too large".into());
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write next to it and rename, so a crash never leaves half a file.
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_load<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    Ok(load_from(&path(&app)?))
}

#[tauri::command]
pub fn settings_save<R: Runtime>(app: AppHandle<R>, settings: Value) -> Result<(), String> {
    save_to(&path(&app)?, &settings)?;
    if let Err(e) = app.emit(CHANGED, &settings) {
        log::warn!("{CHANGED}: {e}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_file() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!(
                "hikari-settings-test-{}-{nanos}",
                std::process::id()
            ))
            .join(FILE)
    }

    #[test]
    fn round_trip_and_guards() {
        let p = temp_file();
        assert_eq!(load_from(&p), Value::Null);

        let v = json!({ "version": 1, "profile": "lite", "providers": { "llm": { "provider": "groq" } } });
        save_to(&p, &v).unwrap();
        assert_eq!(load_from(&p), v);
        assert!(!p.with_extension("json.tmp").exists());

        assert!(save_to(&p, &json!([1, 2])).is_err());
        assert!(save_to(&p, &json!({ "x": "y".repeat(MAX_BYTES) })).is_err());
        assert_eq!(load_from(&p), v, "a refused save leaves the old file");

        std::fs::write(&p, b"{ not json").unwrap();
        assert_eq!(load_from(&p), Value::Null);

        std::fs::remove_dir_all(p.parent().unwrap()).unwrap();
    }
}
