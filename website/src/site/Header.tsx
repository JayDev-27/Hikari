import { useEffect, useRef, useState } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { GITHUB_REPO_URL, NAV } from '../data/hikariData';
import { magnetic, scrollToTarget } from './motion';

/**
 * Fixed, transparent micro-type bar. The hero's wordmark flies up and lands as the logo; the current section gets a
 * dashed underline; past the hero the bar frosts over the paper and tucks away while you read downwards.
 */
export function Header({ onGet }: { onGet: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('');
  const cta = useRef<HTMLButtonElement>(null);

  useEffect(() => magnetic(cta.current), []);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const hero = document.getElementById('top');
      const heroEnd = hero ? hero.offsetHeight - window.innerHeight : 0;
      setSolid(y > heroEnd - 40);
      if (y <= heroEnd + 40) setHidden(false);
      else if (Math.abs(y - last) > 6) setHidden(y > last);
      last = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const sections = NAV.map((n) => document.querySelector<HTMLElement>(n.href)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(`#${e.target.id}`)),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
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
        <img src="/media/hikari-mark.png" alt="" width={24} height={24} />
        <span className="hd-brand-word">Hikari</span>
      </a>
      <nav className="hd-nav" aria-label="Sections">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} onClick={go(n.href)} aria-current={active === n.href ? 'true' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
      <div className="hd-actions">
        <a className="hd-icon" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" aria-label="Hikari on GitHub">
          <Github size={17} strokeWidth={1.8} />
        </a>
        <button ref={cta} type="button" className="btn btn-line btn-small" onClick={onGet}>
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
