import { useState } from 'react';
import { ScrollHeading } from './ScrollHeading';

const previews = [
  {
    id: 'studio', label: 'Character Studio', width: 1440, height: 960,
    alt: 'Current Hikari Character Studio with Reze selected and her signature moves listed',
  },
  {
    id: 'chat', label: 'Chat', width: 840, height: 960,
    alt: 'Current Hikari chat window with a sample transcript in English and Hinglish',
  },
  {
    id: 'settings', label: 'Settings', width: 1425, height: 1050,
    alt: 'Current Hikari About and Settings window with the periwinkle theme',
  },
  {
    id: 'onboarding', label: 'Setup', width: 1425, height: 1050,
    alt: 'Current Hikari setup screen with the welcome steps and Get Started button',
  },
];

export function ShowreelSection() {
  const [active, setActive] = useState(previews[0]);

  return (
    <section id="showreel" className="showreel-section editorial-section">
      <div className="section-head-split">
        <div>
          <p className="bloom-kicker"><i aria-hidden="true" /> The desktop app</p>
          <ScrollHeading className="section-title-xl" first="Inside Hikari." />
        </div>
        <p className="editorial-lead reveal-rise" data-reveal>Meet your cast in Character Studio, carry on a conversation, and set up Hikari for your Mac.</p>
      </div>
      <div className="app-gallery reel-reveal" data-reveal>
        <div className="app-gallery-controls" aria-label="App previews">
          {previews.map((item) => (
            <button type="button" key={item.id} aria-pressed={item.id === active.id}
              onClick={() => setActive(item)}>{item.label}</button>
          ))}
        </div>
        <div className="app-gallery-image" aria-live="polite">
          <img key={active.id} src={`/media/hikari-current-${active.id}.webp`}
            alt={active.alt} width={active.width} height={active.height} loading="lazy" />
        </div>
      </div>
    </section>
  );
}
