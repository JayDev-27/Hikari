import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Github, KeyRound, Lock, MousePointerClick, Moon, ShieldCheck, Layers, Mic } from 'lucide-react';
import { APP_SCREENS, CAST_CHARACTERS, GITHUB_REPO_URL, HOTKEYS, ROADMAP_MILESTONES } from '../data/hikariData';
import { gsap, ScrollTrigger, magnetic, prefersReducedMotion } from './motion';

/* ── Statement ─────────────────────────────────────────────────────────────── */
export function Statement() {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = section.current;
    const hero = el?.previousElementSibling;
    const stage = hero?.querySelector<HTMLElement>('.hero-stage');
    if (!el || !hero || !stage) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const distance = () => (hero.clientHeight - stage.clientHeight) * .12;
      gsap.fromTo(el, {
        y: () => -distance(), opacity: 0,
        clipPath: 'circle(0vmax at 50% 50%)',
      }, {
        y: 0, opacity: 1, clipPath: 'circle(76vmax at 50% 50%)', ease: 'none',
        scrollTrigger: {
          trigger: hero, start: () => 'bottom top+=' + (stage.clientHeight + distance()),
          end: () => '+=' + distance(), scrub: true, invalidateOnRefresh: true,
        },
      });
    });
    return () => media.revert();
  }, []);
  return (
    <section ref={section} id="about" className="sec sec-dark statement" aria-label="What Hikari is">
      <div className="wrap">
        <p className="kicker">What she is</p>
        <p className="statement-text">
          She stands beside your windows, looks up when you speak, and answers in your language. She remembers what
          matters to you, and every word of it stays on your Mac.
        </p>
      </div>
    </section>
  );
}

/* ── Desktop stage ────────────────────────────────────────────────────────── */
export function DesktopStage() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: '.mac', start: 'top 85%', end: 'bottom 30%', scrub: 0.8 } });
      tl.fromTo('.mac-win-a', { y: 80 }, { y: -30, ease: 'none' }, 0)
        .fromTo('.mac-win-b', { y: 140 }, { y: -10, ease: 'none' }, 0)
        .fromTo('.mac-her', { y: 160, scale: 0.94 }, { y: 0, scale: 1, ease: 'power2.out' }, 0)
        .fromTo('.mac-bubble', { autoAlpha: 0, y: 20, scale: 0.9 }, { autoAlpha: 1, y: 0, scale: 1, ease: 'back.out(2)', duration: 0.25 }, 0.35);
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section id="desktop" ref={root} className="sec sec-light desktop" aria-labelledby="desktop-title">
      <div className="wrap">
        <div className="sec-head">
          <p className="kicker">On your desktop</p>
          <h2 id="desktop-title" className="h2" data-split>
            Always there. <em>Never in the way.</em>
          </h2>
          <p className="lede" data-reveal>
            Hikari floats above every app and Space on a transparent stage. Clicks pass straight through, except where
            she is actually drawn.
          </p>
        </div>
        <div className="mac" role="img" aria-label="A Mac desktop with two app windows open and Reze standing beside them">
          <div className="mac-bar">
            <span className="mac-apple"></span>
            <span>Finder</span><span>File</span><span>Edit</span><span>View</span>
            <span className="mac-bar-right">
              <img src="/media/hikari-mark.png" alt="" width={14} height={14} /> Thu 9:41
            </span>
          </div>
          <div className="mac-wall" />
          <div className="mac-win mac-win-a">
            <div className="mac-win-top"><i /><i /><i /><span>notes.md</span></div>
            <div className="mac-lines"><b style={{ width: '62%' }} /><b style={{ width: '84%' }} /><b style={{ width: '48%' }} /><b style={{ width: '76%' }} /><b style={{ width: '58%' }} /></div>
          </div>
          <div className="mac-win mac-win-b">
            <div className="mac-win-top"><i /><i /><i /><span>studio.tsx</span></div>
            <div className="mac-code">
              <b className="c1" style={{ width: '40%' }} /><b className="c2" style={{ width: '70%', marginLeft: '8%' }} /><b className="c3" style={{ width: '55%', marginLeft: '8%' }} />
              <b className="c2" style={{ width: '62%', marginLeft: '16%' }} /><b className="c1" style={{ width: '30%' }} /><b className="c3" style={{ width: '66%', marginLeft: '8%' }} />
            </div>
          </div>
          <img className="mac-her" src="/media/hikari-cast-reze.webp" alt="" width={720} height={880} loading="lazy" />
          <div className="mac-bubble">Long day? <span>Chai first, then the bug.</span></div>
        </div>
        <ul className="facts">
          <li data-reveal><MousePointerClick size={20} /><b>Clicks pass through</b><span>Only her pixels catch the mouse, so your work stays reachable.</span></li>
          <li data-reveal data-delay="0.08"><Layers size={20} /><b>Every Space, every app</b><span>Even over full-screen windows, without stealing focus.</span></li>
          <li data-reveal data-delay="0.16"><Moon size={20} /><b>Rests when you do</b><span>She stops drawing while your Mac is locked or its display sleeps.</span></li>
        </ul>
      </div>
    </section>
  );
}

