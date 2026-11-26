import { useEffect, useState } from "react";
import { PROTOCOL_VERSION } from "@hikari/protocol";
import { Card, IconArrow, Row } from "./controls";
import { appInfo, openExternal, openWelcome } from "./native";
import icon from "../../src-tauri/icons/128x128@2x.png";

const REPO = "https://github.com/JayDev-27/Hikari";
const LICENCES = `${REPO}/blob/main/docs/LICENSES.md`;

export function About() {
  const [info, setInfo] = useState<{ version: string; tauri: string } | null>(null);
  useEffect(() => {
    let live = true;
    appInfo().then((i) => live && setInfo(i)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="se-stack">
      <div className="se-about">
        <img src={icon} alt="" width={72} height={72} draggable={false} />
        <div>
          <p className="se-about-name">Hikari</p>
          <p className="se-hint">Your local-first anime companion for macOS.</p>
        </div>
      </div>
      <Card>
        <Row label="Version"><span className="se-value se-num">{info?.version ?? "—"}</span></Row>
        <Row label="Protocol" hint="Version of the messages between the app and its core"><span className="se-value se-num">{PROTOCOL_VERSION}</span></Row>
        <Row label="Tauri"><span className="se-value se-num">{info?.tauri ?? "—"}</span></Row>
        <Row label="Welcome" hint="Pick a character and check permissions again">
          <button type="button" className="se-btn se-btn-small" onClick={() => void openWelcome()}>Show Welcome Again</button>
        </Row>
      </Card>
      <Card footer="Live2D Cubism Core © Live2D Inc. Character art and models keep their own terms, shown in Character Studio.">
        <Row label="Third-party licences" hint="Models, voices and libraries Hikari uses">
          <button type="button" className="se-btn se-btn-small" onClick={() => void openExternal(LICENCES)}>Open <IconArrow /></button>
        </Row>
        <Row label="Source code">
          <button type="button" className="se-btn se-btn-small" onClick={() => void openExternal(REPO)}>GitHub <IconArrow /></button>
        </Row>
      </Card>
    </div>
  );
}
