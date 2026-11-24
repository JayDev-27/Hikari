import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { CrosshairRow } from './CrosshairRow';
import { useScrambleText } from '../hooks/useScrambleText';

const CLIPS = [
  {
    id: 'signatures',
    label: 'Signature Moves (4 Rigs)',
    src: '/media/signature-motions.mp4',
  },
  {
    id: 'reze',
    label: 'Reze Motion & Physics',
    src: '/media/reze-cubism.mp4',
  },
];

export function ShowreelSection() {
  const [activeClip, setActiveClip] = useState(CLIPS[0]);
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { ref: kickerRef, text: scrambledKicker } = useScrambleText(
    'DESKTOP COMPANION • ARTICULATED RIGS • HINGLISH LIP SYNC'
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      video.pause();
      setIsPlaying(false);
      return;
    }

    if (isPlaying) {
      video.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      video.pause();
    }
  }, [activeClip, isPlaying]);

  // Pause offscreen video cleanly for performance
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting && !video.paused) {
          video.pause();
        } else if (
          entry.isIntersecting &&
          isPlaying &&
          !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          video.play().catch(() => {});
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [isPlaying]);

  return (
    <section id="showreel" className="showreel-section">
      <div className="showreel-intro">
        <span ref={kickerRef} className="mono-tag" style={{ display: 'block', marginBottom: 18 }}>
          {scrambledKicker}
        </span>

        <h2 className="display-giant">
          Presence,
          <br />
          Brought to Life
        </h2>

        <div className="showreel-copy-grid">
          <p className="editorial-lead">
            Hikari pairs a transparent macOS panel with custom 2D Iki and Live2D character rigs.
            Natural breathing, cursor-tracking eyes, and expressive hand choreography run beside an
            audio-synchronized mouth engine built for English, Hindi, and Hinglish.
          </p>

          <div style={{ justifySelf: 'start' }}>
            <span className="mono-tag" style={{ display: 'block', marginBottom: 8 }}>
              RENDERER & STAGE MOTION PREVIEW
            </span>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-muted)' }}>
              Real captures from Hikari&apos;s stage runtime and Iki rig exports—not pre-rendered
              marketing CGI.
            </p>
          </div>
        </div>
      </div>

      <CrosshairRow count={5} />

      <div className={`reel-frame ${isPlaying ? 'is-playing' : ''}`}>
        <video
          ref={videoRef}
          key={activeClip.src}
          className="reel-video"
          src={activeClip.src}
          poster="/media/signatures.png"
          muted
          loop
          playsInline
          preload="metadata"
        />

        <div className="reel-overlay">
          <div className="reel-switcher">
            <span className="glass-chip">{activeClip.label}</span>
            <div className="reel-tabs" role="tablist" aria-label="Showreel clips">
              {CLIPS.map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  role="tab"
                  aria-selected={activeClip.id === clip.id}
                  className={`reel-tab ${activeClip.id === clip.id ? 'is-active' : ''}`}
                  onClick={() => setActiveClip(clip)}
                >
                  {clip.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="reel-center-cta"
            onClick={() => setIsPlaying((p) => !p)}
            aria-label={isPlaying ? 'Pause motion reel' : 'Play motion reel'}
          >
            <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
            <span className="reel-play-pill">
              {isPlaying ? <Pause size={24} /> : <Play size={24} fill="currentColor" />}
            </span>
            <span>REEL</span>
          </button>

          <div className="reel-switcher">
            <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.75)' }}>
              30 FPS IDLE / 60 FPS ACTIVE · PIXI 8 + IKI ENGINE
            </span>
            <button
              type="button"
              className="reel-pause-corner"
              onClick={() => setIsPlaying((p) => !p)}
            >
              {isPlaying ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
              <span>{isPlaying ? 'Pause Loop' : 'Play Loop'}</span>
            </button>
          </div>
        </div>
      </div>

      <CrosshairRow count={5} />
    </section>
  );
}
