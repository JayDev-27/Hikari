import { useEffect, useState } from 'react';

interface PreloaderProps {
  loadProgress: number;
  webglReady: boolean;
  onFinished: () => void;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function Preloader({ loadProgress, webglReady, onFinished }: PreloaderProps) {
  const [displayPct, setDisplayPct] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayPct(100);
      setDone(true);
      onFinished();
      return;
    }

    const start = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const elapsed = now - start;
      const minTimeline = Math.min(100, Math.floor((elapsed / 950) * 100));
      const target = webglReady ? minTimeline : Math.min(88, Math.floor(loadProgress * 88));
      setDisplayPct((prev) => Math.max(prev, target));

      if (webglReady && minTimeline >= 100) {
        setDisplayPct(100);
        window.setTimeout(() => {
          setDone(true);
          onFinished();
        }, 240);
        return;
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [loadProgress, webglReady, onFinished]);

  const padded = String(displayPct).padStart(3, '0');

  return (
    <div className={`preloader ${done ? 'is-done' : ''}`} aria-hidden={done}>
      <div className="preloader-top">
        <span>光 HIKARI // MACOS STAGE</span>
        <span>INITIALIZING WEBGL EXPERIENCE</span>
      </div>

      <div className="preloader-digits" aria-label={`Loading ${displayPct} percent`}>
        {padded.split('').map((char, colIdx) => {
          const val = Number(char);
          return (
            <div key={colIdx} className="preloader-digit-col">
              <div
                className="preloader-digit-strip"
                style={{ transform: `translate3d(0, -${val * 10}%, 0)` }}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
            </div>
          );
        })}
        <span className="preloader-pct">%</span>
      </div>
    </div>
  );
}
