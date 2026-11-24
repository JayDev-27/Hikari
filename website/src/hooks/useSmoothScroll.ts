import { useEffect } from 'react';
import Lenis from 'lenis';

export interface ScrollState {
  scrollY: number;
  progress: number;
  velocity: number;
  maxScroll: number;
  tunnelProgress: number;
}

export const sharedScrollState: ScrollState = {
  scrollY: 0,
  progress: 0,
  velocity: 0,
  maxScroll: 1,
  tunnelProgress: 0,
};

let lenisSingleton: Lenis | null = null;

export function scrollToSection(target: string | number) {
  if (typeof window === 'undefined') return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (lenisSingleton && !reduced) {
    lenisSingleton.scrollTo(target, { duration: 1.35 });
    return;
  }
  if (typeof target === 'number') {
    window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
  } else {
    document.querySelector(target)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }
}

export function useSmoothScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const updateMetrics = (y: number, velocity = 0) => {
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight
      );
      sharedScrollState.scrollY = y;
      sharedScrollState.maxScroll = maxScroll;
      sharedScrollState.progress = Math.min(1, Math.max(0, y / maxScroll));
      sharedScrollState.velocity = velocity;

      const tunnelEl = document.getElementById('architecture-tunnel');
      if (tunnelEl) {
        const rect = tunnelEl.getBoundingClientRect();
        const span = Math.max(1, tunnelEl.offsetHeight - window.innerHeight);
        const passed = Math.min(span, Math.max(0, -rect.top));
        sharedScrollState.tunnelProgress = passed / span;
      }
    };

    if (reducedMotion) {
      const onScroll = () => updateMetrics(window.scrollY, 0);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      };
    }

    const lenis = new Lenis({
      duration: 1.25,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.4,
    });
    lenisSingleton = lenis;

    lenis.on('scroll', ({ scroll, velocity }: { scroll: number; velocity: number }) => {
      updateMetrics(scroll, velocity);
    });

    updateMetrics(window.scrollY, 0);

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    const onResize = () => updateMetrics(window.scrollY, 0);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      lenis.destroy();
      if (lenisSingleton === lenis) {
        lenisSingleton = null;
      }
    };
  }, [enabled]);
}
