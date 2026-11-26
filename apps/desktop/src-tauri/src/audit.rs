//! Audit log of the agent's actions (M7): every tool request, the person's decision and the result, one JSON object
//! per line in `<app data>/audit/audit.jsonl`.
//!
//! Append-only from the UI's point of view: there is no command to edit or delete a line. Rust stamps each line's
//! `ts` itself, accepts only the record kinds the UI writes (`request`, `decision`, `result`, `panic`), caps a line's
//! size, and rotates the file at `MAX_BYTES` (`audit.1.jsonl` … `audit.<KEEP>.jsonl`, oldest dropped). Clearing the
//! log asks in a native dialog the webview can't answer for the person, and leaves a `cleared` line behind.

use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const FILE: &str = "audit.jsonl";
/// Rotate when the current file would grow past this.
pub const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Rotated files kept besides the current one (so at most ~8 MB in all).
pub const KEEP: usize = 3;
/// Longest line accepted (the UI already truncates args and results well below this).
pub const MAX_LINE: usize = 64 * 1024;
const KINDS: [&str; 4] = ["request", "decision", "result", "panic"];
const READ_CAP: usize = 5000;

/// One writer at a time (appends, rotation and clear never interleave).
static LOCK: Mutex<()> = Mutex::new(());

pub fn dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("audit"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn rotated(dir: &Path, n: usize) -> PathBuf {
    dir.join(format!("audit.{n}.jsonl"))
}

/// Files newest first: current, .1, .2, …
fn files_newest_first(dir: &Path) -> Vec<PathBuf> {
    std::iter::once(dir.join(FILE))
        .chain((1..=KEEP).map(|n| rotated(dir, n)))
        .filter(|p| p.is_file())
        .collect()
}

fn rotate(dir: &Path) -> Result<(), String> {
    let oldest = rotated(dir, KEEP);
    if oldest.exists() {
        fs::remove_file(&oldest).map_err(|e| e.to_string())?;
    }
    for n in (1..KEEP).rev() {
        let from = rotated(dir, n);
        if from.exists() {
            fs::rename(&from, rotated(dir, n + 1)).map_err(|e| e.to_string())?;
        }
    }
    let cur = dir.join(FILE);
    if cur.exists() {
        fs::rename(&cur, rotated(dir, 1)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Validate, stamp and append one record. Returns the record as written.
pub fn append_to(dir: &Path, record: Value, ts: u64, max_bytes: u64) -> Result<Value, String> {
    let Value::Object(mut obj) = record else {
        return Err("audit record must be an object".into());
    };
    let kind = obj.get("kind").and_then(Value::as_str).unwrap_or("");
    if !KINDS.contains(&kind) {
        return Err(format!("audit: unknown record kind {kind:?}"));
    }
    write_line(dir, &mut obj, ts, max_bytes)
}

fn write_line(
    dir: &Path,
    obj: &mut Map<String, Value>,
    ts: u64,
    max_bytes: u64,
) -> Result<Value, String> {
    obj.insert("ts".into(), Value::from(ts));
    let line = serde_json::to_string(&obj).map_err(|e| e.to_string())?;
    if line.len() > MAX_LINE {
        return Err(format!("audit: record too large ({} bytes)", line.len()));
    }
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let cur = dir.join(FILE);
    let size = fs::metadata(&cur).map(|m| m.len()).unwrap_or(0);
    if size > 0 && size + line.len() as u64 + 1 > max_bytes {
        rotate(dir)?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&cur)
        .map_err(|e| e.to_string())?;
    f.write_all(format!("{line}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(Value::Object(obj.clone()))
}

/// The newest `limit` records across the current and rotated files, oldest first. Unparseable lines are skipped.
pub fn read_recent(dir: &Path, limit: usize) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for path in files_newest_first(dir) {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        for line in text.lines().rev() {
            if out.len() >= limit {
                break;
            }
            if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(line) {
                out.push(v);
            }
        }
        if out.len() >= limit {
            break;
        }
    }
    out.reverse();
    out
}

/// Remove every log file, then write a `cleared` line so the clear itself is on record.
pub fn clear_dir(dir: &Path, ts: u64) -> Result<Value, String> {
    {
        let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
        for p in files_newest_first(dir) {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    let mut obj = Map::new();
    obj.insert("kind".into(), Value::from("cleared"));
    write_line(dir, &mut obj, ts, MAX_BYTES)
}

/// Concatenate every file, oldest first, into `dest`.
pub fn export_to(dir: &Path, dest: &Path) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut out = fs::File::create(dest).map_err(|e| e.to_string())?;
    for p in files_newest_first(dir).into_iter().rev() {
        out.write_all(&fs::read(&p).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn audit_append<R: Runtime>(app: AppHandle<R>, record: Value) -> Result<Value, String> {
    let written = append_to(&dir(&app)?, record, now_ms(), MAX_BYTES)?;
    let _ = app.emit("audit://appended", &written);
    Ok(written)
}

#[tauri::command]
pub fn audit_read<R: Runtime>(
    app: AppHandle<R>,
    limit: Option<usize>,
) -> Result<Vec<Value>, String> {
    Ok(read_recent(
        &dir(&app)?,
        limit.unwrap_or(1000).min(READ_CAP),
    ))
}

#[tauri::command]
pub fn audit_reveal<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let d = dir(&app)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let file = d.join(FILE);
    let mut cmd = std::process::Command::new("open");
    if file.is_file() {
        cmd.arg("-R").arg(&file);
    } else {
        cmd.arg(&d);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Asks in a native dialog first; resolves `true` if the log was cleared.
#[tauri::command]
pub async fn audit_clear<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let a = app.clone();
    let ok = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .message("Every recorded action and decision will be deleted. This can't be undone.")
            .title("Clear the activity log?")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Clear Log".into(),
                "Cancel".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|e| e.to_string())?;
    if !ok {
        return Ok(false);
    }
    let written = clear_dir(&dir(&app)?, now_ms())?;
    log::info!("audit log cleared by the user");
    let _ = app.emit("audit://cleared", &written);
    Ok(true)
}

/// Native save dialog, then a full copy (oldest first). Resolves with the chosen path, or None if cancelled.
#[tauri::command]
pub async fn audit_export<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let a = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        a.dialog()
            .file()
            .set_file_name("hikari-activity.jsonl")
            .add_filter("JSON Lines", &["jsonl"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(fp) = picked else {
        return Ok(None);
    };
    let dest = fp.into_path().map_err(|e| e.to_string())?;
    export_to(&dir(&app)?, &dest)?;
    Ok(Some(dest.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("hikari-audit-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn appends_stamps_and_reads_back_in_order() {
        let d = tmp("order");
        for i in 0..5 {
            let w = append_to(
                &d,
                json!({"kind": "request", "callId": format!("c{i}"), "ts": 1}),
                1000 + i,
                MAX_BYTES,
            )
            .unwrap();
            // The UI's own ts is ignored; Rust stamps it.
            assert_eq!(w["ts"], json!(1000 + i));
        }
        let all = read_recent(&d, 100);
        assert_eq!(all.len(), 5);
        assert_eq!(all[0]["callId"], "c0");
        assert_eq!(all[4]["callId"], "c4");
        let last2 = read_recent(&d, 2);
        assert_eq!(
            last2
                .iter()
                .map(|v| v["callId"].clone())
                .collect::<Vec<_>>(),
            vec![json!("c3"), json!("c4")]
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_unknown_kinds_non_objects_and_huge_lines() {
        let d = tmp("reject");
        assert!(append_to(&d, json!({"kind": "cleared"}), 1, MAX_BYTES).is_err());
        assert!(append_to(&d, json!({"kind": "edit", "callId": "x"}), 1, MAX_BYTES).is_err());
        assert!(append_to(&d, json!(["request"]), 1, MAX_BYTES).is_err());
        let big = "x".repeat(MAX_LINE + 1);
        assert!(append_to(&d, json!({"kind": "result", "result": big}), 1, MAX_BYTES).is_err());
        assert!(read_recent(&d, 10).is_empty());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rotates_at_the_cap_and_keeps_reading_across_files() {
        let d = tmp("rotate");
        let cap = 300; // bytes: each line is ~60, so rotates every few lines
        for i in 0..40 {
            append_to(
                &d,
                json!({"kind": "result", "callId": format!("c{i:02}"), "ok": true}),
                i,
                cap,
            )
            .unwrap();
        }
        assert!(fs::metadata(d.join(FILE)).unwrap().len() <= cap);
        assert!(rotated(&d, 1).is_file() && rotated(&d, KEEP).is_file());
        assert!(!rotated(&d, KEEP + 1).exists());
        let all = read_recent(&d, 1000);
        // Oldest lines fell off with the dropped file; what's left is contiguous and ends at the newest.
        assert!(all.len() < 40 && all.len() > 10);
        assert_eq!(all.last().unwrap()["callId"], "c39");
        let ids: Vec<u64> = all.iter().map(|v| v["ts"].as_u64().unwrap()).collect();
        assert!(ids.windows(2).all(|w| w[1] == w[0] + 1));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn skips_corrupt_lines() {
        let d = tmp("corrupt");
        append_to(
            &d,
            json!({"kind": "panic", "pending": [], "running": []}),
            1,
            MAX_BYTES,
        )
        .unwrap();
        let mut f = OpenOptions::new().append(true).open(d.join(FILE)).unwrap();
        f.write_all(b"{not json\n\"a string\"\n").unwrap();
        append_to(
            &d,
            json!({"kind": "panic", "pending": [], "running": []}),
            2,
            MAX_BYTES,
        )
        .unwrap();
        assert_eq!(read_recent(&d, 10).len(), 2);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn clear_leaves_one_cleared_line_and_export_concatenates() {
        let d = tmp("clear");
        for i in 0..30 {
            append_to(
                &d,
                json!({"kind": "request", "callId": format!("c{i}")}),
                i,
                400,
            )
            .unwrap();
        }
        let out = d.with_extension("export.jsonl");
        export_to(&d, &out).unwrap();
        let exported = fs::read_to_string(&out).unwrap();
        let lines: Vec<&str> = exported.lines().collect();
        assert_eq!(lines.len(), read_recent(&d, 1000).len());
        assert!(lines.last().unwrap().contains("\"c29\""));
        let w = clear_dir(&d, 99).unwrap();
        assert_eq!(w["kind"], "cleared");
        let after = read_recent(&d, 10);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0]["ts"], 99);
        assert!(!rotated(&d, 1).exists());
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_file(&out);
    }
}
