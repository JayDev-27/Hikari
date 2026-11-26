import { AudioLines, Boxes, Layers, LockKeyhole } from 'lucide-react';
import { ScrollHeading } from './ScrollHeading';

const features = [
  { name: 'A native desktop stage', text: 'Hikari lives in a transparent macOS panel. Empty pixels let clicks pass through, and the stage floats above your workspace.', icon: Layers },
  { name: 'Motion in sync', text: 'One audio clock schedules phonemes, gestures, and speech. The stage supports Hindi, English, and Hinglish lip sync.', icon: AudioLines },
  { name: 'Make it your own', text: 'Switch between the included Iki rigs or import your own Iki and Live2D characters in Character Studio.', icon: Boxes },
  { name: 'Designed to run locally', text: 'The desktop stage runs on your Mac. The voice core and additional model options are on the development roadmap.', icon: LockKeyhole },
];

export function TunnelSection() {
  return (
    <section id="architecture-tunnel" className="architecture-section">
      <div className="architecture-heading">
        <p className="bloom-kicker"><i aria-hidden="true" /> How it works</p>
        <ScrollHeading first="Small on your screen." second="Alive in the details." />
      </div>
      <div className="architecture-grid">
        {features.map(({ name, text, icon: Icon }) => (
          <article key={name} className="reveal-rise" data-reveal>
            <Icon size={23} strokeWidth={1.55} aria-hidden="true" />
            <h3>{name}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
