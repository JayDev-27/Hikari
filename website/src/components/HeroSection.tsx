import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Rotate3D, X } from 'lucide-react';
import type { createSakuraExperience } from '../webgl/SakuraExperience';

type Scene = ReturnType<typeof createSakuraExperience>;
type SceneStatus = 'loading' | 'live' | 'fallback';
const chapters = [
  { name: 'Bud', progress: 0 },
  { name: 'Bloom', progress: .43 },
  { name: 'Within', progress: .84 },
];

const ARRIVAL = .81;

function measureTrack(section: HTMLElement, host: HTMLElement, flight: HTMLElement) {
  const bounds = section.getBoundingClientRect();
  const height = host.getBoundingClientRect().height;
  const arrival = Math.max(1, flight.getBoundingClientRect().height - height);
  return { offset: -bounds.top, arrival, end: Math.max(arrival + 1, bounds.height - height) };
}

function smooth(value: number, lower: number, upper: number) {
  const t = Math.max(0, Math.min((value - lower) / (upper - lower), 1));
  return t * t * (3 - 2 * t);
}

export function HeroSection({ onOpenDownload, children }: { onOpenDownload: () => void; children: ReactNode }) {
  const track = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const orbitSurface = useRef<HTMLDivElement>(null);
  const orbitButton = useRef<HTMLButtonElement>(null);
  const scene = useRef<Scene | null>(null);
  const orbit = useRef({ on: false, yaw: .27, pitch: .10, dragX: 0, dragY: 0, pointer: -1 });
  const rerender = useRef<() => void>(() => {});
  const [status, setStatus] = useState<SceneStatus>('loading');
  const [inspecting, setInspecting] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [showCopy, setShowCopy] = useState(true);
  const [showEnd, setShowEnd] = useState(false);
  const [showBloomText, setShowBloomText] = useState(false);

  const setInspection = useCallback((on: boolean) => {
    orbit.current.on = on;
    orbit.current.pointer = -1;
    if (on) {
      orbit.current.yaw = .27;
      orbit.current.pitch = .10;
    }
    setInspecting(on);
    rerender.current();
  }, []);

  useEffect(() => {
    if (inspecting) orbitSurface.current?.focus({ preventScroll: true });
  }, [inspecting]);

  useEffect(() => {
    const section = track.current;
    const element = viewport.current;
    const mount = host.current;
    const approach = flight.current;
    if (!section || !element || !mount || !approach) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let visible = true;
    let frame = 0;
    let lastDraw = 0;
    let dirty = true;
    let resizePending = true;
    let previous = 0;
    let previousCopy = true;
    let previousEnd = false;
    let previousBloomText = false;
    let previousProgress = -1;
    let lastScroll = window.scrollY;

    function schedule() {
      dirty = true;
      if (!frame) frame = requestAnimationFrame(draw);
    }
    rerender.current = schedule;

    function readProgress() {
      if (reduced.matches || !section || !element || !approach) return 0;
      const { offset, arrival, end } = measureTrack(section, element, approach);
      if (offset <= arrival) return ARRIVAL * Math.max(0, offset / arrival);
      return ARRIVAL + (1 - ARRIVAL) * Math.min(1, (offset - arrival) / (end - arrival));
    }

    function draw(now: number) {
      frame = 0;
      if (disposed || !visible || document.hidden || !element) return;
      const current = scene.current;
      const progress = current ? readProgress() : 0;
      if (progress !== previousProgress) {
        previousProgress = progress;
        const copy = progress < .29 || reduced.matches;
        const showBloom = progress > .245 && progress < .61 && !reduced.matches && scene.current !== null;
        const end = progress > .71 && progress < .825 && !reduced.matches && current !== null;
        const nextChapter = progress < .23 ? 0 : progress < .64 ? 1 : 2;
        element.style.setProperty('--scene-progress', String(progress));
        element.style.setProperty('--intro-opacity', String(1 - smooth(progress, .115, .295)));
        element.style.setProperty('--hero-line-one', String(smooth(progress, .065, .275)));
        element.style.setProperty('--hero-line-two', String(smooth(progress, .1, .29)));
        element.style.setProperty('--bloom-copy', String(smooth(progress, .245, .38) * (1 - smooth(progress, .49, .62))));
        element.style.setProperty('--inside-opacity', String(smooth(progress, .71, .78) * (1 - smooth(progress, .79, .825))));
        const contentRevealed = progress >= .829;
        element.toggleAttribute('data-content-revealed', contentRevealed);
        element.querySelector<HTMLElement>('.bloom-rail')?.toggleAttribute('inert', contentRevealed);
        if (previous !== nextChapter) { previous = nextChapter; setChapter(nextChapter); }
        if (previousCopy !== copy) { previousCopy = copy; setShowCopy(copy); }
        if (previousEnd !== end) { previousEnd = end; setShowEnd(end); }
        if (previousBloomText !== showBloom) { previousBloomText = showBloom; setShowBloomText(showBloom); }
      }

      if (current && (dirty || (!reduced.matches && now - lastDraw > 1000 / 29))) {
        try {
          if (resizePending) { current.resize(); resizePending = false; }
          const { on, yaw, pitch } = orbit.current;
          current.draw(reduced.matches ? .12 : progress, reduced.matches ? 0 : now / 1000, yaw, pitch, on);
          dirty = false;
          lastDraw = now;
        } catch {
          showFallback();
        }
      }
      if (scene.current && !reduced.matches && !frame) frame = requestAnimationFrame(draw);
    }

    function showFallback() {
      const current = scene.current;
      scene.current = null;
      current?.canvas.removeEventListener('webglcontextlost', showFallback);
      current?.dispose();
      setStatus('fallback');
      setInspection(false);
    }

    function onScroll() {
      const y = window.scrollY;
      if (Math.abs(y - lastScroll) >= 8) {
        lastScroll = y;
        if (orbit.current.on && !reduced.matches) {
          const restoreFocus = document.activeElement === orbitSurface.current;
          setInspection(false);
          if (restoreFocus) orbitButton.current?.focus({ preventScroll: true });
        }
      }
      schedule();
    }

    function movePointer(event: PointerEvent) {
      if (!visible || reduced.matches || orbit.current.on || event.pointerType === 'touch' || !element) return;
      const bounds = element.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      scene.current?.movePointer((event.clientX - bounds.left) / bounds.width,
        1 - (event.clientY - bounds.top) / bounds.height, performance.now() / 1000);
      schedule();
    }

    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
    });
    visibility.observe(element);

    const resize = new ResizeObserver(() => { resizePending = true; schedule(); });
    resize.observe(element);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pageshow', schedule);
    window.addEventListener('pointermove', movePointer, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', schedule);
    schedule();

    void import('../webgl/SakuraExperience').then(({ createSakuraExperience }) => {
      if (disposed) return;
      try {
        const created = createSakuraExperience(mount);
        scene.current = created;
        created.canvas.addEventListener('webglcontextlost', showFallback);
        created.resize();
        resizePending = false;
        created.draw(reduced.matches ? .12 : readProgress(),
          reduced.matches ? 0 : performance.now() / 1000, 0, 0, false);
        setStatus('live');
        schedule();
      } catch {
        showFallback();
      }
    }).catch(() => { if (!disposed) showFallback(); });

    return () => {
      disposed = true;
      visibility.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pageshow', schedule);
      window.removeEventListener('pointermove', movePointer);
      document.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', schedule);
      scene.current?.canvas.removeEventListener('webglcontextlost', showFallback);
      scene.current?.dispose();
      scene.current = null;
    };
  }, [setInspection]);

  function jump(progress: number) {
    setInspection(false);
    if (!track.current || !viewport.current || !flight.current) return;
    const { offset, arrival, end } = measureTrack(track.current, viewport.current, flight.current);
    const target = progress <= ARRIVAL
      ? arrival * progress / ARRIVAL
      : arrival + (end - arrival) * (progress - ARRIVAL) / (1 - ARRIVAL);
    window.scrollTo({
      top: window.scrollY - offset + target,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  function rotate(yaw: number, pitch: number) {
    orbit.current.yaw += yaw;
    orbit.current.pitch = Math.max(-1.36, Math.min(1.36, orbit.current.pitch + pitch));
    rerender.current();
  }

  return (
    <section id="hero" ref={track} className="bloom-track" data-state={status}>
      <div className="bloom-viewport" ref={viewport} data-inspecting={inspecting}>
        <div className="bloom-atmosphere" aria-hidden="true" />
        {status === 'fallback' && (
          <picture className="bloom-still" aria-hidden="true">
            <source media="(max-width: 720px)" srcSet="/media/sakura-look-mobile.webp" />
            <img src="/media/sakura-look.webp" width="1536" height="1024" alt="" />
          </picture>
        )}
        {status === 'loading' && <p className="bloom-loading" role="status">Loading the 3D blossom</p>}
        <div className="bloom-canvas" ref={host} aria-hidden="true" />
        <div className="bloom-grade" aria-hidden="true" />
        <div className="bloom-content">
          <div className="bloom-intro" inert={!showCopy || inspecting}>
            <p className="bloom-kicker"><i aria-hidden="true" /> Open source for macOS</p>
            <h1><span className="hero-title-mask"><span>Meet</span></span>{' '}
              <span className="hero-title-mask hero-title-name"><em>Hikari.</em></span></h1>
            <p className="bloom-description">An anime companion for your Mac. Pick a character, bring it to your desktop, and keep the stage running locally.</p>
            <div className="bloom-actions">
              <button className="bloom-primary" onClick={onOpenDownload}>macOS release <ArrowUpRight size={17} /></button>
              <a className="bloom-secondary" href="#showreel">See the app <ArrowRight size={16} /></a>
            </div>
          </div>
        </div>
        <div className="bloom-mid-copy" inert={!showBloomText || inspecting}>
          <p className="bloom-kicker"><i aria-hidden="true" /> The characters</p>
          <h2><span>Every gesture</span><span>has a personality.</span></h2>
        </div>
        <div className="bloom-inside" inert={!showEnd || inspecting}>
          <h2><span>See Hikari in motion.</span></h2>
          <a href="#showreel">Step inside <ArrowDown size={17} /></a>
        </div>
        {inspecting && (
          <div className="bloom-orbit" ref={orbitSurface} role="group" aria-label="Inspect the 3D blossom with drag or arrow keys" tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setInspection(false); orbitButton.current?.focus(); return; }
              const move = { ArrowLeft: [-.18, 0], ArrowRight: [.18, 0], ArrowUp: [0, .16], ArrowDown: [0, -.16] }[event.key];
              if (move) { event.preventDefault(); rotate(move[0], move[1]); }
            }}
            onPointerDown={(event) => {
              if (orbit.current.pointer !== -1) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              orbit.current.pointer = event.pointerId;
              orbit.current.dragX = event.clientX;
              orbit.current.dragY = event.clientY;
            }}
            onPointerMove={(event) => {
              if (orbit.current.pointer !== event.pointerId) return;
              rotate((orbit.current.dragX - event.clientX) * .012, (event.clientY - orbit.current.dragY) * .009);
              orbit.current.dragX = event.clientX;
              orbit.current.dragY = event.clientY;
            }}
            onLostPointerCapture={() => { orbit.current.pointer = -1; }}
          />
        )}
        {status === 'live' && (
          <div className="bloom-rail">
            <button className="bloom-scroll" type="button" aria-label={chapter === 0 ? 'Scroll to bloom' : 'Continue the experience'}
              onClick={() => {
                if (chapter < 2) jump(chapters[chapter + 1].progress);
                else document.getElementById('showreel')?.scrollIntoView({ behavior: 'smooth' });
              }}>
              <ArrowDown size={16} aria-hidden="true" /> <span>{chapter === 0 ? 'Scroll to bloom' : 'Continue'}</span>
            </button>
            <div className="bloom-steps" aria-label="Blossom chapters">
              {chapters.map((step, index) => (
                <button type="button" key={step.name} onClick={() => jump(step.progress)}
                  aria-current={!inspecting && chapter === index ? 'step' : undefined}>{step.name}</button>
              ))}
            </div>
            <button className="bloom-inspect" ref={orbitButton} type="button" onClick={() => setInspection(!inspecting)}
              aria-pressed={inspecting}>
              {inspecting ? <X size={16} /> : <Rotate3D size={16} />}
              <span>{inspecting ? 'Exit orbit' : '360° view'}</span>
            </button>
          </div>
        )}
      </div>
      <div className="bloom-content-flow">
        <div ref={flight} className="bloom-flight" aria-hidden="true" />
        <div className="bloom-chapters">
          <nav className="interior-navigation" aria-label="Inside the blossom">
            <a href="#showreel">The App</a>
            <a href="#cast">The Cast</a>
            <a href="#architecture-tunnel">Technology</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#hikari-closing">Mac release</a>
          </nav>
          {children}
        </div>
      </div>
    </section>
  );
}
