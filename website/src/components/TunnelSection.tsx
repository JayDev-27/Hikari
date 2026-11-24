import { useEffect, useState } from 'react';
import { TUNNEL_CHAPTERS } from '../data/hikariData';
import { scrollToSection, sharedScrollState } from '../hooks/useSmoothScroll';

export function TunnelSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let raf = 0;
    const syncChapter = () => {
      raf = requestAnimationFrame(syncChapter);
      const compactMode =
        window.innerWidth < 768 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (compactMode) return;
      const tp = sharedScrollState.tunnelProgress;
      const next = Math.min(TUNNEL_CHAPTERS.length - 1, Math.floor(tp * TUNNEL_CHAPTERS.length));
      setActiveIndex((prev) => (prev === next ? prev : next));
    };
    raf = requestAnimationFrame(syncChapter);
    return () => cancelAnimationFrame(raf);
  }, []);

  const jumpToChapter = (idx: number) => {
    const compactMode =
      window.innerWidth < 768 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (compactMode) {
      setActiveIndex(idx);
      return;
    }
    const tunnelEl = document.getElementById('architecture-tunnel');
    if (!tunnelEl) return;
    const top = tunnelEl.getBoundingClientRect().top + window.scrollY;
    const span = Math.max(1, tunnelEl.offsetHeight - window.innerHeight);
    const targetY = top + (idx / TUNNEL_CHAPTERS.length) * span + 40;
    scrollToSection(targetY);
  };

  const current = TUNNEL_CHAPTERS[activeIndex];

  return (
    <section
      id="architecture-tunnel"
      className="tunnel-track"
      aria-label="Hikari 3D Architecture Flythrough"
    >
      <div className="tunnel-sticky">
        <div className="tunnel-sticky-backdrop" aria-hidden="true" />

        <div className="tunnel-header-row">
          <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.72)' }}>
            ARCHITECTURE // SCROLL FLYTHROUGH
          </span>
          <span className="glass-chip">
            ACT {current.index} / 0{TUNNEL_CHAPTERS.length}
          </span>
        </div>

        <div className="tunnel-stage-card">
          <div className="tunnel-step-kicker">{current.kicker}</div>
          <h2 className="tunnel-step-title">{current.title}</h2>
          <p className="tunnel-step-desc">{current.description}</p>
          <div className="tunnel-specs">
            {current.specs.map((spec) => (
              <span key={spec} className="tunnel-spec-chip">
                {spec}
              </span>
            ))}
          </div>
        </div>

        {/* Mobile fallback list ensures all 4 chapters read effortlessly on narrow screens */}
        <div className="tunnel-progress-rail" role="tablist" aria-label="Architecture chapters">
          {TUNNEL_CHAPTERS.map((ch, idx) => (
            <button
              key={ch.index}
              type="button"
              role="tab"
              aria-selected={idx === activeIndex}
              className={`tunnel-rail-item ${idx === activeIndex ? 'is-active' : ''}`}
              onClick={() => jumpToChapter(idx)}
              style={{ textAlign: 'left' }}
            >
              <div>{ch.index}</div>
              <div style={{ marginTop: 4 }}>{ch.kicker.replace(/^ACT \d+ \/\/ /, '')}</div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
