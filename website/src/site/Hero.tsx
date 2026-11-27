import { useEffect, useRef } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { gsap, magnetic, prefersReducedMotion, scrollToTarget, splitWords } from './motion';

/** The three things she is, told while the blossom opens behind them. Heading left, body right, flower between. */
const BEATS = [
  {
    h: ['Isn’t just', 'an assistant.'],
    p: 'Hikari is a companion. She stands beside your windows, looks up when you speak and remembers how your day went.',
  },
  {
    h: ['Speaks', 'your language.'],
    p: 'English, हिंदी or Hinglish, switching mid-sentence the way you do. Her lips follow every sound.',
  },
  {
    h: ['Everything', 'stays here.'],
    p: 'Her voice, her memories and her brain run on your Mac. Every action waits for your OK.',
  },
];

/**
 * The opening, after ORYZO's product editorial: a giant wordmark in the upper left, a single object in the middle of
 * the frame, the one conversational sentence beside it, an info card lower left and a reel lower right. Scrolling
 * lifts the wordmark into the header, opens the blossom through three beats, then lets its petals go.
 */
export function Hero({ onGet }: { onGet: () => void }) {
  const root = useRef<HTMLElement>(null);
  const word = useRef<HTMLHeadingElement>(null);
  const cta = useRef<HTMLButtonElement>(null);

  useEffect(() => magnetic(cta.current), []);
  useEffect(() => {
    const el = root.current;
    const w = word.current;
    if (!el || !w || prefersReducedMotion()) return;
    const brand = document.querySelector<HTMLElement>('.hd-brand-word');
    const ctx = gsap.context(() => {
      // Entrance: the wordmark's letters rise, then the rest settles in.
      // (.hero-fade's entrance is a CSS animation on `translate`, so it never fights the scroll timeline below.)

      const words = [...el.querySelectorAll<HTMLElement>('.beat')].map((b) => ({
        box: b,
        head: splitWords(b.querySelector('.beat-h')!),
        body: splitWords(b.querySelector('.beat-p')!),
      }));

      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true } });

      // 1 — the wordmark flies up into the header and becomes the logo.
      const toBrand = () => {
        if (!brand) return { x: 0, y: -200, scale: 0.1 };
        // While pinned, the stage sits at the viewport origin, so layout offsets are screen positions. Using offsets
        // (not the live rect) keeps the measurement independent of the tween's own transform and of the scroll.
        let left = 0, top = 0;
        for (let n: HTMLElement | null = w; n && !n.classList.contains('hero-stage'); n = n.offsetParent as HTMLElement | null) {
          left += n.offsetLeft;
          top += n.offsetTop;
        }
        const b = brand.getBoundingClientRect();
        const scale = b.height / w.offsetHeight;
        return { x: b.left - left, y: b.top - top, scale };
      };
      tl.fromTo(w, { x: 0, y: 0, scale: 1 }, { x: () => toBrand().x, y: () => toBrand().y, scale: () => toBrand().scale, ease: 'power2.inOut', duration: 0.1, immediateRender: false }, 0)
        .fromTo(w, { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.005, immediateRender: false }, 0.1)
        .fromTo(brand ?? {}, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.005 }, 0.1)
        .fromTo('.hero-fade', { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -24, duration: 0.05, stagger: 0.005, immediateRender: false }, 0.015);

      // 2 — three beats, each with words that ink in from the haze, then hand over to the next.
      const windows = [[0.17, 0.35], [0.38, 0.56], [0.59, 0.77]];
      words.forEach(({ box, head, body }, i) => {
        const [s, e] = windows[i];
        tl.set(box, { autoAlpha: 1 }, s)
          .fromTo(head, { opacity: 0.12, yPercent: 30 }, { opacity: 1, yPercent: 0, stagger: 0.006, duration: 0.05, ease: 'power2.out' }, s)
          .fromTo(body, { opacity: 0.1 }, { opacity: 1, stagger: 0.004, duration: 0.03 }, s + 0.04)
          .to(box, { autoAlpha: 0, y: -30, duration: 0.03, ease: 'power2.in' }, e - 0.03)
          .set(box, { y: 0 }, e + 0.001);
      });

      // 3 — the finale line arrives as the petals let go and the sky turns to paper.
      tl.fromTo('.hero-finale .ch', { yPercent: 110 }, { yPercent: 0, stagger: 0.004, duration: 0.06, ease: 'power3.out' }, 0.86)
        .to('.hero-finale', { autoAlpha: 1, duration: 0.001 }, 0.86)
        .to({}, { duration: 0.02 }, 0.98);
    }, el);
    return () => {
      ctx.revert();
      if (brand) gsap.set(brand, { clearProps: 'all' });
    };
  }, []);

  const letters = (s: string) =>
    Array.from(s, (c, i) => (
      <span className="chm" key={i} aria-hidden="true" style={{ "--i": i } as React.CSSProperties}>
        <span className="ch">{c === ' ' ? ' ' : c}</span>
      </span>
    ));

  return (
    <section id="top" ref={root} className="hero" aria-labelledby="hero-title">
      <div className="hero-stage">
        <div className="hero-top">
          <p className="hero-tag hero-fade">An anime companion<br />for your Mac.</p>
          <h1 id="hero-title" ref={word} className="hero-word" aria-label="Hikari">
            {letters('Hikari')}
          </h1>
        </div>

        <p className="hero-body hero-fade">
          She lives beside your windows, talks with you in English, <span lang="hi">हिंदी</span> and Hinglish, and keeps
          every word on your Mac.
        </p>

        <aside className="hero-card hero-fade" aria-label="Project status">
          <p className="hero-card-k">Open source.<br />Winter of Code Social 2026.</p>
          <hr />
          <p className="hero-card-p">The signed download is on its way. Run her from source today.</p>
          <button ref={cta} type="button" className="btn btn-fill" onClick={onGet}>
            Get Hikari <ArrowRight size={15} />
          </button>
        </aside>

        <a className="hero-reel hero-fade" href="#cast" onClick={(e) => (e.preventDefault(), scrollToTarget('#cast'))}>
          <video src="/media/signature-motions.mp4" muted loop autoPlay playsInline preload="metadata" aria-hidden="true" />
          <span className="hero-reel-label"><Play size={11} fill="currentColor" /> Meet the cast</span>
        </a>

        <p className="hero-rail hero-fade" aria-hidden="true">Hikari · Companion 01 · macOS</p>
        <button type="button" className="hero-scroll hero-fade" onClick={() => scrollToTarget('#about')}>
          Scroll to bloom
        </button>

        <div className="beats" aria-label="What Hikari is">
          {BEATS.map((b) => (
            <div className="beat" key={b.h.join(' ')}>
              <h2 className="beat-h">
                {b.h[0]}
                <br />
                {b.h[1]}
              </h2>
              <p className="beat-p">{b.p}</p>
            </div>
          ))}
        </div>

        <p className="hero-finale" aria-label="She opens up the more you talk.">
          <span className="hero-finale-a">{letters('She opens up')}</span>
          <em className="hero-finale-b">{letters('the more you talk.')}</em>
        </p>
      </div>
    </section>
  );
}
