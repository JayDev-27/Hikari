//! Memory figures for Settings → Performance, read straight from the kernel (no `sysinfo` dependency).
//!
//! - `total`: `hw.memsize`.
//! - `used`: what Activity Monitor calls "Memory Used" = app memory (anonymous pages minus purgeable) + wired +
//!   compressed.
//! - `app`: this process's physical footprint (Activity Monitor's "Memory" column).
//! - `helpers`: the footprint of the processes macOS counts as Hikari's (its WebKit content/GPU/networking
//!   processes, which do most of the rendering work), found through the responsible-process lookup that Activity
//!   Monitor uses. That lookup is a libSystem function without a public header, so it's resolved at run time and
//!   the figure is simply 0 if it's missing.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    /// Hikari's own process.
    pub app_bytes: u64,
    /// WebKit and other helper processes macOS attributes to Hikari.
    pub helper_bytes: u64,
    pub helper_count: u32,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::MemoryStats;
    use std::ffi::CStr;
    use std::mem::{MaybeUninit, size_of};

    fn total_bytes() -> Option<u64> {
        let mut v: u64 = 0;
        let mut len = size_of::<u64>();
        let name: &CStr = c"hw.memsize";
        // SAFETY: `v` is a u64 buffer of `len` bytes, the size hw.memsize returns.
        let r = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                (&raw mut v).cast(),
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        (r == 0).then_some(v)
    }

    fn used_bytes() -> Option<u64> {
        let mut info = MaybeUninit::<libc::vm_statistics64>::zeroed();
        let mut count = libc::HOST_VM_INFO64_COUNT;
        // SAFETY: the buffer holds HOST_VM_INFO64_COUNT integers; the kernel writes at most `count` of them.
        // (libc deprecates its mach bindings in favour of the mach2 crate; one call isn't worth the dependency.)
        #[allow(deprecated)]
        let r = unsafe {
            libc::host_statistics64(
                libc::mach_host_self(),
                libc::HOST_VM_INFO64,
                info.as_mut_ptr().cast(),
                &mut count,
            )
        };
        if r != libc::KERN_SUCCESS {
            return None;
        }
        // SAFETY: zero-initialised and filled by the kernel above.
        let s = unsafe { info.assume_init() };
        // SAFETY: sysconf has no preconditions.
        let page = u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).ok()?;
        let app = u64::from(s.internal_page_count).saturating_sub(u64::from(s.purgeable_count));
        Some((app + u64::from(s.wire_count) + u64::from(s.compressor_page_count)) * page)
    }

    /// Physical footprint of a process (0 if it can't be read, e.g. it just exited).
    fn footprint(pid: libc::pid_t) -> u64 {
        let mut info = MaybeUninit::<libc::rusage_info_v2>::zeroed();
        // SAFETY: proc_pid_rusage writes one rusage_info_v2 for flavor RUSAGE_INFO_V2.
        let r = unsafe {
            libc::proc_pid_rusage(
                pid,
                libc::RUSAGE_INFO_V2,
                info.as_mut_ptr().cast::<libc::rusage_info_t>(),
            )
        };
        if r == 0 {
            // SAFETY: filled by the call above.
            unsafe { info.assume_init() }.ri_phys_footprint
        } else {
            0
        }
    }

    type ResponsibleFn = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

    fn responsible_fn() -> Option<ResponsibleFn> {
        static FN: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
        let addr = *FN.get_or_init(|| {
            let name: &CStr = c"responsibility_get_pid_responsible_for_pid";
            // SAFETY: dlsym with RTLD_DEFAULT and a NUL-terminated name.
            let p = unsafe { libc::dlsym(libc::RTLD_DEFAULT, name.as_ptr()) };
            (!p.is_null()).then_some(p as usize)
        });
        // SAFETY: the symbol has this signature (pid_t → pid_t) on every macOS that exports it.
        addr.map(|a| unsafe { std::mem::transmute::<usize, ResponsibleFn>(a) })
    }

    /// (bytes, count) of the other processes macOS holds Hikari responsible for.
    fn helpers(me: libc::pid_t) -> (u64, u32) {
        let Some(responsible) = responsible_fn() else {
            return (0, 0);
        };
        // SAFETY: a null buffer asks for the number of pids.
        let n = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if n <= 0 {
            return (0, 0);
        }
        let mut pids = vec![0 as libc::pid_t; n as usize + 64];
        let bytes = i32::try_from(pids.len() * size_of::<libc::pid_t>()).unwrap_or(i32::MAX);
        // SAFETY: `pids` has room for `bytes` bytes.
        let got = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
        let got = usize::try_from(got).unwrap_or(0).min(pids.len());
        pids[..got]
            .iter()
            .filter(|&&pid| pid > 0 && pid != me)
            // SAFETY: plain lookup on a pid; returns -1 or another pid.
            .filter(|&&pid| unsafe { responsible(pid) } == me)
            .fold((0, 0), |(b, c), &pid| (b + footprint(pid), c + 1))
    }

    pub fn stats() -> Result<MemoryStats, String> {
        let total_bytes = total_bytes().ok_or("hw.memsize unavailable")?;
        let used_bytes = used_bytes()
            .ok_or("host_statistics64 failed")?
            .min(total_bytes);
        // SAFETY: getpid has no preconditions.
        let me = unsafe { libc::getpid() };
        let (helper_bytes, helper_count) = helpers(me);
        Ok(MemoryStats {
            total_bytes,
            used_bytes,
            app_bytes: footprint(me),
            helper_bytes,
            helper_count,
        })
    }
}

pub fn stats() -> Result<MemoryStats, String> {
    #[cfg(target_os = "macos")]
    return mac::stats();
    #[cfg(not(target_os = "macos"))]
    Err("memory stats are only implemented on macOS".into())
}

/// System memory and Hikari's share of it. Async so the process scan stays off the main thread.
#[tauri::command]
pub async fn memory_stats() -> Result<MemoryStats, String> {
    stats()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn plausible_numbers() {
        let s = super::stats().unwrap();
        assert!(s.total_bytes >= 4 << 30, "{s:?}");
        assert!(s.used_bytes > 0 && s.used_bytes <= s.total_bytes, "{s:?}");
        // A test binary is a few MB, never more than the machine.
        assert!(s.app_bytes > 0 && s.app_bytes < s.total_bytes, "{s:?}");
    }
}
