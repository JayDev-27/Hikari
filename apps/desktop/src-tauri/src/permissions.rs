//! Runtime TCC (privacy permission) detection for onboarding.
//!
//!   Microphone        AVCaptureDevice authorizationStatusForMediaType: / requestAccessForMediaType:
//!   Accessibility     AXIsProcessTrusted / AXIsProcessTrustedWithOptions({prompt: true})
//!   Screen Recording  CGPreflightScreenCaptureAccess / CGRequestScreenCaptureAccess
//!
//! Only the microphone has a real "not determined" state. Accessibility and Screen
//! Recording answer yes/no, so we remember whether Hikari has asked (`asked.json` in the
//! app config dir): no + never asked = not determined, no + asked = denied.
//!
//! All checks are cheap, synchronous and read-only, so the UI polls `permissions_status`
//! (about once a second while the permissions step is open) and the status flips live
//! when the user toggles Hikari in System Settings. Screen Recording is the exception:
//! macOS usually only reports a new grant after the app relaunches (`relaunch_app`).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    Microphone,
    Accessibility,
    ScreenRecording,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Granted,
    NotDetermined,
    Denied,
    /// Blocked by a device-management profile or parental controls; the user can't change it.
    Restricted,
    /// Not macOS (or the API is missing).
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub microphone: Status,
    pub accessibility: Status,
    pub screen_recording: Status,
}

/// `AVAuthorizationStatus` → Status (0 notDetermined, 1 restricted, 2 denied, 3 authorized).
pub fn map_av(raw: isize) -> Status {
    match raw {
        0 => Status::NotDetermined,
        1 => Status::Restricted,
        2 => Status::Denied,
        3 => Status::Granted,
        _ => Status::Unsupported,
    }
}

/// Yes/no APIs (AX, screen capture): "no" means denied only once Hikari has asked.
pub fn map_bool(granted: bool, asked: bool) -> Status {
    match (granted, asked) {
        (true, _) => Status::Granted,
        (false, false) => Status::NotDetermined,
        (false, true) => Status::Denied,
    }
}

/// System Settings → Privacy & Security pane for each permission.
pub fn settings_url(p: Permission) -> &'static str {
    match p {
        Permission::Microphone => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        Permission::Accessibility => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        Permission::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
    }
}

// ---------- "has Hikari asked?" memory ----------

const ASKED_FILE: &str = "permissions.json";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Asked {
    #[serde(default)]
    accessibility: bool,
    #[serde(default)]
    screen_recording: bool,
}

fn asked_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(ASKED_FILE))
}

