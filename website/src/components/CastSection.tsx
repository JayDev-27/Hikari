import { useState } from 'react';
import { CAST_CHARACTERS } from '../data/hikariData';
import { ScrollHeading } from './ScrollHeading';

const languages = ['hinglish', 'hindi', 'english'] as const;

export function CastSection() {
  const [active, setActive] = useState(CAST_CHARACTERS[0]);
  const [showArtwork, setShowArtwork] = useState(false);
  const [lang, setLang] = useState<(typeof languages)[number]>('hinglish');

  return (
    <section id="cast" className="cast-section">
      <div className="section-head-split">
        <div>
          <p className="bloom-kicker"><i aria-hidden="true" /> Character Studio</p>
          <ScrollHeading className="section-title-xl" first="Meet the cast." />
        </div>
        <p className="editorial-lead reveal-rise" data-reveal>Every rig has its own persona and signature gestures. Choose a character to see their pose and sample dialogue.</p>
      </div>
      <div className="cast-lens" data-reveal>
        <div className="cast-picks" aria-label="Choose a character">
          {CAST_CHARACTERS.map(character => (
            <button type="button" key={character.id} aria-pressed={character.id === active.id}
              onClick={() => { setActive(character); setShowArtwork(character.id === 'rize'); }}>{character.name}</button>
          ))}
        </div>
        <div className="cast-detail" aria-live="polite" key={active.id}>
          <div className="cast-portrait">
            <img src={showArtwork ? '/media/hikari-rize-reading-art.webp' : active.image}
              alt={showArtwork ? 'Rize reading with the open book supported by both hands at the waist' : active.imageAlt}
              width="720" height="880" loading="lazy" />
          </div>
          <div className="cast-story">
            <p className="mono-tag">{active.renderer} rig</p>
            <h3>{active.name}</h3>
            <p className="cast-motion">{active.signatureMove}</p>
            <p>{active.summary}</p>
            {active.id === 'rize' && (
              <div className="lang-pills cast-image-options" aria-label="Rize reading previews">
                <button type="button" className="lang-pill" aria-pressed={showArtwork} onClick={() => setShowArtwork(true)}>Artwork</button>
                <button type="button" className="lang-pill" aria-pressed={!showArtwork} onClick={() => setShowArtwork(false)}>Iki render</button>
              </div>
            )}
            <div className="lang-pills" aria-label="Language sample selector">
              {languages.map(mode => (
                <button key={mode} type="button" className={`lang-pill${lang === mode ? ' is-active' : ''}`}
                  aria-pressed={lang === mode} onClick={() => setLang(mode)}>{mode}</button>
              ))}
            </div>
            <blockquote className="spotlight-quote">“{active.samples[lang]}”</blockquote>
          </div>
        </div>
      </div>
      <p className="license-strip">The cast uses Hikari fan rigs and original personas. Character designs belong to their respective rights holders. The project includes no franchise voice recordings.</p>
    </section>
  );
}
