import { useEffect, useRef } from 'react';
import { sharedScrollState } from '../hooks/useSmoothScroll';

export function ScrollIndicator() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    let hideTimeout = 0;
    let lastProgress = -1;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const p = sharedScrollState.progress;
      if (Math.abs(p - lastProgress) > 0.0004) {
        lastProgress = p;
        const track = trackRef.current;
        const thumb = thumbRef.current;
        if (track && thumb) {
          const travel = Math.max(1, track.clientHeight - thumb.clientHeight);
          thumb.style.transform = `translate3d(0, ${(p * travel).toFixed(1)}px, 0)`;
          track.classList.add('is-active');
          window.clearTimeout(hideTimeout);
          hideTimeout = window.setTimeout(() => {
            track.classList.remove('is-active');
          }, 900);
        }
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(hideTimeout);
    };
  }, []);

  return (
    <div ref={trackRef} className="scroll-indicator" aria-hidden="true">
      <div ref={thumbRef} className="scroll-indicator-thumb" />
    </div>
  );
}
