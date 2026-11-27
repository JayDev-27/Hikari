import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Check, Copy, X } from 'lucide-react';
import { GITHUB_RELEASES_URL, GITHUB_REPO_URL, NAV } from '../data/hikariData';
import { scrollToTarget } from './motion';

export function Footer() {
  const word = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = word.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.classList.add('in-view');
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <footer className="ft sec-dark" aria-labelledby="ft-label">
      <div className="wrap">
        <div className="ft-cols">
          <div className="ft-brand">
            <img src="/media/hikari-app-icon.png" alt="" width={48} height={48} loading="lazy" />
            <p>An open-source anime companion for macOS. Local first, by design.</p>
          </div>
          <nav aria-label="Footer: explore">
            <h3>Explore</h3>
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={(e) => (e.preventDefault(), scrollToTarget(n.href))}>{n.label}</a>
            ))}
          </nav>
          <nav aria-label="Footer: project">
            <h3>Project</h3>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a>
            <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">Releases <ArrowUpRight size={13} /></a>
            <a href={`${GITHUB_REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Contributing <ArrowUpRight size={13} /></a>
            <a href="https://woc.codesocial.tech" target="_blank" rel="noreferrer">Winter of Code Social <ArrowUpRight size={13} /></a>
          </nav>
          <div className="ft-top">
            <button type="button" className="ft-up" onClick={() => scrollToTarget('#top')} aria-label="Back to top">
              <ArrowUp size={18} />
            </button>
          </div>
        </div>
        <p ref={word} id="ft-title" className="ft-word">
          <span id="ft-label" className="sr-only">Hikari</span>
          {Array.from('Hikari', (letter, i) => <span aria-hidden="true" key={i} style={{ animationDelay: `${i * 65}ms` }}>{letter}</span>)}
        </p>
        <div className="ft-legal">
          <span>© 2026 Hikari contributors · MIT licence</span>
          <span>Characters shown belong to their respective rights holders. App screens marked “sample” use sample data.</span>
        </div>
      </div>
    </footer>
  );
}

const CLONE = 'git clone https://github.com/JayDev-27/Hikari.git && cd Hikari && pnpm install && pnpm dev';

export function ReleaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(CLONE);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog ref={dialog} className="rm" aria-labelledby="rm-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rm-card">
        <button type="button" className="rm-x" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <img src="/media/hikari-app-icon.png" alt="" width={72} height={72} />
        <p className="kicker">Coming soon</p>
        <h2 id="rm-title">The signed download is on its way.</h2>
        <p>
          A notarised .dmg for macOS 13 and later on Apple Silicon arrives with the first release. Watch the repository
          to hear about it, or run Hikari from source today.
        </p>
        <div className="rm-code">
          <code>{CLONE}</code>
          <button type="button" onClick={copy} aria-label={copied ? 'Copied' : 'Copy command'}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <span className="sr-only" aria-live="polite">{copied ? 'Command copied' : ''}</span>
        <div className="rm-actions">
          <a className="btn btn-light" href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer">
            Watch releases <ArrowUpRight size={16} />
          </a>
          <a className="btn btn-ghost" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
            View the source
          </a>
        </div>
      </div>
    </dialog>
  );
}
