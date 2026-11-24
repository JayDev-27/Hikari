import { ArrowRight, ArrowUp, Download, ExternalLink } from 'lucide-react';
import { CrosshairRow } from './CrosshairRow';
import { GITHUB_RELEASES_URL, GITHUB_REPO_URL } from '../data/hikariData';
import { scrollToSection } from '../hooks/useSmoothScroll';

interface EndAndFooterSectionProps {
  onOpenDownload: () => void;
}

export function EndAndFooterSection({ onOpenDownload }: EndAndFooterSectionProps) {
  return (
    <>
      {/* Closing Hook */}
      <section className="end-hook-section">
        <span className="mono-tag">READY TO BRING HER TO YOUR DESKTOP?</span>
        <h2 className="display-giant" style={{ marginBottom: 8 }}>
          Hikari for macOS
        </h2>
        <p className="editorial-lead" style={{ maxWidth: 620, marginBottom: 10 }}>
          Apple Silicon native desktop companion. Signed <code>.dmg</code> download is coming soon—or
          clone and run the desktop stage from source today.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
          <button type="button" className="pill-cta" onClick={onOpenDownload}>
            <Download className="pill-arrow" aria-hidden="true" />
            <span className="pill-label">Download · Coming Soon</span>
            <span className="pill-dot" aria-hidden="true" />
          </button>

          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="pill-cta pill-cta--light"
          >
            <ExternalLink className="pill-arrow" aria-hidden="true" />
            <span className="pill-label">Clone on GitHub</span>
            <span className="pill-dot" style={{ background: '#1a2ffb' }} aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* Light Editorial Footer */}
      <footer className="site-footer">
        <div className="footer-grid">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <img
                src="/media/hikari-app-icon.png"
                alt="Hikari icon"
                style={{ width: 34, height: 34, borderRadius: 8 }}
              />
              <span className="brand-wordmark" style={{ fontSize: 17 }}>
                <span className="brand-kanji">光</span>HIKARI
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted)', maxWidth: 260 }}>
              Local-first anime AI companion for macOS 13+ Apple Silicon. Built with Tauri v2,
              React 19, Pixi 8, and Iki.
            </p>
          </div>

          <div>
            <h3 className="footer-heading">Explore</h3>
            <ul className="footer-links">
              <li>
                <a
                  href="#hero"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection('#hero');
                  }}
                >
                  Overview
                </a>
              </li>
              <li>
                <a
                  href="#showreel"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection('#showreel');
                  }}
                >
                  Stage Showreel
                </a>
              </li>
              <li>
                <a
                  href="#cast"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection('#cast');
                  }}
                >
                  The Cast
                </a>
              </li>
              <li>
                <a
                  href="#architecture-tunnel"
                  onClick={(e) => {
                    e.preventDefault();
                    scrollToSection('#architecture-tunnel');
                  }}
                >
                  Architecture
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="footer-heading">Repository</h3>
            <ul className="footer-links">
              <li>
                <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
                  GitHub Source
                </a>
              </li>
              <li>
                <a href={`${GITHUB_REPO_URL}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">
                  Architecture Docs
                </a>
              </li>
              <li>
                <a href={`${GITHUB_REPO_URL}/blob/main/docs/LICENSES.md`} target="_blank" rel="noreferrer">
                  Asset Licenses
                </a>
              </li>
              <li>
                <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
                  Releases (Coming Soon)
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="footer-heading">Desktop Installer</h3>
            <p style={{ margin: '0 0 14px', fontSize: 15, color: 'var(--ink-secondary)' }}>
              Public signed <code>Hikari.dmg</code> release is scheduled for milestone M8.
            </p>
            <button type="button" className="pill-cta" onClick={onOpenDownload}>
              <Download className="pill-arrow" aria-hidden="true" />
              <span className="pill-label">macOS Download · Coming Soon</span>
              <span className="pill-dot" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="footer-bottom">
          <span>MIT License · Hikari Desktop Project</span>
          <span>Made with 光 for macOS Apple Silicon</span>
          <button
            type="button"
            className="back-to-top"
            onClick={() => scrollToSection(0)}
            aria-label="Scroll back to top"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </footer>

      {/* Stark Black Bottom Transition Band (Lusion signature cap) */}
      <div className="scroll-nav-band">
        <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.65)' }}>
          CONTINUE TO SOURCE &amp; DOCS
        </span>

        <div className="scroll-nav-row">
          <h2 className="scroll-nav-title">GITHUB SOURCE</h2>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="scroll-nav-next"
          >
            <span>OPEN REPOSITORY</span>
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>

        <CrosshairRow count={5} />
      </div>
    </>
  );
}
