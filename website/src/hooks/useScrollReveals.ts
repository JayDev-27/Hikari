import { useEffect, type RefObject } from 'react';

export function useScrollReveals(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const elements = [...(root.current?.querySelectorAll<HTMLElement>('[data-reveal]') ?? [])];
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const nearby = new Set<HTMLElement>();
    let frame = 0;

    function render() {
      frame = 0;
      const height = window.innerHeight;
      // Collect layout reads before writing any inline style.
      const states = [...nearby].map((element) => {
        const top = element.getBoundingClientRect().top;
        const span = Math.min(245, height * .29);
        const raw = Math.max(0, Math.min(1, (height * .96 - top) / span));
        return { element, progress: 1 - (1 - raw) ** 2 };
      });
      for (const { element, progress } of states) {
        element.style.setProperty('--reveal-progress', progress.toFixed(3));
      }
    }

    function schedule() {
      if (!frame && !motion.matches) frame = requestAnimationFrame(render);
    }

    function onFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement) {
        event.target.closest<HTMLElement>('[data-reveal]')?.style.setProperty('--reveal-progress', '1');
      }
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement;
        if (entry.isIntersecting) nearby.add(node);
        else nearby.delete(node);
      }
      schedule();
    }, { rootMargin: '140px 0px' });
    elements.forEach((element) => observer.observe(element));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    root.current?.addEventListener('focusin', onFocus);
    const content = root.current;
    motion.addEventListener('change', schedule);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      content?.removeEventListener('focusin', onFocus);
      motion.removeEventListener('change', schedule);
    };
  }, [root]);
}
