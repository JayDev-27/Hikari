//! User character packs: import (Live2D folder / .zip / .vrm), validation,
//! listing, deletion, and the `hikari-pack://` URL scheme that serves them.
//!
//! Layout: `<app data>/characters/<id>/{character.json, model/…}`.
//! Built-in packs ship in the frontend bundle; a user pack with the same id
//! (e.g. a model imported into the empty "reze" slot) overrides the built-in.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

pub const SCHEME: &str = "hikari-pack";
const MAX_IMPORT_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB

pub fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("characters");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn slug(s: &str) -> String {
    let mut out: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    let out = out.trim_matches('-').chars().take(48).collect::<String>();
    if out.is_empty() { "character".into() } else { out }
}

// ---------------------------------------------------------------- listing

#[derive(Serialize)]
pub struct UserPack {
    pub id: String,
    pub pack: Value,
}

#[tauri::command]
pub fn list_user_packs<R: Runtime>(app: AppHandle<R>) -> Result<Vec<UserPack>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root(&app)?).map_err(|e| e.to_string())?.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid_id(&id) {
            continue;
        }
        let Ok(text) = fs::read_to_string(entry.path().join("character.json")) else { continue };
        match serde_json::from_str::<Value>(&text) {
            Ok(pack) => out.push(UserPack { id, pack }),
            Err(e) => log::warn!("skipping pack {id}: bad character.json: {e}"),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub fn delete_user_pack<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid pack id".into());
    }
    let dir = root(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- import

#[derive(Serialize, Debug)]
pub struct ImportResult {
    pub id: String,
    pub renderer: String,
    pub model_path: String,
    /// Licence info found in the model (VRM meta), or a note to record it.
    pub license: Value,
    pub warnings: Vec<String>,
}

/// Import a model into a user pack.
/// `src`: a folder containing a `.model3.json`, a `.model3.json` file, a `.zip`
/// of either, or a `.vrm` file. `base`: the pack JSON to start from (e.g. the
/// built-in franchise slot, so its persona is kept). `target_id`: overwrite this
/// pack id; otherwise one is derived from the model name.
#[tauri::command]
pub fn import_model<R: Runtime>(
    app: AppHandle<R>,
    src: String,
    base: Option<Value>,
    target_id: Option<String>,
) -> Result<ImportResult, String> {
    let root = root(&app)?;
    import_into(&root, Path::new(&src), base, target_id)
}

pub fn import_into(root: &Path, src: &Path, base: Option<Value>, target_id: Option<String>) -> Result<ImportResult, String> {
    if !src.exists() {
        return Err(format!("{} does not exist", src.display()));
    }
    let staging = tempdir_in(root)?;
    let result = (|| {
        let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        let (renderer, model_rel, license, warnings) = if src.is_file() && ext == "vrm" {
            let name = src.file_name().unwrap().to_string_lossy().to_string();
            fs::create_dir_all(staging.join("model")).map_err(|e| e.to_string())?;
            copy_file(src, &staging.join("model").join(&name))?;
            let meta = vrm_meta(&staging.join("model").join(&name))?;
            ("vrm".to_string(), format!("model/{name}"), meta.0, meta.1)
        } else {
            let live2d_dir = if src.is_file() && ext == "zip" {
                let out = staging.join("unzipped");
                unzip_safe(src, &out)?;
                out
            } else if src.is_file() && src.to_string_lossy().ends_with(".model3.json") {
                src.parent().unwrap().to_path_buf()
            } else if src.is_dir() {
                src.to_path_buf()
            } else {
                return Err("unsupported file: drop a Live2D folder, .model3.json, .zip or .vrm".into());
            };
            let model3 = find_model3(&live2d_dir).ok_or("no .model3.json found (Cubism 3+ models are supported)")?;
            let model_dir = model3.parent().unwrap().to_path_buf();
            let warnings = validate_model3(&model3)?;
            if dir_size(&model_dir)? > MAX_IMPORT_BYTES {
                return Err("model folder is larger than 1 GiB".into());
            }
            copy_dir(&model_dir, &staging.join("model"))?;
            let file = model3.file_name().unwrap().to_string_lossy().to_string();
            let license = json!({ "source": "Imported by the user", "terms": "Not embedded in Live2D models — record where this model came from and its usage terms.", "url": "" });
            ("live2d".to_string(), format!("model/{file}"), license, warnings)
        };
        if staging.join("unzipped").exists() {
            let _ = fs::remove_dir_all(staging.join("unzipped"));
        }

        let display = base
            .as_ref()
            .and_then(|b| b.get("displayName").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| {
                Path::new(&model_rel).file_stem().unwrap().to_string_lossy().replace(".model3", "")
            });
        let id = match target_id {
            Some(id) if valid_id(&id) => id,
            Some(_) => return Err("invalid target pack id".into()),
            None => unique_id(root, &slug(&display)),
        };
        let mut pack = base.unwrap_or_else(|| json!({ "persona": null, "defaultLanguage": "hinglish" }));
        let obj = pack.as_object_mut().ok_or("base pack must be an object")?;
        obj.insert("id".into(), json!(id));
        obj.insert("displayName".into(), json!(display));
        obj.insert("renderer".into(), json!(renderer));
        obj.insert("modelPath".into(), json!(model_rel));
        obj.insert("importSlot".into(), json!(false));
        obj.insert("imported".into(), json!(true));
        obj.insert("license".into(), license.clone());
        // Built-in maps are model-specific; a fresh model starts without them.
        if renderer == "live2d" {
            obj.entry("motionMap").or_insert(json!({ "idle": { "group": "Idle" }, "tap": { "group": "TapBody", "index": 0 } }));
        }
        obj.remove("expressionMap");
        fs::write(staging.join("character.json"), serde_json::to_vec_pretty(&pack).unwrap()).map_err(|e| e.to_string())?;

        let dest = root.join(&id);
        if dest.exists() {
            fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(&staging, &dest).map_err(|e| e.to_string())?;
        Ok(ImportResult { id, renderer, model_path: model_rel, license, warnings })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn tempdir_in(root: &Path) -> Result<PathBuf, String> {
    let d = root.join(format!(".import-{}", std::process::id() as u64 * 1000 + now_ms() % 1000));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn unique_id(root: &Path, base: &str) -> String {
    if !root.join(base).exists() {
        return base.to_string();
    }
    (2..).map(|n| format!("{base}-{n}")).find(|c| !root.join(c).exists()).unwrap()
}

fn find_model3(dir: &Path) -> Option<PathBuf> {
    // Breadth-first so a top-level model wins over nested backups.
    let mut queue = vec![dir.to_path_buf()];
    while !queue.is_empty() {
        let mut next = Vec::new();
        for d in queue {
            let mut entries: Vec<_> = fs::read_dir(&d).ok()?.flatten().map(|e| e.path()).collect();
            entries.sort();
            for p in &entries {
                if p.is_file() && p.to_string_lossy().ends_with(".model3.json") {
                    return Some(p.clone());
                }
            }
            next.extend(entries.into_iter().filter(|p| p.is_dir() && !is_hidden(p)));
        }
        queue = next;
    }
    None
}

fn is_hidden(p: &Path) -> bool {
    p.file_name().map(|n| n.to_string_lossy().starts_with('.') || n == "__MACOSX").unwrap_or(false)
}

/// Check that every file a .model3.json references exists. Missing Moc/textures
/// are errors; missing optional files (motions, expressions…) are warnings.
pub fn validate_model3(model3: &Path) -> Result<Vec<String>, String> {
    let text = fs::read_to_string(model3).map_err(|e| format!("can't read model3.json: {e}"))?;
    let j: Value = serde_json::from_str(&text).map_err(|e| format!("model3.json is not valid JSON: {e}"))?;
    let refs = j.get("FileReferences").ok_or("model3.json has no FileReferences")?;
    let dir = model3.parent().unwrap();
    let exists = |rel: &str| safe_rel(rel).map(|r| dir.join(r).is_file()).unwrap_or(false);
    let moc = refs.get("Moc").and_then(Value::as_str).ok_or("model3.json has no Moc file")?;
    if !exists(moc) {
        return Err(format!("missing Moc file: {moc}"));
    }
    let textures: Vec<&str> = refs.get("Textures").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    if textures.is_empty() {
        return Err("model3.json lists no textures".into());
    }
    for t in &textures {
        if !exists(t) {
            return Err(format!("missing texture: {t}"));
        }
    }
    let mut warnings = Vec::new();
    let mut optional: Vec<String> = Vec::new();
    for key in ["Physics", "Pose", "UserData", "DisplayInfo"] {
        if let Some(s) = refs.get(key).and_then(Value::as_str) {
            optional.push(s.to_string());
        }
    }
    if let Some(exps) = refs.get("Expressions").and_then(Value::as_array) {
        optional.extend(exps.iter().filter_map(|e| e.get("File").and_then(Value::as_str).map(str::to_string)));
    }
    if let Some(groups) = refs.get("Motions").and_then(Value::as_object) {
        for list in groups.values().filter_map(Value::as_array) {
            optional.extend(list.iter().filter_map(|m| m.get("File").and_then(Value::as_str).map(str::to_string)));
        }
    } else {
        warnings.push("no motions: she'll only have procedural idle animation".into());
    }
    let missing: Vec<_> = optional.iter().filter(|f| !exists(f)).collect();
    if !missing.is_empty() {
        warnings.push(format!("{} referenced file(s) missing, e.g. {}", missing.len(), missing[0]));
    }
    Ok(warnings)
}

/// Read licence metadata from a .vrm (GLB): VRM 1.0 `VRMC_vrm.meta` or VRM 0.x `VRM.meta`.
pub fn vrm_meta(path: &Path) -> Result<(Value, Vec<String>), String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 20];
    f.read_exact(&mut header).map_err(|_| "file too small to be a VRM")?;
    if &header[0..4] != b"glTF" {
        return Err("not a VRM/GLB file (bad magic)".into());
    }
    let chunk_len = u32::from_le_bytes(header[12..16].try_into().unwrap()) as usize;
    if &header[16..20] != b"JSON" || chunk_len > 64 * 1024 * 1024 {
        return Err("VRM has no JSON chunk".into());
    }
    let mut json_bytes = vec![0u8; chunk_len];
    f.read_exact(&mut json_bytes).map_err(|_| "truncated VRM JSON chunk")?;
    let gltf: Value = serde_json::from_slice(&json_bytes).map_err(|e| format!("bad VRM JSON: {e}"))?;
    let ext = gltf.get("extensions").ok_or("glTF without VRM extension (plain GLB is not a VRM)")?;
    let mut warnings = Vec::new();
    let license = if let Some(meta) = ext.pointer("/VRMC_vrm/meta") {
        let s = |k: &str| meta.get(k).cloned().unwrap_or(Value::Null);
        if s("avatarPermission") != json!("everyone") {
            warnings.push(format!("avatarPermission is {} — make sure you're allowed to use this avatar", s("avatarPermission")));
        }
        json!({
            "source": format!("VRM 1.0: {} by {}", meta.get("name").and_then(Value::as_str).unwrap_or("?"),
                meta.get("authors").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default()),
            "terms": format!("licence: {}; avatar permission: {}; commercial: {}; redistribution: {}; modification: {}; credit: {}",
                s("licenseUrl"), s("avatarPermission"), s("commercialUsage"), s("allowRedistribution"), s("modification"), s("creditNotation")),
            "url": s("licenseUrl"), "vrm": meta,
        })
    } else if let Some(meta) = ext.pointer("/VRM/meta") {
        let s = |k: &str| meta.get(k).cloned().unwrap_or(Value::Null);
        warnings.push("VRM 0.x model: the VRM renderer targets VRM 1.0 (0.x is converted on load)".into());
        json!({
            "source": format!("VRM 0.x: {} by {}", meta.get("title").and_then(Value::as_str).unwrap_or("?"), meta.get("author").and_then(Value::as_str).unwrap_or("?")),
            "terms": format!("licence: {}; allowed user: {}; commercial: {}; violent: {}; sexual: {}",
                s("licenseName"), s("allowedUserName"), s("commercialUssageName"), s("violentUssageName"), s("sexualUssageName")),
            "url": s("otherLicenseUrl"), "vrm": meta,
        })
    } else {
        return Err("glTF without VRM meta (plain GLB is not a VRM)".into());
    };
    Ok((license, warnings))
}

/// Extract a zip, rejecting entries that would escape `out` (zip-slip) and symlinks.
pub fn unzip_safe(zip_path: &Path, out: &Path) -> Result<(), String> {
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("not a valid zip: {e}"))?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().map(|n| n.to_string()).unwrap_or_else(|_| "<unreadable name>".into());
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("zip entry escapes the folder: {name}"));
        };
        if entry.is_symlink() {
            return Err(format!("zip contains a symlink: {name}"));
        }
        let target = out.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        total += entry.size();
        if total > MAX_IMPORT_BYTES {
            return Err("zip expands to more than 1 GiB".into());
        }
        if let Some(p) = target.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut w = fs::File::create(&target).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_file(a: &Path, b: &Path) -> Result<(), String> {
    fs::copy(a, b).map(|_| ()).map_err(|e| format!("copy {}: {e}", a.display()))
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for e in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        let ft = e.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() || is_hidden(&p) {
            continue; // never follow symlinks out of the model folder
        }
        if ft.is_dir() {
            copy_dir(&p, &dst.join(e.file_name()))?;
        } else {
            copy_file(&p, &dst.join(e.file_name()))?;
        }
    }
    Ok(())
}

fn dir_size(d: &Path) -> Result<u64, String> {
    let mut n = 0;
    for e in fs::read_dir(d).map_err(|e| e.to_string())?.flatten() {
        let ft = e.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            n += dir_size(&e.path())?;
        } else if ft.is_file() {
            n += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    Ok(n)
}

/// A relative path with no `..`, root or prefix components.
fn safe_rel(rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir)) {
        Some(p.to_path_buf())
    } else {
        None
    }
}

