import { ArrowUp, ArrowUpRight, Github } from 'lucide-react';
import { GITHUB_RELEASES_URL, GITHUB_REPO_URL } from '../data/hikariData';
import { ScrollHeading } from './ScrollHeading';

const projectLinks = [
  ['Source on GitHub', GITHUB_REPO_URL],
  ['Release archive', GITHUB_RELEASES_URL],
  ['Asset licenses', GITHUB_REPO_URL + '/blob/main/docs/LICENSES.md'],
];

export function EndAndFooterSection({ onOpenDownload }: { onOpenDownload: () => void }) {
  return (
    <footer className="hikari-footer">
      <section className="footer-cta" aria-labelledby="hikari-closing">
        <div className="footer-cta-copy">
          <div className="footer-platform reveal-rise" data-reveal>
            <span aria-hidden="true" /> Built for Apple Silicon
          </div>
          <ScrollHeading id="hikari-closing" first="Hikari, for Mac." />
          <p className="reveal-rise" data-reveal>The signed installer is in development. The desktop stage is available to build from source.</p>
          <div className="bloom-actions reveal-rise" data-reveal>
            <button className="bloom-primary" type="button" onClick={onOpenDownload}>
              Release status <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <a className="bloom-secondary" href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              <Github size={16} aria-hidden="true" /> View the source
            </a>
          </div>
        </div>
      </section>
      <div className="footer-nav">
        <div className="footer-identity">
          <a className="hikari-wordmark" href="#hero" aria-label="Hikari home">
            <img src="/media/hikari-mark.png" alt="" width="43" height="43" loading="lazy" />
            <span>Hikari</span>
          </a>
          <p>A local-first anime companion for your Mac.</p>
        </div>
        <nav aria-label="Product links">
          <h2>Product</h2>
          <a href="#showreel">The App</a>
          <a href="#cast">The Cast</a>
          <a href="#architecture-tunnel">Technology</a>
          <a href="#roadmap">Roadmap</a>
        </nav>
        <nav aria-label="Project links">
          <h2>Project</h2>
          {projectLinks.map(([label, href]) => (
            <a href={href} key={href} target="_blank" rel="noreferrer">
              {label} <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          ))}
        </nav>
        <a className="footer-return" href="#hero"><ArrowUp size={18} aria-hidden="true" /> <span>Back to blossom</span></a>
      </div>
      <div className="footer-meta"><span>macOS 13+ · Apple Silicon</span><span>Code licensed under MIT</span></div>
    </footer>
  );
}
