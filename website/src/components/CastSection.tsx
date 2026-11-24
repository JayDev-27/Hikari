import { useState } from 'react';
import { CAST_CHARACTERS, type CastCharacter } from '../data/hikariData';
import { useScrambleText } from '../hooks/useScrambleText';

type LangMode = 'hinglish' | 'hindi' | 'english';

function RollingTitle({ title }: { title: string }) {
  return (
    <span className="roll-title" aria-label={title}>
      {title.split('').map((ch, i) => (
        <span key={i} className="roll-char-wrap" aria-hidden="true">
          <span
            className="roll-char-stack"
            style={{ transitionDelay: `${Math.min(i * 18, 220)}ms` }}
          >
            <span>{ch === ' ' ? '\u00A0' : ch}</span>
            <span style={{ color: 'var(--accent-cobalt)' }}>{ch === ' ' ? '\u00A0' : ch}</span>
          </span>
        </span>
      ))}
    </span>
  );
}

function CharacterCard({
  character,
  index,
  selected,
  onSelect,
}: {
  character: CastCharacter;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { ref, text: scrambled } = useScrambleText(character.tags);

  return (
    <button
      type="button"
      className={`cast-card ${index % 2 === 1 ? 'cast-card--offset' : ''} ${
        selected ? 'is-selected' : ''
      }`}
      onClick={onSelect}
    >
      <div className="cast-card-top">
        <span ref={ref} className="mono-tag">
          {scrambled}
        </span>
        <span
          className="glass-chip"
          style={{
            background: 'var(--bg-editorial)',
            color: 'var(--ink-primary)',
            borderColor: 'var(--border-light)',
          }}
        >
          {character.renderer}
        </span>
      </div>

      <div className="cast-card-media">
        <img src={character.image} alt={character.imageAlt} loading="lazy" />
      </div>

      <div>
        <RollingTitle title={character.name} />
        <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-secondary)' }}>
          {character.signatureMove}
        </p>
      </div>
    </button>
  );
}

const VISEME_PATTERNS: Record<LangMode, number[]> = {
  hinglish: [28, 74, 46, 88, 32, 68, 92, 42, 78, 35, 62, 48],
  hindi: [38, 86, 62, 44, 90, 52, 70, 84, 30, 64, 76, 40],
  english: [24, 60, 82, 48, 72, 36, 85, 55, 66, 32, 74, 44],
};

export function CastSection() {
  const [selectedId, setSelectedId] = useState<string>(CAST_CHARACTERS[0].id);
  const [lang, setLang] = useState<LangMode>('hinglish');
  const { ref: sectionTagRef, text: sectionTag } = useScrambleText(
    'FOUR IKI CHARACTERS • LU GUANG • LIVE2D SAMPLE PACKS'
  );

  const active = CAST_CHARACTERS.find((c) => c.id === selectedId) ?? CAST_CHARACTERS[0];

  return (
    <section id="cast" className="cast-section">
      <div className="section-head-split">
        <div>
          <span ref={sectionTagRef} className="mono-tag" style={{ display: 'block', marginBottom: 14 }}>
            {sectionTag}
          </span>
          <h2 className="section-title-xl">The Cast</h2>
        </div>

        <p className="editorial-lead" style={{ fontSize: 'clamp(1rem, 1.35vw, 1.25rem)' }}>
          Each built-in character ships with a bespoke persona, cursor-following eyes, signature cue
          moves, and trilingual speech tuning. You can also import your own Live2D, Iki, or VRM
          pack inside Character Studio.
        </p>
      </div>

      <div className="cast-hero-banner">
        <img
          src="/media/cast.png"
          alt="Makima, Reze, Rize Kamishiro, and Cheng Xiaoshi rendered side by side by Hikari's Iki renderer"
        />
      </div>

      <div className="cast-grid">
        {CAST_CHARACTERS.map((char, idx) => (
          <CharacterCard
            key={char.id}
            character={char}
            index={idx}
            selected={char.id === active.id}
            onSelect={() => setSelectedId(char.id)}
          />
        ))}
      </div>

      {/* Interactive Persona & Trilingual Line Spotlight */}
      <div className="cast-spotlight-panel" aria-live="polite">
        <div>
          <span className="mono-tag" style={{ color: 'var(--accent-sakura)', display: 'block', marginBottom: 12 }}>
            PERSONA VOICE & LIP-SYNC PREVIEW // {active.name.toUpperCase()}
          </span>

          <div className="lang-pills" role="tablist" aria-label="Language sample selector">
            {(['hinglish', 'hindi', 'english'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={lang === mode}
                className={`lang-pill ${lang === mode ? 'is-active' : ''}`}
                onClick={() => setLang(mode)}
              >
                {mode}
              </button>
            ))}
          </div>

          <blockquote className="spotlight-quote">&ldquo;{active.samples[lang]}&rdquo;</blockquote>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--ink-on-dark-muted)' }}>
            {active.summary}
          </p>
          <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {active.licenseNote}
          </span>
        </div>

        <div>
          <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.7)', display: 'block', marginBottom: 10 }}>
            SIMULATED IPA → VISEME ENVELOPE ({lang.toUpperCase()})
          </span>
          <div className="viseme-bars" aria-hidden="true">
            {VISEME_PATTERNS[lang].map((heightPct, i) => (
              <span
                key={i}
                className="viseme-bar"
                style={{
                  height: `${heightPct}%`,
                  opacity: 0.55 + (i % 3) * 0.15,
                }}
              />
            ))}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-on-dark-muted)' }}>
            Also bundled: <strong>Lu Guang</strong> (Iki) plus Live2D Cubism sample compatibility for{' '}
            <strong>Hiyori, Haru, Mao, and Rice</strong>. Say &ldquo;switch to Reze&rdquo; in chat
            to swap live.
          </p>
        </div>
      </div>

      <div className="license-strip">
        <strong>Attribution &amp; Assets Note:</strong> Hikari&apos;s own code is MIT-licensed.
        Makima, Reze, Rize Kamishiro, Cheng Xiaoshi, and Lu Guang are fan rigs with original
        personas; underlying character designs belong to their respective rights holders, and no
        franchise voice recordings are included. Live2D sample models follow the Live2D Free
        Material License.
      </div>
    </section>
  );
}
