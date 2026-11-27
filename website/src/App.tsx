import { useCallback, useEffect, useRef, useState } from 'react';
import { Footer, ReleaseModal } from './site/Footer';
import { Header } from './site/Header';
import { PointerWater } from './site/PointerWater';
import { Hero } from './site/Hero';
import { SakuraCanvas } from './site/SakuraCanvas';
import { Cast, DesktopStage, FinalCta, Inside, OpenSource, Privacy, Roadmap, Statement, Voice } from './site/Sections';
import { ScrollTrigger, useReveals } from './site/motion';

export default function App() {
  const main = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const onGet = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  useReveals(main);
  useEffect(() => {
    // Fonts change line lengths, which moves every trigger: measure again once they have arrived.
    void document.fonts?.ready.then(() => ScrollTrigger.refresh());
    document.documentElement.classList.add('is-loaded');
  }, []);

  return (
    <>
      <a className="skip" href="#about">Skip to content</a>
      <PointerWater />
      <SakuraCanvas />
      <Header onGet={onGet} />
      <main id="main" ref={main}>
        <Hero onGet={onGet} />
        <Statement />
        <DesktopStage />
        <Cast />
        <Voice />
        <Inside />
        <Privacy />
        <OpenSource />
        <Roadmap />
        <FinalCta onGet={onGet} />
      </main>
      <Footer />
      <ReleaseModal open={open} onClose={onClose} />
    </>
  );
}
