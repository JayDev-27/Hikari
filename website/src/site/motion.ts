import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const EASE = 'expo.out';

/** Scroll to an in-page target smoothly (falls back to native). */
export function scrollToTarget(target: string | HTMLElement): void {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (el.id === 'about' && behavior === 'smooth') {
    // The reveal translates the section before arrival. Navigate to its layout position.
    const parent = el.offsetParent;
    if (parent) {
      window.scrollTo({ top: window.scrollY + parent.getBoundingClientRect().top + el.offsetTop, behavior });
      return;
    }
  }
  el.scrollIntoView({ behavior });
}

/**
 * Wrap each word of an element in a masked span, so lines can rise into place. Keeps the text readable by screen
 * readers (the original text stays as the accessible name) and is idempotent.
 */
export function splitWords(el: HTMLElement): HTMLElement[] {
  if (el.dataset.split === '1') return [...el.querySelectorAll<HTMLElement>('.w > span')];
  el.dataset.split = '1';
  const label = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const walk = (node: Node): Node[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? '').split(/(\s+)/);
      return parts.map((part) => {
        if (/^\s+$/.test(part) || part === '') return document.createTextNode(part);
        const w = document.createElement('span');
        w.className = 'w';
        const inner = document.createElement('span');
        inner.textContent = part;
        w.appendChild(inner);
        return w;
      });
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const clone = (node as HTMLElement).cloneNode(false) as HTMLElement;
      node.childNodes.forEach((c) => walk(c).forEach((n) => clone.appendChild(n)));
      return [clone];
    }
    return [];
  };
  const kids = [...el.childNodes].flatMap(walk);
  el.replaceChildren(...kids);
  el.setAttribute('aria-label', label);
  el.querySelectorAll('.w').forEach((w) => w.setAttribute('aria-hidden', 'true'));
  return [...el.querySelectorAll<HTMLElement>('.w > span')];
}

/**
 * Page-wide reveals:
 *  [data-split]   words rise out of a mask, staggered
 *  [data-reveal]  fade and lift (optional data-delay)
 *  [data-scrub-words] words light up one by one with the scroll
 */
export function useReveals(root: React.RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    const reduced = prefersReducedMotion();
    const ctx = gsap.context(() => {
      scope.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
        const words = splitWords(el);
        if (reduced) return;
        gsap.fromTo(
          words,
          { yPercent: 115, rotate: 3 },
          {
            yPercent: 0,
            rotate: 0,
            duration: 1.25,
            ease: EASE,
            stagger: 0.045,
            delay: Number(el.dataset.delay ?? 0),
            scrollTrigger: el.dataset.split === 'now' ? undefined : { trigger: el, start: 'top 88%', once: true },
          },
        );
      });
      scope.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
        if (reduced) return;
        gsap.fromTo(
          el,
          { autoAlpha: 0, y: 46 },
          { autoAlpha: 1, y: 0, duration: 1.3, ease: EASE, delay: Number(el.dataset.delay ?? 0), scrollTrigger: { trigger: el, start: 'top 90%', once: true } },
        );
      });
      scope.querySelectorAll<HTMLElement>('[data-scrub-words]').forEach((el) => {
        const words = splitWords(el);
        if (reduced) return;
        gsap.fromTo(
          words,
          { opacity: 0.16 },
          { opacity: 1, ease: 'none', stagger: 0.08, scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 42%', scrub: 0.6 } },
        );
      });
    }, scope);
    requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** A button that leans toward the pointer a little (desktop pointers only). */
export function magnetic(el: HTMLElement | null): () => void {
  if (!el || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return () => {};
  const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
  const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    xTo((e.clientX - (r.left + r.width / 2)) * 0.25);
    yTo((e.clientY - (r.top + r.height / 2)) * 0.35);
  };
  const leave = () => {
    xTo(0);
    yTo(0);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
  };
}

export { gsap, ScrollTrigger };
