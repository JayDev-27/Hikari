import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { GITHUB_REPO_URL } from '../data/hikariData';
import { scrollToSection } from '../hooks/useSmoothScroll';

interface HeaderProps {
  onOpenDownload: () => void;
}

const NAV_ITEMS = [
  { id: '#hero', index: '01', label: 'Overview' },
  { id: '#showreel', index: '02', label: 'Showreel' },
  { id: '#cast', index: '03', label: 'The Cast' },
  { id: '#architecture-tunnel', index: '04', label: '3D Pipeline' },
  { id: '#roadmap', index: '05', label: 'Stage & Roadmap' },
];

export function Header({ onOpenDownload }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [isDarkSurface, setIsDarkSurface] = useState(true);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    const syncHeaderTone = () => {
      const heroEl = document.getElementById('hero');
      const tunnelEl = document.getElementById('architecture-tunnel');
      const heroDark = heroEl ? heroEl.getBoundingClientRect().bottom > 90 : window.scrollY < window.innerHeight * 0.85;
      const tunnelDark = tunnelEl
        ? tunnelEl.getBoundingClientRect().top < 90 && tunnelEl.getBoundingClientRect().bottom > 90
        : false;
      setIsDarkSurface(heroDark || tunnelDark);
    };
    syncHeaderTone();
    window.addEventListener('scroll', syncHeaderTone, { passive: true });
    window.addEventListener('resize', syncHeaderTone);
    return () => {
      window.removeEventListener('scroll', syncHeaderTone);
      window.removeEventListener('resize', syncHeaderTone);
    };
  }, []);

  // Ethereal Hikari ambient track with smooth fade and real-time frequency analysis
  const toggleSound = async () => {
    if (soundOn) {
      if (audioRef.current && gainRef.current && audioCtxRef.current) {
        const now = audioCtxRef.current.currentTime;
        gainRef.current.gain.cancelScheduledValues(now);
        gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, now);
        gainRef.current.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
        setTimeout(() => {
          audioRef.current?.pause();
        }, 320);
      }
      setSoundOn(false);
      return;
    }

    try {
      if (!audioRef.current) {
        const audio = new Audio('/media/hikari-ambient.mp3');
        audio.loop = true;
        audio.crossOrigin = 'anonymous';
        audioRef.current = audio;
      }

      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) {
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;

        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(gain);
        gain.connect(ctx.destination);

        audioCtxRef.current = ctx;
        gainRef.current = gain;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }

      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }

      await audioRef.current.play();

      if (gainRef.current && audioCtxRef.current) {
        const now = audioCtxRef.current.currentTime;
        gainRef.current.gain.cancelScheduledValues(now);
        gainRef.current.gain.setValueAtTime(gainRef.current.gain.value, now);
        gainRef.current.gain.exponentialRampToValueAtTime(0.75, now + 0.5);
      }
      setSoundOn(true);
    } catch {
      setSoundOn(false);
    }
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // Lusion circular waveform canvas responsive to actual music dynamics
  useEffect(() => {
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const renderWave = (now: number) => {
      raf = requestAnimationFrame(renderWave);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = isDarkSurface ? '#f4f3fa' : '#09080f';

      let audioAmp = 0;
      const data = dataArrayRef.current;
      if (soundOn && analyserRef.current && data) {
        analyserRef.current.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        audioAmp = (sum / data.length / 255) * 8.0;
      }
      const amp = soundOn ? Math.max(3.2, audioAmp) : 0;
      const t = now * 0.006;

      for (let x = 6; x <= w - 6; x += 2) {
        const norm = (x - 6) / (w - 12);
        const envelope = Math.sin(norm * Math.PI);
        const y = h / 2 + Math.sin(norm * 10 + t) * amp * envelope;
        if (x === 6) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(renderWave);
    return () => cancelAnimationFrame(raf);
  }, [soundOn, isDarkSurface]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const navigate = (target: string) => {
    setMenuOpen(false);
    scrollToSection(target);
  };

  return (
    <>
      <header className={`site-header ${isDarkSurface ? 'is-dark-surface' : ''}`}>
        <a
          href="#hero"
          className="brand-mark"
          onClick={(e) => {
            e.preventDefault();
            navigate('#hero');
          }}
        >
          <img src="/media/hikari-app-icon.png" alt="Hikari icon" />
          <span className="brand-wordmark">
            <span className="brand-kanji">光</span>HIKARI
          </span>
        </a>

        <div className="header-controls">
          <button
            type="button"
            className="sound-btn"
            onClick={toggleSound}
            aria-label={soundOn ? 'Mute ambient audio' : 'Play ambient audio'}
            aria-pressed={soundOn}
            title={soundOn ? 'Ambient tone on (click to mute)' : 'Ambient tone muted (click to enable)'}
          >
            <canvas ref={waveCanvasRef} width={48} height={48} />
          </button>

          <button type="button" className="pill-cta" onClick={onOpenDownload}>
            <ArrowRight className="pill-arrow" aria-hidden="true" />
            <span className="pill-label">
              <span className="hide-xs">Download · </span>Coming Soon
            </span>
            <span className="pill-dot" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="menu-btn"
            aria-expanded={menuOpen}
            aria-controls="site-nav-drawer"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span className="menu-label-stack" aria-hidden="true">
              <span>MENU</span>
              <span>CLOSE</span>
            </span>
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
            <span className="menu-dots" aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </div>
      </header>

      <nav
        id="site-nav-drawer"
        className={`nav-drawer ${menuOpen ? 'is-open' : ''}`}
        aria-label="Primary navigation"
        aria-hidden={!menuOpen}
      >
        <div className="nav-drawer-grid">
          <ul className="nav-links">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="nav-link-btn"
                  onClick={() => navigate(item.id)}
                  tabIndex={menuOpen ? 0 : -1}
                >
                  <span className="nav-link-idx">{item.index}</span>
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="nav-drawer-card">
            <h3>macOS App · Coming Soon</h3>
            <p>
              Native Apple Silicon desktop companion built with Tauri v2, PixiJS, and Iki/Live2D rigs.
              The desktop body runs today; voice core and signed <code>.dmg</code> installer are underway.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              <button
                type="button"
                className="pill-cta"
                style={{ background: '#ff7eb6', color: '#09080f' }}
                tabIndex={menuOpen ? 0 : -1}
                onClick={() => {
                  setMenuOpen(false);
                  onOpenDownload();
                }}
              >
                <ArrowRight className="pill-arrow" aria-hidden="true" />
                <span className="pill-label">Preview Release Status</span>
                <span className="pill-dot" style={{ background: '#09080f' }} aria-hidden="true" />
              </button>

              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="glass-chip"
                tabIndex={menuOpen ? 0 : -1}
              >
                <span>GitHub Repo</span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <div className="nav-drawer-meta">
          <span>MACOS 13+ APPLE SILICON · NON-ACTIVATING NSPANEL</span>
          <span>LOCAL FIRST · MIT OPEN SOURCE</span>
        </div>
      </nav>
    </>
  );
}
