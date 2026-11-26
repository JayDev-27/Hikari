//! Provider API keys in the macOS Keychain (via the `keyring` crate), never on disk or in the webview's storage.
//!
//! One generic-password item per provider: service [`SERVICE`], account = provider id (`groq`, `openai`, …).
//! The UI never reads a key back: `secret_status` and `secret_set` return only whether a key is saved and its last
//! four characters ("Saved ••••1234"). The core gets keys from the app side when the sidecar is spawned (see
//! DECISIONS.md, M4), not from the webview.
//!
//! Keychain calls can block (a locked keychain or an access prompt), so they run on a blocking thread, not on the
//! main thread that sync Tauri commands use.

use serde::Serialize;

pub const SERVICE: &str = "com.hikari.companion";
/// Longest key we accept. Real provider keys are well under this.
const MAX_LEN: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretPresence {
    pub provider: String,
    pub saved: bool,
    /// Last four characters of the saved key (only when `saved` and the key is long enough to keep the rest hidden).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last4: Option<String>,
}

/// Provider ids are short lowercase slugs; anything else is refused before it reaches the Keychain.
fn valid_provider(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Trim, then refuse empty, oversized or control-character keys (a pasted newline is trimmed, an inner one is refused).
fn clean_key(key: &str) -> Result<&str, String> {
    let k = key.trim();
    if k.is_empty() {
        return Err("The key is empty.".into());
    }
    if k.len() > MAX_LEN {
        return Err("The key is too long.".into());
    }
    if k.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("The key contains spaces or line breaks.".into());
    }
    Ok(k)
}

/// Last four characters, only if at least eight more stay hidden.
fn last4(key: &str) -> Option<String> {
    let n = key.chars().count();
    (n >= 12).then(|| key.chars().skip(n - 4).collect())
}

fn presence(provider: &str, key: Option<&str>) -> SecretPresence {
    SecretPresence {
        provider: provider.to_string(),
        saved: key.is_some(),
        last4: key.and_then(last4),
    }
}

/// The Keychain operations, parameterised by service so tests use their own.
mod store {
    use keyring::{Entry, Error};

    fn entry(service: &str, provider: &str) -> Result<Entry, String> {
        Entry::new(service, provider).map_err(|e| format!("Keychain unavailable: {e}"))
    }

    pub fn set(service: &str, provider: &str, key: &str) -> Result<(), String> {
        entry(service, provider)?
            .set_password(key)
            .map_err(|e| format!("Couldn't save to the Keychain: {e}"))
    }

    pub fn get(service: &str, provider: &str) -> Result<Option<String>, String> {
        match entry(service, provider)?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Couldn't read the Keychain: {e}")),
        }
    }

    pub fn delete(service: &str, provider: &str) -> Result<(), String> {
        match entry(service, provider)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Couldn't remove from the Keychain: {e}")),
        }
    }
}

fn set_in(service: &str, provider: &str, key: &str) -> Result<SecretPresence, String> {
    if !valid_provider(provider) {
        return Err(format!("unknown provider {provider:?}"));
    }
    let key = clean_key(key)?;
    store::set(service, provider, key)?;
    Ok(presence(provider, Some(key)))
}

fn status_in(service: &str, providers: &[String]) -> Result<Vec<SecretPresence>, String> {
    providers
        .iter()
        .filter(|p| valid_provider(p))
        .map(|p| Ok(presence(p, store::get(service, p)?.as_deref())))
        .collect()
}

fn delete_in(service: &str, provider: &str) -> Result<(), String> {
    if !valid_provider(provider) {
        return Err(format!("unknown provider {provider:?}"));
    }
    store::delete(service, provider)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Save (or replace) a provider's API key. Returns its presence, never the key.
#[tauri::command]
pub async fn secret_set(provider: String, key: String) -> Result<SecretPresence, String> {
    blocking(move || set_in(SERVICE, &provider, &key)).await
}

/// Which of these providers have a saved key (and its last four characters). Invalid ids are skipped.
#[tauri::command]
pub async fn secret_status(providers: Vec<String>) -> Result<Vec<SecretPresence>, String> {
    blocking(move || status_in(SERVICE, &providers)).await
}

/// Remove a provider's key. Removing a key that isn't there is not an error.
#[tauri::command]
pub async fn secret_delete(provider: String) -> Result<(), String> {
    blocking(move || delete_in(SERVICE, &provider)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids() {
        assert!(valid_provider("groq"));
        assert!(valid_provider("open-router_2"));
        assert!(!valid_provider(""));
        assert!(!valid_provider("Groq"));
        assert!(!valid_provider("a/b"));
        assert!(!valid_provider(&"x".repeat(33)));
    }

    #[test]
    fn key_cleaning() {
        assert_eq!(clean_key("  gsk_abc123\n"), Ok("gsk_abc123"));
        assert!(clean_key("   ").is_err());
        assert!(clean_key("abc def").is_err());
        assert!(clean_key("abc\ndef").is_err());
        assert!(clean_key(&"k".repeat(MAX_LEN + 1)).is_err());
    }

    #[test]
    fn only_last_four_leave() {
        assert_eq!(last4("sk-0123456789abcd").as_deref(), Some("abcd"));
        assert_eq!(last4("short"), None);
        let p = presence("groq", Some("gsk_0123456789WXYZ"));
        assert!(p.saved);
        assert_eq!(p.last4.as_deref(), Some("WXYZ"));
        let json = serde_json::to_string(&p).unwrap();
        assert!(
            !json.contains("gsk_"),
            "the key itself must never be serialised: {json}"
        );
        assert_eq!(presence("groq", None).last4, None);
    }

    /// Round trip through the real login Keychain under a test-only service, cleaned up afterwards.
    /// Ignored by default (CI keychains are often locked): `cargo test -- --ignored keychain`.
    #[test]
    #[ignore = "touches the login Keychain"]
    fn keychain_round_trip() {
        const TEST_SERVICE: &str = "com.hikari.companion.test";
        let provider = "hikari-test";
        let _ = delete_in(TEST_SERVICE, provider);

        let before = status_in(TEST_SERVICE, &[provider.to_string()]).unwrap();
        assert_eq!(before, vec![presence(provider, None)]);

        let saved = set_in(TEST_SERVICE, provider, " test-key-0000-1234\n").unwrap();
        assert_eq!(saved.last4.as_deref(), Some("1234"));
        assert_eq!(
            store::get(TEST_SERVICE, provider).unwrap().as_deref(),
            Some("test-key-0000-1234")
        );

        let replaced = set_in(TEST_SERVICE, provider, "test-key-0000-5678").unwrap();
        assert_eq!(replaced.last4.as_deref(), Some("5678"));
        let now = status_in(TEST_SERVICE, &[provider.to_string(), "Bad/Id".into()]).unwrap();
        assert_eq!(now.len(), 1);
        assert_eq!(now[0].last4.as_deref(), Some("5678"));

        delete_in(TEST_SERVICE, provider).unwrap();
        delete_in(TEST_SERVICE, provider).unwrap(); // idempotent
        assert_eq!(store::get(TEST_SERVICE, provider).unwrap(), None);
    }
}
