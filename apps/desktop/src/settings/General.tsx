import { useEffect, useState } from "react";
import { Card, Row, Segmented, Select, Switch } from "./controls";
import type { HikariSettings, LanguageSetting } from "./model";
import { getAutostart, setAutostart } from "./native";

/** The stage's own mic prefs (src/stage/runtime.ts reads them when it starts); every window shares this storage. */
const MIC_MODE = "hikari.micMode";
const MIC_DEVICE = "hikari.micDevice";
type MicMode = "ptt" | "open";

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: nothing to keep */
  }
}

const LANGUAGES: { id: LanguageSetting; name: string }[] = [
  { id: "auto", name: "Character's own" },
  { id: "hinglish", name: "Hinglish" },
  { id: "en", name: "English" },
  { id: "hi", name: "Hindi" },
];

function useInputDevices(): { id: string; name: string }[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    let live = true;
    const read = () => void md.enumerateDevices().then((all) => live && setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default")));
    read();
    md.addEventListener?.("devicechange", read);
    return () => {
      live = false;
      md.removeEventListener?.("devicechange", read);
    };
  }, []);
  // Without mic permission in this window, WebKit hides device names: number them instead.
  return [{ id: "", name: "System default" }, ...devices.map((d, i) => ({ id: d.deviceId, name: d.label || `Microphone ${i + 1}` }))];
}

export function General({ settings, onChange }: { settings: HikariSettings; onChange: (s: HikariSettings) => void }) {
  const [login, setLogin] = useState<boolean | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [mode, setMode] = useState<MicMode>(() => (readPref(MIC_MODE, "ptt") === "open" ? "open" : "ptt"));
  const [device, setDevice] = useState(() => readPref(MIC_DEVICE, ""));
  const devices = useInputDevices();
  const deviceOptions = devices.some((d) => d.id === device) ? devices : [...devices, { id: device, name: "Saved microphone (not connected)" }];

  useEffect(() => {
    let live = true;
    getAutostart().then((v) => live && setLogin(v)).catch(() => live && setLogin(null));
    return () => {
      live = false;
    };
  }, []);

  const toggleLogin = async (on: boolean) => {
    setLoginBusy(true);
    try {
      await setAutostart(on);
      setLogin(await getAutostart());
    } catch {
      setLogin(await getAutostart().catch(() => null));
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <div className="se-stack">
      <Card title="Startup">
        <Row label="Open Hikari at login" hint={login === null ? "Available in the Hikari app." : "She appears on your desktop when you log in."}>
          <Switch label="Open Hikari at login" checked={!!login} disabled={login === null || loginBusy} onChange={(v) => void toggleLogin(v)} />
        </Row>
      </Card>

      <Card title="Microphone" footer="Changes apply right away.">
        <Row label="Talk mode" hint={mode === "ptt" ? "Hold ⌥Space while you talk." : "She listens whenever the mic isn't muted (⌘⇧M)."}>
          <Segmented label="Talk mode" value={mode} onChange={(m) => { setMode(m); writePref(MIC_MODE, m); }}
            options={[{ id: "ptt", label: "Push to Talk" }, { id: "open", label: "Always Listening" }]} />
        </Row>
        <Row label="Input device" htmlFor="se-mic">
          <Select id="se-mic" label="Input device" value={device} options={deviceOptions} onChange={(d) => { setDevice(d); writePref(MIC_DEVICE, d); }} />
        </Row>
      </Card>

      <Card title="Language">
        <Row label="Default language" hint="“Character's own” follows each character's pack." htmlFor="se-lang">
          <Select id="se-lang" label="Default language" value={settings.language} options={LANGUAGES}
            onChange={(l) => onChange({ ...settings, language: l as LanguageSetting })} />
        </Row>
      </Card>
    </div>
  );
}