/* ── Cast ─────────────────────────────────────────────────────────────────── */
type Lang = 'english' | 'hindi' | 'hinglish';
const LANGS: { id: Lang; label: string }[] = [
  { id: 'english', label: 'English' },
  { id: 'hindi', label: 'हिंदी' },
  { id: 'hinglish', label: 'Hinglish' },
];
const HUES: Record<string, number> = { makima: 8, reze: 262, rize: 292, 'cheng-xiaoshi': 214, 'lu-guang': 196 };

export function Cast() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [lang, setLang] = useState<Record<string, Lang>>({});

  useEffect(() => {
    const el = root.current, rail = track.current;
    if (!el || !rail || prefersReducedMotion() || !window.matchMedia('(min-width: 900px)').matches) return;
    const ctx = gsap.context(() => {
      const distance = () => rail.scrollWidth - window.innerWidth + 80;
      gsap.to(rail, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: { trigger: '.cast-pin', start: 'top top', end: () => `+=${distance()}`, scrub: 0.8, pin: true, invalidateOnRefresh: true, anticipatePin: 1 },
      });
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section id="cast" ref={root} className="sec sec-dark cast" aria-labelledby="cast-title">
      <div className="cast-pin">
        <div className="wrap cast-head">
          <p className="kicker">The cast</p>
          <h2 id="cast-title" className="h2" data-split>
            Five characters. <em>Five personalities.</em>
          </h2>
          <p className="lede lede-dark" data-reveal>
            Each one is hand-rigged, with a persona of their own and a signature move they play on cue. Bring your own
            Live2D, Iki or VRM character too.
          </p>
        </div>
        <div className="cast-rail" ref={track}>
          {CAST_CHARACTERS.map((c, i) => {
            const l = lang[c.id] ?? 'hinglish';
            return (
              <article key={c.id} className="card" style={{ '--hue': HUES[c.id] ?? 230 } as React.CSSProperties} aria-labelledby={`cast-${c.id}`}>
                <div className="card-art">
                  <span className="card-index">0{i + 1}</span>
                  <img src={c.image} alt={c.imageAlt} width={720} height={880} loading="lazy" />
                </div>
                <div className="card-body">
                  <h3 id={`cast-${c.id}`} className="card-name">{c.name}</h3>
                  <p className="card-move">{c.signatureMove}</p>
                  <div className="seg" role="group" aria-label={`${c.name} speaks`}>
                    {LANGS.map((x) => (
                      <button key={x.id} type="button" aria-pressed={l === x.id} onClick={() => setLang((s) => ({ ...s, [c.id]: x.id }))}>
                        {x.label}
                      </button>
                    ))}
                  </div>
                  <p className="card-quote" lang={l === 'hindi' ? 'hi' : 'en'}>“{c.samples[l]}”</p>
                </div>
              </article>
            );
          })}
          <article className="card card-yours">
            <div className="card-yours-inner">
              <Layers size={26} />
              <h3 className="card-name">Your own</h3>
              <p>Import a Live2D folder, an Iki rig or a .vrm in Character Studio. Its licence travels with it.</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── Voice ─────────────────────────────────────────────────────────────────── */
const PHRASES: { lang: string; text: string; tag: string }[] = [
  { lang: 'Hinglish', text: 'Aaj ka plan? Pehle chai, phir dekhte hain.', tag: 'en' },
  { lang: 'हिंदी', text: 'बारिश हो रही है… चलो, थोड़ी देर बातें करते हैं।', tag: 'hi' },
  { lang: 'English', text: "Let's skip the boring part of the day.", tag: 'en' },
];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

export function Voice() {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const [mouth, setMouth] = useState<number[]>([0, 0, 0, 0, 0]);
  const root = useRef<HTMLElement>(null);
  const live = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => (live.current = e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const phrase = PHRASES[i].text;
    if (reduced) {
      setShown(phrase.length);
      return;
    }
    let n = 0;
    let raf = 0, last = 0;
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (!live.current || t - last < 55) return;
      last = t;
      n = Math.min(phrase.length, n + 1);
      setShown(n);
      const ch = phrase[n - 1]?.toLowerCase() ?? ' ';
      const has = (set: string) => [...set].some((c) => ch.includes(c));
      const target = [has('aाआ') ? 1 : 0.15, has('iीि') ? 0.9 : 0.1, has('uूुo') ? 0.9 : 0.1, has('eेै') ? 0.9 : 0.1, has('oोौ') ? 0.8 : 0.1];
      if (/[mbpमबप ]/.test(ch)) target.fill(0.04); // lips close fully on m, b, p
      setMouth(target);
      if (n >= phrase.length) {
        cancelAnimationFrame(raf);
        setTimeout(() => {
          setShown(0);
          setI((x) => (x + 1) % PHRASES.length);
        }, 2200);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [i]);

  const p = PHRASES[i];
  return (
    <section id="voice" ref={root} className="sec sec-dark voice" aria-labelledby="voice-title">
      <div className="wrap voice-grid">
        <div>
          <p className="kicker">Speech</p>
          <h2 id="voice-title" className="h2" data-split>
            She speaks <em>your</em> language.
          </h2>
          <p className="lede lede-dark" data-reveal>
            English, हिंदी or Hinglish, switching mid-sentence the way you do. Her lips follow every sound, within
            8 milliseconds of what you hear.
          </p>
          <dl className="stats" data-reveal>
            <div><dt>±8 ms</dt><dd>lip sync to the audio</dd></div>
            <div><dt>3</dt><dd>languages, mixed freely</dd></div>
            <div><dt>m · b · p</dt><dd>lips always close</dd></div>
          </dl>
        </div>
        <div className="voice-card" data-reveal aria-label="Live lip-sync demo">
          <div className="voice-top">
            <span className="voice-lang">{p.lang}</span>
            <span className="voice-live"><i /> Speaking</span>
          </div>
          <p className="voice-text" lang={p.tag} aria-live="polite">
            <span>{p.text.slice(0, shown)}</span>
            <span className="voice-rest">{p.text.slice(shown)}</span>
          </p>
          <div className="wave" aria-hidden="true">
            {Array.from({ length: 48 }, (_, k) => (
              <i key={k} style={{ transform: `scaleY(${0.12 + Math.abs(Math.sin((shown + k) * 0.7)) * (shown < p.text.length ? 0.88 : 0.1)})` }} />
            ))}
          </div>
          <div className="visemes" aria-hidden="true">
            {VISEMES.map((v, k) => (
              <div key={v}>
                <span style={{ transform: `scaleY(${mouth[k]})` }} />
                <b>{v}</b>
              </div>
            ))}
          </div>
          <p className="voice-keys">
            {HOTKEYS.map((h) => (
              <span key={h.keys}><kbd>{h.keys}</kbd> {h.label.split(' (')[0]}</span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Inside the app ───────────────────────────────────────────────────────── */
export function Inside() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const triggers = [...el.querySelectorAll<HTMLElement>('.step')].map((s, k) =>
      ScrollTrigger.create({ trigger: s, start: 'top 60%', end: 'bottom 60%', onToggle: (self) => self.isActive && setActive(k) }),
    );
    return () => triggers.forEach((t) => t.kill());
  }, []);

  return (
    <section id="app" ref={root} className="sec sec-light inside" aria-labelledby="app-title">
      <div className="wrap">
        <div className="sec-head">
          <p className="kicker">The app</p>
          <h2 id="app-title" className="h2" data-split>
            Everything, <em>beautifully native.</em>
          </h2>
        </div>
        <div className="inside-grid">
          <ol className="steps">
            {APP_SCREENS.map((s, k) => (
              <li key={s.id} className={`step${active === k ? ' is-active' : ''}`}>
                <span className="step-n">0{k + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.detail}</p>
                <img className="step-shot" src={s.image} alt={`${s.title} window`} loading="lazy" width={s.width} height={s.height} />
              </li>
            ))}
          </ol>
          <div className="screen-wrap">
            <div className="screen">
              {APP_SCREENS.map((s, k) => (
                <img key={s.id} src={s.image} alt={active === k ? `${s.title} window` : ''} aria-hidden={active !== k} className={active === k ? 'is-on' : ''} width={s.width} height={s.height} loading={k === 0 ? 'eager' : 'lazy'} />
              ))}
              <span className="screen-tag">{APP_SCREENS[active].sample ? 'Preview with sample data' : 'Real app window'}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Privacy & safety ─────────────────────────────────────────────────────── */
export function Privacy() {
  return (
    <section id="private" className="sec sec-dark privacy" aria-labelledby="private-title">
      <div className="wrap">
        <div className="sec-head">
          <p className="kicker">Private by design</p>
          <h2 id="private-title" className="h2" data-split>
            Yours, and <em>only yours.</em>
          </h2>
        </div>
        <div className="priv-grid">
          <article className="priv priv-wide" data-reveal>
            <div className="priv-copy">
              <ShieldCheck size={22} />
              <h3>She asks before she acts.</h3>
              <p>Every action on your Mac waits for your OK. Deny is the default, sensitive steps need a deliberate press-and-hold, and anything you ignore is denied after a minute. Each decision lands in a permanent audit log.</p>
            </div>
            <div className="confirm" aria-hidden="true">
              <p className="confirm-k">Hikari wants to act <span>Takes action</span></p>
              <p className="confirm-t">Open Visual Studio Code</p>
              <p className="confirm-a"><code>open_app</code> app: Visual Studio Code</p>
              <div className="confirm-row">
                <span className="confirm-ring" /> Denies in 42 s
                <span className="confirm-btn hold">Hold to Allow</span>
                <span className="confirm-btn deny">Deny</span>
              </div>
            </div>
          </article>
          <article className="priv" data-reveal data-delay="0.06">
            <Lock size={22} />
            <h3>Local first.</h3>
            <p>Voice, memories and her brain run on your Mac by default. Cloud providers are optional, and you choose them.</p>
          </article>
          <article className="priv" data-reveal data-delay="0.12">
            <KeyRound size={22} />
            <h3>Keys in your Keychain.</h3>
            <p>API keys never touch a file. Only their last four characters are ever shown back.</p>
          </article>
          <article className="priv" data-reveal data-delay="0.18">
            <Mic size={22} />
            <h3>Consent for every voice.</h3>
            <p>Voice Lab won’t record anyone else’s voice until they’ve recorded their own consent.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── Open source ──────────────────────────────────────────────────────────── */
export function OpenSource() {
  const btn = useRef<HTMLAnchorElement>(null);
  useEffect(() => magnetic(btn.current), []);
  return (
    <section id="open-source" className="sec sec-light open" aria-labelledby="open-title">
      <div className="wrap open-grid">
        <div>
          <p className="kicker">Open source · MIT</p>
          <h2 id="open-title" className="h2" data-split>
            Built in the open, <em>with you.</em>
          </h2>
          <p className="lede" data-reveal>
            Hikari is a Winter of Code Social 2026 project. Beginner-friendly issues are labelled and waiting, from docs
            and tests to animation, audio and native macOS work.
          </p>
          <div className="open-actions" data-reveal>
            <a ref={btn} className="btn btn-dark" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              <Github size={17} /> Star on GitHub
            </a>
            <a className="btn btn-line" href={`${GITHUB_REPO_URL}/issues?q=is%3Aissue+is%3Aopen+label%3Awocs`} target="_blank" rel="noreferrer">
              Find an issue <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
        <ol className="how" data-reveal>
          <li><span>1</span><div><b>Pick an issue</b><p>Labelled <code>level 1</code> to <code>level 3</code>. Comment to claim it.</p></div></li>
          <li><span>2</span><div><b>Read the guide</b><p>CONTRIBUTING.md covers setup, the checks and our AI policy.</p></div></li>
          <li><span>3</span><div><b>Open a pull request</b><p>A maintainer or mentor reviews it with you, then it ships.</p></div></li>
        </ol>
      </div>
    </section>
  );
}

/* ── Roadmap ─────────────────────────────────────────────────────────────── */
export function Roadmap() {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.road-line i', { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.road', start: 'top 70%', end: 'bottom 60%', scrub: 0.6 } });
    }, el);
    return () => ctx.revert();
  }, []);
  return (
    <section id="roadmap" ref={root} className="sec sec-dark roadmap" aria-labelledby="road-title">
      <div className="wrap">
        <div className="sec-head">
          <p className="kicker">Roadmap</p>
          <h2 id="road-title" className="h2" data-split>
            Where she’s <em>headed.</em>
          </h2>
          <p className="lede lede-dark" data-reveal>
            Built in two halves: the desktop body, and the brain that listens and speaks. The body is nearly complete.
          </p>
        </div>
        <ol className="road">
          <span className="road-line" aria-hidden="true"><i /></span>
          {ROADMAP_MILESTONES.map((m) => (
            <li key={m.id} className={`road-item is-${m.status}`} data-reveal>
              <span className="road-dot" aria-hidden="true">{m.status === 'done' ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span className="road-id">{m.id}</span>
              <div className="road-body">
                <h3>{m.title}</h3>
                <p>{m.detail}</p>
              </div>
              <span className="road-status">{m.statusLabel}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Final call to action ────────────────────────────────────────────────── */
export function FinalCta({ onGet }: { onGet: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => magnetic(btn.current), []);
  return (
    <section className="sec sec-dark final" aria-labelledby="final-title">
      <div className="wrap final-inner">
        <img className="final-icon" src="/media/hikari-app-icon.png" alt="" width={120} height={120} loading="lazy" data-reveal />
        <h2 id="final-title" className="final-title" data-split>
          Hikari, <em>for your Mac.</em>
        </h2>
        <p className="lede lede-dark" data-reveal>
          The signed download is on its way. Until then, she’s one command away from source.
        </p>
        <div className="hero-actions" data-reveal>
          <button ref={btn} type="button" className="btn btn-light" onClick={onGet}>
            Get Hikari <ArrowRight size={16} />
          </button>
          <a className="btn btn-ghost" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            View the source <ArrowUpRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
