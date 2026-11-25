import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { loadAvatar } from "../avatar/loader";
import type { CharacterPack } from "../avatar/characters";
import type { AvatarController } from "../avatar/types";

export interface PreviewHandle {
  /** Play a gesture or signature by name (interrupting the current one). */
  play(name: string): void;
}

/** Preview the same rig, gesture player and secondary motion used on the desktop stage. */
export function CharacterPreview({ pack, ref, onState }: {
  pack: CharacterPack;
  ref?: Ref<PreviewHandle>;
  onState?: (state: "loading" | "ready" | "error") => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AvatarController | null>(null);
  const signatureIndex = useRef(0);

  useImperativeHandle(ref, () => ({
    play: (name: string) => current.current?.playMotion(name, { interrupt: true }),
  }), []);

  const react = () => {
    const signatures = pack.signatureMotions;
    if (signatures?.length) {
      current.current?.playMotion(signatures[signatureIndex.current++ % signatures.length], { interrupt: true });
    } else if (pack.motionMap?.wave) current.current?.playMotion("wave");
    else current.current?.react({ kind: "click", area: "body" });
  };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 1000 / 30 - 2) return;
      current.current?.update(Math.min(0.1, (now - last) / 1000));
      last = now;
    };
    let loading = false;
    const show = () => {
      cancelAnimationFrame(frame);
      if (document.hidden) return;
      last = performance.now();
      if (current.current) {
        frame = requestAnimationFrame(tick);
      } else if (!loading) {
        loading = true;
        onState?.("loading");
        void loadAvatar(el, pack).then((avatar) => {
          if (!live) return avatar.destroy();
          current.current = avatar;
          onState?.("ready");
          show();
        }).catch((reason: unknown) => {
          if (!live) return;
          setError(String(reason));
          onState?.("error");
        });
      }
    };
    document.addEventListener("visibilitychange", show);
    show();
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", show);
      cancelAnimationFrame(frame);
      current.current?.destroy();
      current.current = null;
    };
    // onState is a notification only; re-creating the avatar for a new callback identity would flash it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack]);

  if (error) return <p className="st-preview-error" role="status">Preview unavailable. {error}</p>;
  return (
    <div className="character-preview" ref={host}
      role="button" tabIndex={0} aria-label={`Play a move for ${pack.displayName}`}
      title={pack.signatureMotions?.length ? "Click to play a signature move" : "Click to play a gesture"}
      onClick={react}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          react();
        }
      }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        current.current?.lookAt((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2);
      }}
      onMouseLeave={() => current.current?.lookAt(0, 0)}
    />
  );
}
