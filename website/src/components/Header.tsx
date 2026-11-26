import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Github, Menu, Volume2, VolumeX, X } from 'lucide-react';
import { GITHUB_REPO_URL } from '../data/hikariData';

const links = [
  ['#showreel', 'The App'],
  ['#cast', 'The Cast'],
  ['#architecture-tunnel', 'Technology'],
  ['#roadmap', 'Roadmap'],
];

export function Header({ onOpenDownload }: { onOpenDownload: () => void }) {
  const [menuOpen, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);

  function toggleSound() {
    const audio = player.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    audio.volume = .52;
    void audio.play().catch(() => setPlaying(false));
  }

  return (
    <header className="site-header hikari-header">
      <a className="hikari-wordmark" href="#hero" onClick={() => setMenu(false)} aria-label="Hikari home">
        <img src="/media/hikari-mark.png" alt="" width="44" height="44" />
        <span>Hikari</span>
      </a>
      <nav id="hikari-navigation" className="hikari-nav" data-open={menuOpen} aria-label="Main navigation">
        {links.map(([href, name]) => <a key={href} href={href} onClick={() => setMenu(false)}>{name}</a>)}
        <button className="hikari-nav-release" type="button" onClick={() => { setMenu(false); onOpenDownload(); }}>
          macOS release <ArrowUpRight size={15} aria-hidden="true" />
        </button>
      </nav>
      <div className="hikari-header-actions">
        <audio ref={player} src="/media/hikari-ambient.mp3" loop preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        <button className="hikari-icon-button" type="button" onClick={toggleSound}
          aria-label="Ambient sound" aria-pressed={playing} title={playing ? 'Mute sound' : 'Play ambient sound'}>
          {playing ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
        </button>
        <a className="hikari-icon-button hikari-github" href={GITHUB_REPO_URL} target="_blank"
          rel="noreferrer" aria-label="Hikari on GitHub"><Github size={18} aria-hidden="true" /></a>
        <button className="hikari-release" type="button" onClick={onOpenDownload}>
          macOS release <ArrowUpRight size={15} aria-hidden="true" />
        </button>
        <button className="hikari-icon-button hikari-menu" type="button" ref={menuButton}
          aria-controls="hikari-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenu(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
    </header>
  );
}
