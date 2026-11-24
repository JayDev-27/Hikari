import { useState } from 'react';
import { HOTKEYS, ROADMAP_MILESTONES } from '../data/hikariData';
import { useScrambleText } from '../hooks/useScrambleText';

const STAGE_STATES = {
  ptt: {
    label: '⌥ Space · Speaking (Hinglish)',
    bubble: 'Aaj ka plan? Hmm… pehle chai, phir dekhte hain kya adventure milta hai.',
    meter: 'AudioContext Clock · −1.4 / +6.9 ms A/V Sync',
  },
  muted: {
    label: '⌘ ⇧ M · Mic Muted',
    bubble: 'Mic muted cleanly. Click-through active across every Space.',
    meter: '16 kHz AudioWorklet · Idle 30 FPS throttling',
  },
  panic: {
    label: '⌘ ⇧ Esc · Panic Stop',
    bubble: 'All audio and pending gestures stopped inside 5 ms.',
    meter: 'Render quantum fade · History trimmed to audible turn',
  },
};

export function StagePreviewAndRoadmap() {
  const [simMode, setSimMode] = useState<keyof typeof STAGE_STATES>('ptt');
  const { ref: roadmapTagRef, text: roadmapTag } = useScrambleText(
    'HONEST BUILD STATUS • M0 COMPLETE • CORE & .DMG IN PROGRESS'
  );

  const activeSim = STAGE_STATES[simMode];

  return (
    <section id="roadmap" className="simulator-roadmap-section">
      {/* Interactive Stage Preview Simulator */}
      <div className="stage-sim-shell">
        <div className="sim-grid">
          <div>
            <span className="mono-tag" style={{ display: 'block', marginBottom: 10 }}>
              DESKTOP STAGE CONTROLS
            </span>
            <h2
              className="section-title-xl"
              style={{ fontSize: 'clamp(1.85rem, 3.6vw, 3rem)', marginBottom: 14 }}
            >
              Always on top. Never in your way.
            </h2>
            <p style={{ margin: '0 0 22px', color: 'var(--ink-secondary)', fontSize: 15 }}>
              Hikari lives in your macOS menu bar with zero Dock clutter. Test how her global
              hotkeys drive speech turns, mute state, and instant 5 ms panic interruption:
            </p>

            <div className="mac-dock-keys">
              {HOTKEYS.map((hk, idx) => {
                const mode: keyof typeof STAGE_STATES =
                  idx === 0 ? 'ptt' : idx === 1 ? 'muted' : 'panic';
                return (
                  <button
                    key={hk.keys}
                    type="button"
                    className={`kbd-pill ${simMode === mode ? 'is-active' : ''}`}
                    onClick={() => setSimMode(mode)}
                  >
                    <strong>{hk.keys}</strong>
                    <span style={{ opacity: 0.78 }}>{hk.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mac-desktop-mock">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="glass-chip">
                <span className="glass-chip-dot" aria-hidden="true" />
                <span>{activeSim.label}</span>
              </span>
              <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.58)' }}>
                NSPANEL · 1-PX HIT TEST
              </span>
            </div>

            <div className="mac-speech-bubble" role="status" aria-live="polite">
              {activeSim.bubble}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span className="mono-tag" style={{ color: 'rgba(255,255,255,0.72)' }}>
                {activeSim.meter}
              </span>
              <img
                src="/media/hikari-app-icon.png"
                alt=""
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Honest M0–M8 Roadmap */}
      <div>
        <span ref={roadmapTagRef} className="mono-tag" style={{ display: 'block', marginBottom: 12 }}>
          {roadmapTag}
        </span>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 16,
            marginBottom: 28,
          }}
        >
          <h2 className="section-title-xl">Development Roadmap</h2>
          <p style={{ margin: 0, maxWidth: 460, fontSize: 14, color: 'var(--ink-muted)' }}>
            The desktop body, renderers, lip sync, and Character Studio run today. The Python voice
            brain (<code>core/</code>) and signed macOS <code>.dmg</code> release are actively being built.
          </p>
        </div>

        <div className="roadmap-list">
          {ROADMAP_MILESTONES.map((item) => (
            <div key={item.id} className="roadmap-row">
              <span className="mono-tag" style={{ color: 'var(--ink-primary)', fontWeight: 600 }}>
                {item.id}
              </span>
              <div>
                <strong style={{ display: 'block', fontSize: 17, marginBottom: 4 }}>
                  {item.title}
                </strong>
                <span style={{ fontSize: 14, color: 'var(--ink-secondary)' }}>{item.detail}</span>
              </div>
              <span
                className={`status-badge ${
                  item.status === 'done'
                    ? 'status-badge--done'
                    : item.status === 'in-progress'
                      ? 'status-badge--wip'
                      : 'status-badge--planned'
                }`}
              >
                {item.statusLabel}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
