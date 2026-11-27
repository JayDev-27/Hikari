import { useEffect, useRef } from 'react';

export function HeroBloom() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    const track = el?.closest('section');
    if (!el || !track) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let cancelled = false;
    let stop = () => {};
    void import('../webgl/SakuraExperience').then(({ createSakuraExperience }) => {
      if (cancelled) return;
      const scene = createSakuraExperience(el);
      let frame = 0;
      let visible = false;
      function draw(now: number) {
        frame = 0;
        if (!visible || document.hidden) return;
        const bounds = track!.getBoundingClientRect();
        const progress = Math.min(1, Math.max(0, -bounds.top / Math.max(1, bounds.height - el!.clientHeight)));
        scene.draw(motion.matches ? 0 : progress, motion.matches ? 0 : now / 1000, 0, 0, false);
        if (!motion.matches) frame = requestAnimationFrame(draw);
      }
      function schedule() {
        if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw);
      }
      function move(event: PointerEvent) {
        if (!visible || motion.matches || event.pointerType === 'touch') return;
        const bounds = el!.getBoundingClientRect();
        scene.movePointer((event.clientX - bounds.left) / bounds.width, 1 - (event.clientY - bounds.top) / bounds.height, performance.now() / 1000);
      }
      scene.resize();
      const resize = new ResizeObserver(() => { scene.resize(); schedule(); });
      resize.observe(el);
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        schedule();
      });
      observer.observe(el);
      el.classList.add('live');
      motion.addEventListener('change', schedule);
      window.addEventListener('pointermove', move, { passive: true });
      document.addEventListener('visibilitychange', schedule);
      stop = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        observer.disconnect();
        motion.removeEventListener('change', schedule);
        window.removeEventListener('pointermove', move);
        document.removeEventListener('visibilitychange', schedule);
        scene.dispose();
        el.classList.remove('live');
      };
    }).catch(() => { /* The CSS background keeps the hero readable on devices without WebGL. */ });
    return () => { cancelled = true; stop(); };
  }, []);
  return <div ref={host} className="hero-bloom" aria-hidden="true" />;
}