fn load_asked<R: Runtime>(app: &AppHandle<R>) -> Asked {
    asked_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn mark_asked<R: Runtime>(app: &AppHandle<R>, p: Permission) {
    let mut a = load_asked(app);
    match p {
        Permission::Accessibility => a.accessibility = true,
        Permission::ScreenRecording => a.screen_recording = true,
        Permission::Microphone => return,
    }
    let Some(path) = asked_path(app) else { return };
    let res = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, serde_json::to_vec_pretty(&a).unwrap_or_default()));
    if let Err(e) = res {
        log::warn!("save {}: {e}", path.display());
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn permissions_status<R: Runtime>(app: AppHandle<R>) -> Report {
    let asked = load_asked(&app);
    let report = Report {
        microphone: sys::microphone(),
        accessibility: sys::accessibility(asked.accessibility),
        screen_recording: sys::screen_recording(asked.screen_recording),
    };
    // Log changes only (the UI polls every second): useful in support logs.
    static LAST: Mutex<Option<Report>> = Mutex::new(None);
    if let Ok(mut last) = LAST.lock()
        && last.as_ref() != Some(&report)
    {
        log::info!(
            "permissions: microphone={:?} accessibility={:?} screen_recording={:?}",
            report.microphone,
            report.accessibility,
            report.screen_recording
        );
        *last = Some(report.clone());
    }
    report
}

/// Ask for a permission. Shows the system prompt when macOS still allows one (first
/// time); otherwise opens the right System Settings pane. Returns the status right
/// after asking (the microphone answer arrives asynchronously, so keep polling).
#[tauri::command]
pub fn permission_request<R: Runtime>(app: AppHandle<R>, permission: Permission) -> Status {
    let asked = load_asked(&app);
    let status = match permission {
        Permission::Microphone => sys::microphone(),
        Permission::Accessibility => sys::accessibility(asked.accessibility),
        Permission::ScreenRecording => sys::screen_recording(asked.screen_recording),
    };
    match (permission, status) {
        (_, Status::Granted | Status::Restricted | Status::Unsupported) => return status,
        (Permission::Microphone, Status::NotDetermined) => sys::request_microphone(),
        // AX shows its own "open System Settings" alert the first time; after that it's
        // silent, so open the pane ourselves.
        (Permission::Accessibility, Status::NotDetermined) => sys::prompt_accessibility(),
        // Registers Hikari in the Screen Recording list and (first time) shows the alert.
        (Permission::ScreenRecording, Status::NotDetermined) => sys::request_screen_recording(),
        (_, _) => open_settings(permission),
    }
    mark_asked(&app, permission);
    match permission {
        Permission::Microphone => sys::microphone(),
        Permission::Accessibility => sys::accessibility(true),
        Permission::ScreenRecording => sys::screen_recording(true),
    }
}

/// Open System Settings at the permission's Privacy & Security pane.
#[tauri::command]
pub fn permission_open_settings(permission: Permission) {
    open_settings(permission);
}

/// Quit and reopen Hikari (Screen Recording grants usually need a relaunch to apply).
#[tauri::command]
pub fn relaunch_app<R: Runtime>(app: AppHandle<R>) {
    app.restart();
}

fn open_settings(p: Permission) {
    // Fixed URLs only; never anything from the webview.
    if let Err(e) = std::process::Command::new("/usr/bin/open")
        .arg(settings_url(p))
        .spawn()
    {
        log::warn!("open System Settings: {e}");
    }
}

#[cfg(target_os = "macos")]
mod sys {
    use super::{Status, map_av, map_bool};
    use std::ffi::c_void;

    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};

    type CFTypeRef = *const c_void;

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeAudio: &'static AnyObject;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: CFTypeRef;
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        fn CFDictionaryCreate(
            allocator: CFTypeRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFTypeRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        static kAXTrustedCheckOptionPrompt: CFTypeRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    fn capture_device() -> Option<&'static AnyClass> {
        AnyClass::get(c"AVCaptureDevice")
    }

    pub fn microphone() -> Status {
        let Some(cls) = capture_device() else {
            return Status::Unsupported;
        };
        // SAFETY: class method with an NSString media type, returns NSInteger.
        let raw: isize =
            unsafe { msg_send![cls, authorizationStatusForMediaType: AVMediaTypeAudio] };
        map_av(raw)
    }

    pub fn request_microphone() {
        let Some(cls) = capture_device() else { return };
        // The answer arrives on a background queue; the UI polls for it.
        let done =
            RcBlock::new(|granted: Bool| log::info!("microphone access: {}", granted.as_bool()));
        // SAFETY: documented class method; the block is copied by the callee.
        unsafe {
            let _: () = msg_send![cls, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*done];
        }
    }

    pub fn accessibility(asked: bool) -> Status {
        // SAFETY: no arguments, thread-safe query.
        map_bool(unsafe { AXIsProcessTrusted() }, asked)
    }

    pub fn prompt_accessibility() {
        // SAFETY: a one-entry CFDictionary {kAXTrustedCheckOptionPrompt: true}, released after use.
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanTrue];
            let opts = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &raw const kCFTypeDictionaryKeyCallBacks,
                &raw const kCFTypeDictionaryValueCallBacks,
            );
            if opts.is_null() {
                return;
            }
            AXIsProcessTrustedWithOptions(opts);
            CFRelease(opts);
        }
    }

    pub fn screen_recording(asked: bool) -> Status {
        // SAFETY: no arguments; never prompts.
        map_bool(unsafe { CGPreflightScreenCaptureAccess() }, asked)
    }

    pub fn request_screen_recording() {
        // SAFETY: no arguments; prompts at most once per app.
        unsafe { CGRequestScreenCaptureAccess() };
    }
}

#[cfg(not(target_os = "macos"))]
mod sys {
    use super::Status;
    pub fn microphone() -> Status {
        Status::Unsupported
    }
    pub fn request_microphone() {}
    pub fn accessibility(_: bool) -> Status {
        Status::Unsupported
    }
    pub fn prompt_accessibility() {}
    pub fn screen_recording(_: bool) -> Status {
        Status::Unsupported
    }
    pub fn request_screen_recording() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn av_status_mapping() {
        assert_eq!(map_av(0), Status::NotDetermined);
        assert_eq!(map_av(1), Status::Restricted);
        assert_eq!(map_av(2), Status::Denied);
        assert_eq!(map_av(3), Status::Granted);
        assert_eq!(map_av(7), Status::Unsupported);
    }

    #[test]
    fn yes_no_mapping_uses_asked() {
        assert_eq!(map_bool(true, false), Status::Granted);
        assert_eq!(map_bool(true, true), Status::Granted);
        assert_eq!(map_bool(false, false), Status::NotDetermined);
        assert_eq!(map_bool(false, true), Status::Denied);
    }

    #[test]
    fn settings_urls_target_privacy_panes() {
        for (p, pane) in [
            (Permission::Microphone, "Privacy_Microphone"),
            (Permission::Accessibility, "Privacy_Accessibility"),
            (Permission::ScreenRecording, "Privacy_ScreenCapture"),
        ] {
            let url = settings_url(p);
            assert!(url.starts_with("x-apple.systempreferences:com.apple.preference.security?"));
            assert!(url.ends_with(pane));
        }
    }

    #[test]
    fn wire_format_is_camel_case() {
        let r = Report {
            microphone: Status::NotDetermined,
            accessibility: Status::Granted,
            screen_recording: Status::Denied,
        };
        let j = serde_json::to_string(&r).unwrap();
        assert_eq!(
            j,
            r#"{"microphone":"notDetermined","accessibility":"granted","screenRecording":"denied"}"#
        );
        let p: Permission = serde_json::from_str(r#""screenRecording""#).unwrap();
        assert_eq!(p, Permission::ScreenRecording);
    }

    /// Real TCC calls on this Mac (read-only; never prompts).
    #[cfg(target_os = "macos")]
    #[test]
    fn live_queries_do_not_crash() {
        let mic = sys::microphone();
        assert_ne!(mic, Status::Unsupported, "AVCaptureDevice missing");
        let _ = sys::accessibility(false);
        let _ = sys::screen_recording(false);
    }
}
