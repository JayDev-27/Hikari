import { useEffect, useRef } from 'react';
import { HeroBloom } from './HeroBloom';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { gsap, magnetic, prefersReducedMotion, scrollToTarget } from './motion';

/**
 * The opening: a tall pinned stage over the night-sakura canvas. The headline rises in on load; as you scroll the
 * blossom opens behind it, the opening copy steps back, and a second line arrives while the petals unfold.
 */
export function Hero({ onGet }: { onGet: () => void }) {
  const root = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => magnetic(primary.current), []);
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.hero-intro > *:not(h1)', { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 1.4, ease: 'expo.out', stagger: 0.09, delay: 0.55 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.7 } });
      tl.to('.hero-intro', { autoAlpha: 0, y: -60, ease: 'power2.in', duration: 0.3 }, 0.08)
        .to('.hero-meta', { autoAlpha: 0, duration: 0.15 }, 0.05)
        .fromTo('.hero-beat', { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.2, ease: 'power2.out' }, 0.42)
        .to('.hero-beat', { autoAlpha: 0, y: -30, duration: 0.12, ease: 'power2.in' }, 0.72)
        .to({}, { duration: .16 }, .84);
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section id="top" ref={root} className="hero" aria-labelledby="hero-title">
      <div className="hero-stage">
        <HeroBloom />
        <div className="hero-intro wrap">
          <p className="eyebrow">
            Open source · macOS
          </p>
          <h1 id="hero-title" className="hero-title" data-split="now" data-delay="0.15">
            Meet <em>Hikari.</em>
          </h1>
          <p className="hero-lede">
            An anime companion who lives on your desktop, talks with you in English, हिंदी and Hinglish, and keeps
            everything she learns on your Mac.
          </p>
          <div className="hero-actions">
            <button ref={primary} type="button" className="btn btn-light" onClick={onGet}>
              Get Hikari <ArrowRight size={16} />
            </button>
            <a className="btn btn-ghost" href="#cast" onClick={(e) => (e.preventDefault(), scrollToTarget('#cast'))}>
              Meet the cast
            </a>
          </div>
        </div>
        <p className="hero-beat wrap" aria-hidden="true">
          She opens up <em>the more you talk.</em>
        </p>
        <div className="hero-meta wrap">
          <button type="button" className="scroll-cue" onClick={() => scrollToTarget('#about')}>
            <span className="scroll-cue-ring"><ArrowDown size={14} /></span>
            Scroll to bloom
          </button>
          <span className="hero-spec">macOS 13+ · Apple Silicon · in development</span>
        </div>
      </div>
    </section>
  );
}
