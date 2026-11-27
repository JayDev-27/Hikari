import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * The fixed night-sakura canvas behind the page. The hero's scroll position drives the bloom (0 → 1 while the hero is
 * pinned, then on to 1.6 as the blossom drifts away); light sections cover it with their own background. The scene
 * module loads after first paint so the headline is readable before three.js arrives, and it stops drawing when the
 * tab is hidden or the canvas is scrolled far out of use.
 */
export function SakuraCanvas({ heroId = 'top' }: { heroId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    const reduced = prefersReducedMotion();
    const mobile = window.matchMedia('(max-width: 760px)').matches || navigator.maxTouchPoints > 1;

    void import('../webgl/NightSakura').then(({ NightSakura }) => {
      if (disposed) return;
      let scene: InstanceType<typeof NightSakura>;
      try {
        scene = new NightSakura(el, { reducedMotion: reduced, mobile });
      } catch {
        el.dataset.failed = '1'; // no WebGL: the CSS sky behind it stays
        return;
      }
      const hero = document.getElementById(heroId);
      let heroInView = Boolean(hero);
      const onVis = () => scene.setVisible(!reduced && !document.hidden && !heroInView);
      const observer = new IntersectionObserver(([entry]) => {
        heroInView = entry.isIntersecting;
        onVis();
      });
      if (hero) observer.observe(hero);
      scene.setProgress(1.7);
      scene.setPetalDensity(.4);
      const onResize = () => {
        scene.resize();
        if (reduced) scene.render();
      };
      const onPointer = (e: PointerEvent) => scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      onVis();
      window.addEventListener('resize', onResize);
      window.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('visibilitychange', onVis);
      if (reduced) scene.render();
      requestAnimationFrame(() => el.classList.add('is-ready'));
      cleanup = () => {
        observer.disconnect();
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointermove', onPointer);
        document.removeEventListener('visibilitychange', onVis);
        scene.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [heroId]);

  return (
    <div className="sky" aria-hidden="true">
      <canvas ref={canvas} className="sky-canvas" />
      <div className="sky-grain" />
    </div>
  );
}
