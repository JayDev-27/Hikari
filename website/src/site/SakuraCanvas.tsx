import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * One fixed canvas behind the whole page. Through the pinned hero it is the morning sky with the blossom; after the
 * hero the sky has faded to paper and only a few petals keep drifting behind the content. The scene module loads
 * after first paint so the type is readable before three.js arrives; drawing stops while the tab is hidden.
 */
export function SakuraCanvas({ heroId = 'top' }: { heroId?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    const reduced = prefersReducedMotion();
    const compact = window.matchMedia('(max-width: 760px)').matches;

    void import('../webgl/DawnSakura').then(({ DawnSakura }) => {
      if (disposed) return;
      let scene: InstanceType<typeof DawnSakura>;
      try {
        scene = new DawnSakura(el, { reducedMotion: reduced, compact });
      } catch {
        el.dataset.failed = '1'; // no WebGL: the CSS sky stays
        return;
      }
      const hero = document.getElementById(heroId);
      const measure = () => {
        const travel = hero ? Math.max(1, hero.offsetHeight - window.innerHeight) : 1;
        const y = window.scrollY;
        scene.setProgress(y / travel);
        const rest = Math.max(1, document.documentElement.scrollHeight - window.innerHeight - travel);
        scene.setAfter(Math.max(0, y - travel) / rest);
        if (reduced) scene.render();
      };
      const onResize = () => {
        scene.resize();
        measure();
      };
      const onPointer = (e: PointerEvent) => {
        scene.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
        if (e.pointerType !== 'touch') scene.movePointer(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight);
      };
      const onVis = () => scene.setVisible(!document.hidden);
      window.addEventListener('scroll', measure, { passive: true });
      window.addEventListener('resize', onResize);
      window.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('visibilitychange', onVis);
      measure();
      if (reduced) scene.render();
      else scene.start();
      requestAnimationFrame(() => el.classList.add('is-ready'));
      cleanup = () => {
        window.removeEventListener('scroll', measure);
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
    </div>
  );
}
