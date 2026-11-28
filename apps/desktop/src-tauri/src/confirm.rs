use std::collections::VecDeque;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Runtime, WebviewWindow};

const MAX_PENDING_CONFIRMATIONS: usize = 64;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolConfirmation {
    pub call_id: String,
    pub approved: bool,
    pub via: Option<String>,
}

#[derive(Default)]
pub struct ConfirmRelayState {
    queue: Mutex<VecDeque<ToolConfirmation>>,
}

fn authorized_submitter(label: &str) -> bool {
    label == "confirm"
}

fn authorized_reader(label: &str) -> bool {
    label == "stage"
}

#[tauri::command]
pub fn submit_tool_confirmation<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, ConfirmRelayState>,
    confirmation: ToolConfirmation,
) -> Result<(), String> {
    let label = window.label();

    if !authorized_submitter(label) {
        log::warn!("Refused tool.confirm submission from window '{label}'");
        return Err("Only the Confirm window may submit tool confirmations".into());
    }

    if confirmation.call_id.trim().is_empty()
        || confirmation
            .via
            .as_deref()
            .is_some_and(|v| v != "click" && v != "voice")
    {
        log::warn!("Refused malformed tool.confirm from Confirm window");
        return Err("Invalid tool confirmation".into());
    }

    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;

    if queue.len() >= MAX_PENDING_CONFIRMATIONS {
        log::warn!("Refused tool.confirm: relay queue is full");
        return Err("Confirmation relay queue is full".into());
    }

    queue.push_back(confirmation);
    Ok(())
}

#[tauri::command]
pub fn take_tool_confirmations<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, ConfirmRelayState>,
) -> Result<Vec<ToolConfirmation>, String> {
    let label = window.label();

    if !authorized_reader(label) {
        log::warn!("Refused confirmation queue access from window '{label}'");
        return Err("Only the Stage window may retrieve confirmations".into());
    }

    let mut queue = state.queue.lock().map_err(|e| e.to_string())?;
    Ok(queue.drain(..).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_confirm_can_submit() {
        assert!(authorized_submitter("confirm"));
        assert!(!authorized_submitter("stage"));
        assert!(!authorized_submitter("chat"));
        assert!(!authorized_submitter("activity"));
    }

    #[test]
    fn only_stage_can_read() {
        assert!(authorized_reader("stage"));
        assert!(!authorized_reader("confirm"));
        assert!(!authorized_reader("chat"));
    }
}
