import { ArrowRight, Download } from 'lucide-react';
import { CrosshairRow } from './CrosshairRow';
import { scrollToSection } from '../hooks/useSmoothScroll';

interface HeroSectionProps {
  onOpenDownload: () => void;
}

export function HeroSection({ onOpenDownload }: HeroSectionProps) {
  return (
    <section id="hero" className="hero-section hero-section--fullscreen">
      <div className="hero-fullscreen-inner">
        <div className="hero-copy-block">
          <span className="mono-tag hero-eyebrow">
            <span className="glass-chip-dot" aria-hidden="true" />
            <span>MACOS 13+ APPLE SILICON · LOCAL-FIRST AI COMPANION</span>
          </span>

          <h1 className="hero-h1 hero-h1--fullscreen">
            A local-first anime AI companion that lives on your Mac&apos;s desktop.
          </h1>

          <p className="hero-sub hero-sub--fullscreen">
            She floats over every Space and full-screen app without stealing focus, speaks Hindi,
            English, and Hinglish with ±8 ms lip sync, and moves like the character she is.
          </p>

          <div className="hero-actions">
            <button type="button" className="pill-cta pill-cta--sakura" onClick={onOpenDownload}>
              <Download className="pill-arrow" aria-hidden="true" />
              <span className="pill-label">Download · Coming Soon</span>
              <span className="pill-dot" aria-hidden="true" />
            </button>

            <button
              type="button"
              className="pill-cta pill-cta--glass"
              onClick={() => scrollToSection('#architecture-tunnel')}
            >
              <ArrowRight className="pill-arrow" aria-hidden="true" />
              <span className="pill-label">Explore 3D Pipeline</span>
              <span className="pill-dot" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="hero-bottom-bar hero-bottom-bar--fullscreen">
        <CrosshairRow count={2} />
        <span className="scroll-prompt">SCROLL TO EXPLORE</span>
        <CrosshairRow count={2} />
      </div>
    </section>
  );
}
