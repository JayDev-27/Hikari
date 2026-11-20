import { useEffect, useRef, useState } from "react";
import { useStage } from "../state/stage";
import { StageRuntime } from "./runtime";
import { loadAvatar } from "../avatar/loader";
import { DEFAULT_CHARACTER } from "../avatar/characters";

export function Stage() {
  const host = useRef<HTMLDivElement>(null);
  const rt = useRef<StageRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const caption = useStage((s) => s.caption);

  useEffect(() => {
    const runtime = new StageRuntime();
    rt.current = runtime;
    runtime.start();
    let cancelled = false;
    loadAvatar(host.current!, DEFAULT_CHARACTER)
      .then((avatar) => {
        if (cancelled) return avatar.destroy();
        runtime.attach(avatar);
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
      runtime.destroy();
    };
  }, []);

  return (
    <div
      className="stage"
      ref={host}
      onMouseDown={(e) => {
        if (e.button === 0 && rt.current) void rt.current.startDrag();
      }}
      onDoubleClick={() => rt.current?.playMock()}
    >
      <div className="bubble">{caption}</div>
      {error && <div className="empty-slot">Couldn't load the model: {error}</div>}
      <DebugOverlay rt={rt} />
    </div>
  );
}

function DebugOverlay({ rt }: { rt: React.RefObject<StageRuntime | null> }) {
  const { debug, core, state, latency, fps } = useStage();
  if (!debug) return null;
  return (
    <div className="debug" onMouseDown={(e) => e.stopPropagation()}>
      <div>
        core <span className={core ? "ok" : "bad"}>{core ? "connected" : "offline"}</span> · {state} · {fps} fps
      </div>
      <div>
        stt {latency.stt_final ?? "–"} · llm {latency.llm_first_token ?? "–"} · tts {latency.tts_first_chunk ?? "–"} ·
        audio {latency.audio_first_play ?? "–"} ms
      </div>
      <button onClick={() => rt.current?.playMock()}>play mock turn</button>{" "}
      <button onClick={() => rt.current?.bargeIn()}>barge in</button>
    </div>
  );
}
