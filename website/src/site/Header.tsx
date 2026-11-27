import { useEffect, useRef, useState } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { GITHUB_REPO_URL, NAV } from '../data/hikariData';
import { magnetic, scrollToTarget } from './motion';

/** Minimal bar: hides while you read down the page, returns when you scroll up, frosts once past the hero. */
export function Header({ onGet }: { onGet: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const cta = useRef<HTMLButtonElement>(null);

  useEffect(() => magnetic(cta.current), []);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setSolid(y > window.innerHeight * 0.6);
      if (y <= 160) setHidden(false);
      else if (Math.abs(y - last) > 6) setHidden(y > last);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', open);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const go = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    scrollToTarget(href);
  };

  return (
    <header className={`hd${hidden && !open ? ' is-hidden' : ''}${solid || open ? ' is-solid' : ''}`}>
      <a className="hd-brand" href="#top" onClick={go('#top')} aria-label="Hikari, back to top">
        <img src="/media/hikari-mark.png" alt="" width={28} height={28} />
        <span>Hikari</span>
      </a>
      <nav className="hd-nav" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} onClick={go(n.href)}>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="hd-actions">
        <a className="hd-icon" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" aria-label="Hikari on GitHub">
          <Github size={18} strokeWidth={1.8} />
        </a>
        <button ref={cta} type="button" className="btn btn-light btn-small" onClick={onGet}>
          Get Hikari
        </button>
        <button type="button" className="hd-menu" aria-expanded={open} aria-controls="site-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      <div id="site-menu" className={`hd-sheet${open ? ' is-open' : ''}`} hidden={!open}>
        {NAV.map((n, i) => (
          <a key={n.href} href={n.href} onClick={go(n.href)} style={{ transitionDelay: `${0.04 * i + 0.08}s` }}>
            {n.label}
          </a>
        ))}
      </div>
    </header>
  );
}