// ---------------------------------------------------------------- hikari-pack:// scheme

/// Resolve `hikari-pack://localhost/<id>/<path>` to a file inside the pack root.
pub fn resolve(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(uri_path.trim_start_matches('/')).decode_utf8().ok()?;
    let mut parts = decoded.splitn(2, '/');
    let id = parts.next()?;
    let rel = safe_rel(parts.next()?)?;
    if !valid_id(id) {
        return None;
    }
    let path = root.join(id).join(rel);
    // Defence in depth: the canonical path must stay inside the pack.
    let canon = path.canonicalize().ok()?;
    let pack = root.join(id).canonicalize().ok()?;
    canon.starts_with(&pack).then_some(canon)
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase().as_str() {
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "vrm" | "glb" => "model/gltf-binary",
        "vrma" => "model/gltf-binary",
        "moc3" => "application/octet-stream",
        "md" => "text/markdown; charset=utf-8",
        _ => "application/octet-stream",
    }
}

pub fn serve<R: Runtime>(app: &AppHandle<R>, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode};
    let respond = |status: StatusCode, ctype: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header("Content-Type", ctype)
            // Pixi fetches textures with CORS from tauri://localhost / http://localhost:1420.
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .unwrap()
    };
    let Ok(root) = root(app) else { return respond(StatusCode::INTERNAL_SERVER_ERROR, "text/plain", b"no data dir".to_vec()) };
    match resolve(&root, req.uri().path()) {
        Some(p) => match fs::read(&p) {
            Ok(bytes) => respond(StatusCode::OK, mime(&p), bytes),
            Err(_) => respond(StatusCode::NOT_FOUND, "text/plain", b"not found".to_vec()),
        },
        None => respond(StatusCode::NOT_FOUND, "text/plain", b"not found".to_vec()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hikari-packs-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn fake_live2d(dir: &Path, with_texture: bool) {
        fs::create_dir_all(dir.join("tex")).unwrap();
        fs::write(dir.join("Girl.moc3"), b"MOC3").unwrap();
        if with_texture {
            fs::write(dir.join("tex/t0.png"), b"PNG").unwrap();
        }
        fs::write(
            dir.join("Girl.model3.json"),
            r#"{"Version":3,"FileReferences":{"Moc":"Girl.moc3","Textures":["tex/t0.png"],"Physics":"Girl.physics3.json","Motions":{"Idle":[{"File":"m/idle.motion3.json"}]}}}"#,
        )
        .unwrap();
    }

    #[test]
    fn imports_live2d_folder_and_keeps_slot_persona() {
        let (root, src) = (tmp("root1"), tmp("src1"));
        fake_live2d(&src, true);
        let base = json!({ "id": "reze", "displayName": "Reze", "persona": "persona.md", "importSlot": true, "modelPath": null });
        let r = import_into(&root, &src, Some(base), Some("reze".into())).unwrap();
        assert_eq!(r.id, "reze");
        assert_eq!(r.renderer, "live2d");
        assert_eq!(r.model_path, "model/Girl.model3.json");
        assert!(r.warnings.iter().any(|w| w.contains("missing")), "physics/motion missing should warn: {:?}", r.warnings);
        let pack: Value = serde_json::from_str(&fs::read_to_string(root.join("reze/character.json")).unwrap()).unwrap();
        assert_eq!(pack["persona"], "persona.md");
        assert_eq!(pack["importSlot"], false);
        assert!(root.join("reze/model/tex/t0.png").is_file());
        assert!(!fs::read_dir(&root).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with(".import")));
    }

    #[test]
    fn rejects_live2d_with_missing_texture_and_cleans_up() {
        let (root, src) = (tmp("root2"), tmp("src2"));
        fake_live2d(&src, false);
        let e = import_into(&root, &src, None, None).unwrap_err();
        assert!(e.contains("missing texture"), "{e}");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0, "staging dir must be removed");
    }

    #[test]
    fn imports_zip_and_rejects_zip_slip() {
        let (root, src) = (tmp("root3"), tmp("src3"));
        fake_live2d(&src.join("inner"), true);
        let zip_path = src.join("model.zip");
        {
            let f = fs::File::create(&zip_path).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default();
            for rel in ["Girl.moc3", "tex/t0.png", "Girl.model3.json"] {
                z.start_file(format!("pack/{rel}"), opts).unwrap();
                z.write_all(&fs::read(src.join("inner").join(rel)).unwrap()).unwrap();
            }
            z.finish().unwrap();
        }
        let r = import_into(&root, &zip_path, None, None).unwrap();
        assert_eq!(r.id, "girl");
        assert!(root.join("girl/model/Girl.model3.json").is_file());

        let evil = src.join("evil.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
            z.start_file("../../escape.txt", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let e = import_into(&root, &evil, None, None).unwrap_err();
        assert!(e.contains("escapes"), "{e}");
    }

    #[test]
    fn reads_vrm1_meta_and_rejects_plain_glb() {
        let (root, src) = (tmp("root4"), tmp("src4"));
        let glb = |json: &str| {
            let mut j = json.as_bytes().to_vec();
            while !j.len().is_multiple_of(4) {
                j.push(b' ');
            }
            let mut b = Vec::new();
            b.extend_from_slice(b"glTF");
            b.extend_from_slice(&2u32.to_le_bytes());
            b.extend_from_slice(&((20 + j.len()) as u32).to_le_bytes());
            b.extend_from_slice(&(j.len() as u32).to_le_bytes());
            b.extend_from_slice(b"JSON");
            b.extend_from_slice(&j);
            b
        };
        fs::write(src.join("seed.vrm"), glb(r#"{"asset":{"version":"2.0"},"extensions":{"VRMC_vrm":{"specVersion":"1.0","meta":{"name":"Seed","authors":["VirtualCast"],"licenseUrl":"https://vrm.dev/licenses/1.0/","avatarPermission":"everyone","commercialUsage":"corporation","allowRedistribution":true,"modification":"allowModificationRedistribution","creditNotation":"required"}}}}"#)).unwrap();
        let r = import_into(&root, &src.join("seed.vrm"), None, None).unwrap();
        assert_eq!(r.renderer, "vrm");
        assert!(r.license["terms"].as_str().unwrap().contains("corporation"));
        assert!(r.warnings.is_empty());

        fs::write(src.join("plain.vrm"), glb(r#"{"asset":{"version":"2.0"}}"#)).unwrap();
        assert!(import_into(&root, &src.join("plain.vrm"), None, None).unwrap_err().contains("VRM"));
    }

    #[test]
    fn scheme_resolve_blocks_traversal() {
        let root = tmp("root5");
        fs::create_dir_all(root.join("girl/model")).unwrap();
        fs::write(root.join("girl/model/a.png"), b"x").unwrap();
        fs::write(root.join("secret.txt"), b"x").unwrap();
        assert!(resolve(&root, "/girl/model/a.png").is_some());
        assert!(resolve(&root, "/girl/model%2Fa.png").is_some(), "encoded slashes decode");
        assert!(resolve(&root, "/girl/../secret.txt").is_none());
        assert!(resolve(&root, "/girl/%2e%2e/secret.txt").is_none());
        assert!(resolve(&root, "/../secret.txt").is_none());
        assert!(resolve(&root, "/Girl/model/a.png").is_none(), "ids are lowercase slugs");
    }
}
