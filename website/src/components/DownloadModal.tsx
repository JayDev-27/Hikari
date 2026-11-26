import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { GITHUB_RELEASES_URL, GITHUB_REPO_URL } from '../data/hikariData';

interface DownloadModalProps {
  open: boolean;
  onClose: () => void;
}

const DEV_CLONE_CMD = 'git clone https://github.com/JayDev-27/Hikari.git && cd Hikari && pnpm install && pnpm dev';

export function DownloadModal({ open, onClose }: DownloadModalProps) {
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const copyTimer = useRef<number>(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(DEV_CLONE_CMD);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="modal-backdrop"
      aria-labelledby="download-modal-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, paddingRight: 28 }}>
          <img
            src="/media/hikari-mark.png"
            alt="Hikari app icon"
            style={{ width: 52, height: 52, borderRadius: 13 }}
          />
          <div>
            <span className="status-badge status-badge--wip" style={{ marginBottom: 6 }}>
              Coming Soon · Public .dmg Release
            </span>
            <h2
              id="download-modal-title"
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(1.4rem, 2.5vw, 1.9rem)',
                fontWeight: 500,
              }}
            >
              Hikari for macOS
            </h2>
          </div>
        </div>

        <p style={{ margin: '0 0 14px', color: 'var(--ink-secondary)', fontSize: 15 }}>
          The signed <code>Hikari.app</code> / <code>.dmg</code> installer is planned. The Apple Silicon desktop stage is available to build from source.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 18,
          }}
        >
          <span className="kbd-pill">macOS 13+ Ventura</span>
          <span className="kbd-pill">Apple Silicon (M1–M4)</span>
          <span className="kbd-pill">Planned 8 GB Profile</span>
        </div>

        <span className="mono-tag" style={{ display: 'block' }}>
          EARLY DEVELOPER PREVIEW (BUILD FROM SOURCE TODAY)
        </span>

        <div className="code-box">
          <code>{DEV_CLONE_CMD}</code>
          <button
            type="button"
            onClick={copyCommand}
            aria-label="Copy build command"
            style={{
              flexShrink: 0,
              padding: '6px 10px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.12)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="pill-cta"
          >
            <ExternalLink className="pill-arrow" aria-hidden="true" />
            <span className="pill-label">Watch GitHub Releases</span>
            <span className="pill-dot" aria-hidden="true" />
          </a>

          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="pill-cta pill-cta--light"
          >
            <ExternalLink className="pill-arrow" aria-hidden="true" />
            <span className="pill-label">View README &amp; Roadmap</span>
            <span className="pill-dot" style={{ background: '#1a2ffb' }} aria-hidden="true" />
          </a>
        </div>
      </div>
    </dialog>
  );
}
