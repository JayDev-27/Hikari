import type { ReactNode } from "react";
import { Card, IconWarn, Meter, Segmented } from "./controls";
import {
  PROFILES, formatBytes, memoryShares, profileDef, profileFitWarning, recommendProfile, resolveProfile,
  type HikariSettings, type MemoryStats, type ProfileSetting,
} from "./model";

export function Performance({ settings, onChange, memory }: {
  settings: HikariSettings;
  onChange: (s: HikariSettings) => void;
  memory: MemoryStats | null;
}) {
  const total = memory?.totalBytes;
  const effective = profileDef(resolveProfile(settings.profile, total));
  const warning = profileFitWarning(effective.id, total);
  const shares = memory ? memoryShares(memory) : null;
  const options: { id: ProfileSetting; label: ReactNode; title?: string }[] = [
    { id: "auto", label: "Auto", title: total ? `Picks ${profileDef(recommendProfile(total)).name} for this Mac` : undefined },
    ...PROFILES.map((p) => ({ id: p.id as ProfileSetting, label: <>{p.name}<span className="se-seg-sub">{p.ram}</span></> })),
  ];

  return (
    <div className="se-stack">
      <Card title="Hardware profile">
        <div className="se-profile">
          <Segmented label="Hardware profile" size="wide" value={settings.profile} options={options}
            onChange={(p) => onChange({ ...settings, profile: p })} />
          <p className="se-profile-summary">
            {settings.profile === "auto" && <strong>{effective.name}{total ? ` for this Mac's ${formatBytes(total)}` : ""}. </strong>}
            {effective.summary}
          </p>
        </div>
        <dl className="se-stats">
          <Stat label="Local chat model" value={effective.llm} />
          <Stat label="Speech" value={effective.speech} />
          <Stat label="Model memory" value={`about ${formatBytes(effective.budgetBytes)}`} title="When every model runs on this Mac" />
        </dl>
        {warning && <p className="se-warning"><IconWarn /> {warning}</p>}
      </Card>

      <Card title="Memory" footer="Refreshes every 2 seconds. Helper processes are the WebKit processes that draw her, and the core when Hikari starts it.">
        <div className="se-mem">
          <div className="se-mem-head">
            <span>System</span>
            <span className="se-value">{memory ? `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} used` : "—"}</span>
          </div>
          <Meter label="System memory used" used={shares?.used ?? 0} part={shares?.hikari} />
          <div className="se-legend">
            <span><i className="se-swatch used" />Other apps</span>
            <span><i className="se-swatch part" />Hikari</span>
          </div>
        </div>
        <dl className="se-stats">
          <Stat label="Hikari app" value={memory ? formatBytes(memory.appBytes) : "—"} num />
          <Stat label={memory ? `Helpers (${memory.helperCount})` : "Helpers"} value={memory ? formatBytes(memory.helperBytes) : "—"} num />
          <Stat label="Hikari in all" value={shares ? formatBytes(shares.hikariBytes) : "—"} num strong />
        </dl>
      </Card>
    </div>
  );
}

function Stat({ label, value, title, num, strong }: { label: string; value: string; title?: string; num?: boolean; strong?: boolean }) {
  return (
    <div className="se-stat" title={title}>
      <dt>{label}</dt>
      <dd className={`${num ? "se-num" : ""}${strong ? " strong" : ""}`}>{value}</dd>
    </div>
  );
}
