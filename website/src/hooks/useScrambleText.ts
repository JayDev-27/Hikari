import { useEffect, useRef, useState } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/+=*#';

export function useScrambleText(target: string) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState(target);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(target);
      return;
    }

    let frameId = 0;
    let started = false;

    const run = () => {
      if (started) return;
      started = true;
      const durationMs = 680;
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const revealCount = Math.floor(progress * target.length);
        let output = '';
        for (let i = 0; i < target.length; i++) {
          const ch = target[i];
          if (ch === ' ' || ch === '•' || ch === '·') {
            output += ch;
          } else if (i < revealCount) {
            output += ch;
          } else {
            output += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
        }
        setText(output);
        if (progress < 1) {
          frameId = requestAnimationFrame(tick);
        } else {
          setText(target);
        }
      };

      frameId = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, [target]);

  return { ref, text };
}
