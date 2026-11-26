//! Pause the stage while nobody can see it: screen locked, or the display asleep.
//!
//! The stage renders at 30 fps when idle (17–28 % of a core on an M2, docs/RELEASE-CHECK.md), and it kept doing that
//! behind a lock screen or a sleeping display. Tauri reports no occlusion, so this checks the session every 2 s
//! (CGSessionCopyCurrentDictionary's "CGSSessionScreenIsLocked", CGDisplayIsAsleep) and sends the stage the same
//! `stage://visible` the tray's Hide uses. Coming back resumes it only if the stage window is still shown, so a
//! hidden Hikari stays hidden.

use std::{thread, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const STAGE: &str = "stage";

/// What the session looks like right now (pure, so the decision is testable).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Session {
    pub locked: bool,
    pub display_asleep: bool,
}

impl Session {
    pub fn away(self) -> bool {
        self.locked || self.display_asleep
    }
}

/// The stage should render only while someone could see it and the window itself is shown.
pub fn should_render(session: Session, window_shown: bool) -> bool {
    window_shown && !session.away()
}

#[cfg(target_os = "macos")]
mod mac {
    use super::Session;
    use std::ffi::{c_char, c_void};

    type CFTypeRef = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFTypeRef,
            s: *const c_char,
            encoding: u32,
        ) -> CFTypeRef;
        fn CFDictionaryGetValue(dict: CFTypeRef, key: CFTypeRef) -> CFTypeRef;
        fn CFBooleanGetValue(b: CFTypeRef) -> u8;
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFRelease(cf: CFTypeRef);
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGSessionCopyCurrentDictionary() -> CFTypeRef;
        fn CGMainDisplayID() -> u32;
        fn CGDisplayIsAsleep(display: u32) -> u32;
    }
    const UTF8: u32 = 0x0800_0100;

    pub fn session() -> Session {
        // SAFETY: plain CoreFoundation / CoreGraphics calls; every object created or copied here is released, and the
        // dictionary value is only read (Get rule) while the dictionary is alive.
        unsafe {
            let mut locked = false;
            let dict = CGSessionCopyCurrentDictionary();
            if !dict.is_null() {
                let key = CFStringCreateWithCString(
                    std::ptr::null(),
                    c"CGSSessionScreenIsLocked".as_ptr(),
                    UTF8,
                );
                if !key.is_null() {
                    let v = CFDictionaryGetValue(dict, key);
                    locked = !v.is_null()
                        && CFGetTypeID(v) == CFBooleanGetTypeID()
                        && CFBooleanGetValue(v) != 0;
                    CFRelease(key);
                }
                CFRelease(dict);
            }
            Session {
                locked,
                display_asleep: CGDisplayIsAsleep(CGMainDisplayID()) != 0,
            }
        }
    }
}

/// Start watching (macOS only; elsewhere the stage just keeps its own visibility).
pub fn watch<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        thread::spawn(move || {
            let mut was_away = false;
            loop {
                thread::sleep(Duration::from_secs(2));
                let s = mac::session();
                if s.away() == was_away {
                    continue;
                }
                was_away = s.away();
                let shown = app
                    .get_webview_window(STAGE)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                log::info!(
                    "presence: locked={} display_asleep={} → stage renders: {}",
                    s.locked,
                    s.display_asleep,
                    should_render(s, shown)
                );
                let _ = app.emit_to(STAGE, "stage://visible", should_render(s, shown));
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_only_when_seen_and_shown() {
        let here = Session {
            locked: false,
            display_asleep: false,
        };
        assert!(should_render(here, true));
        assert!(!should_render(here, false), "a hidden Hikari stays hidden");
        assert!(!should_render(
            Session {
                locked: true,
                display_asleep: false
            },
            true
        ));
        assert!(!should_render(
            Session {
                locked: false,
                display_asleep: true
            },
            true
        ));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn live_session_query_works() {
        // Must not crash or leak; the values depend on the machine running the tests.
        let _ = mac::session();
    }
}
