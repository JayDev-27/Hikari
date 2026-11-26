import { useEffect, useId, useRef, useState } from "react";
import { Badge, Card, IconKey, IconLock, Select, Sheet } from "./controls";
import {
  CAPABILITIES, PROVIDERS, formatLatency, keysNeeded, maskedKey, modelName, modelsFor, providerName, statusBadge, summarize,
  validateApiKey, withModel, withProvider, type CapabilityDef, type HikariSettings, type StatusTable,
} from "./model";
import { deleteKey, keyStatus, setKey, type KeyPresence } from "./native";
import type { Toast } from "./Settings";

type Keys = Record<string, KeyPresence>;

export function Providers({ settings, onChange, statuses, connected, toast }: {
  settings: HikariSettings;
  onChange: (s: HikariSettings) => void;
  statuses: StatusTable;
  connected: boolean;
  toast: (kind: Toast["kind"], text: string) => void;
}) {
  const [keys, setKeys] = useState<Keys>({});
  const [editing, setEditing] = useState<string | null>(null);
  const needed = keysNeeded(settings).join(",");

  useEffect(() => {
    if (!needed) return;
    let live = true;
    keyStatus(needed.split(","))
      .then((list) => live && setKeys((k) => ({ ...k, ...Object.fromEntries(list.map((p) => [p.provider, p])) })))
      .catch((e) => live && toast("error", `Couldn't check the Keychain: ${String(e)}`));
    return () => {
      live = false;
    };
  }, [needed, toast]);

  return (
    <div className="se-stack">
      <Card footer={<><IconLock /> API keys are kept in your Mac's Keychain. Hikari never writes them to a file.</>}>
        {CAPABILITIES.map((def) => (
          <CapabilityRow key={def.id} def={def} settings={settings} onChange={onChange} statuses={statuses}
            connected={connected} keyInfo={keys[settings.providers[def.id].provider]} onEditKey={setEditing} />
        ))}
      </Card>
      {editing && (
        <KeySheet provider={editing} presence={keys[editing]} onDismiss={() => setEditing(null)}
          onSaved={(p, verb) => {
            setKeys((k) => ({ ...k, [p.provider]: p }));
            setEditing(null);
            toast("ok", `${providerName(p.provider)} key ${verb}.`);
          }}
          onError={(e) => toast("error", e)} />
      )}
    </div>
  );
}

function CapabilityRow({ def, settings, onChange, statuses, connected, keyInfo, onEditKey }: {
  def: CapabilityDef;
  settings: HikariSettings;
  onChange: (s: HikariSettings) => void;
  statuses: StatusTable;
  connected: boolean;
  keyInfo?: KeyPresence;
  onEditKey: (provider: string) => void;
}) {
  const choice = settings.providers[def.id];
  const local = !!PROVIDERS[choice.provider]?.local;
  const { chosen, standIn } = summarize(statuses, def.id, choice.provider);
  const latency = chosen?.status === "active" || chosen?.status === "ok" ? formatLatency(chosen.latencyMs) : null;
  const providerOptions = def.providers.map((p) => ({ id: p.provider, name: providerName(p.provider) }));
  const models = modelsFor(def.id, choice.provider);
  const detail = [
    latency,
    chosen?.status === "benched" || chosen?.status === "error" ? chosen.reason : null,
    standIn ? `${PROVIDERS[standIn.provider]?.local ? "Local model" : providerName(standIn.provider)} is answering${standIn.model ? ` (${modelName(def.id, standIn.provider, standIn.model)})` : ""}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="se-prov">
      <div className="se-prov-title">
        <span className="se-prov-name">{def.title}</span>
        <span className="se-hint">{def.subtitle}</span>
      </div>
      <div className="se-prov-pickers">
        <Select label={`${def.title} provider`} value={choice.provider} options={providerOptions} disabled={providerOptions.length < 2}
          onChange={(p) => onChange(withProvider(settings, def.id, p))} />
        <Select label={`${def.title} model`} value={choice.model} options={models} disabled={models.length < 2}
          onChange={(m) => onChange(withModel(settings, def.id, m))} />
      </div>
      <div className="se-prov-foot">
        <div className="se-prov-status">
          <Badge badge={statusBadge(chosen?.status, connected)} />
          {detail && <span className="se-hint se-ellipsis" title={detail}>{detail}</span>}
        </div>
        <div className="se-prov-key">
          {local ? (
            <span className="se-hint">No key needed</span>
          ) : keyInfo?.saved ? (
            <button type="button" className="se-btn se-btn-small" onClick={() => onEditKey(choice.provider)} title="Change or remove this key">
              <IconKey /> <span className="se-mono">{maskedKey(keyInfo.last4)}</span>
            </button>
          ) : (
            <button type="button" className="se-btn se-btn-small se-btn-attn" onClick={() => onEditKey(choice.provider)}>
              <IconKey /> {keyInfo ? "Add Key…" : "Key…"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KeySheet({ provider, presence, onDismiss, onSaved, onError }: {
  provider: string;
  presence?: KeyPresence;
  onDismiss: () => void;
  onSaved: (p: KeyPresence, verb: "saved" | "removed") => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const check = validateApiKey(provider, value);
  const name = providerName(provider);
  useEffect(() => input.current?.focus(), []);

  const save = async () => {
    if (!check.ok || busy) return;
    setBusy(true);
    try {
      onSaved(await setKey(provider, check.value), "saved");
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteKey(provider);
      onSaved({ provider, saved: false }, "removed");
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet onDismiss={onDismiss} labelledBy={titleId}>
      <div className="se-sheet-icon"><IconKey /></div>
      <h2 id={titleId}>{name} API key</h2>
      <p className="se-sheet-sub">
        {presence?.saved ? <>Saved key <span className="se-mono">{maskedKey(presence.last4)}</span>. Paste a new one to replace it.</> : "Paste the key from your provider's console."}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input ref={input} className={`se-input se-mono${value && !check.ok ? " bad" : ""}`} type="password" value={value}
          onChange={(e) => setValue(e.target.value)} placeholder={PROVIDERS[provider]?.keyPrefixes?.[0] ? `${PROVIDERS[provider].keyPrefixes![0]}…` : "API key"}
          autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label={`${name} API key`}
          aria-invalid={!!value && !check.ok} aria-describedby={`${titleId}-msg`} />
        <p id={`${titleId}-msg`} className={`se-field-msg${check.error ? " error" : check.warning ? " warn" : ""}`}>
          {value ? (check.error ?? check.warning ?? "Looks right.") : "Stored in the Keychain on this Mac."}
        </p>
        <div className="se-sheet-actions">
          {presence?.saved && <button type="button" className="se-btn se-btn-danger-plain" disabled={busy} onClick={() => void remove()}>Remove Key</button>}
          <span className="se-spacer" />
          <button type="button" className="se-btn" onClick={onDismiss}>Cancel</button>
          <button type="submit" className="se-btn se-btn-primary" disabled={!check.ok || busy}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
