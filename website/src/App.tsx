import { useCallback, useRef, useState } from 'react';
import { CastSection } from './components/CastSection';
import { DownloadModal } from './components/DownloadModal';
import { EndAndFooterSection } from './components/EndAndFooterSection';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { ShowreelSection } from './components/ShowreelSection';
import { StagePreviewAndRoadmap } from './components/StagePreviewAndRoadmap';
import { TunnelSection } from './components/TunnelSection';
import { useScrollReveals } from './hooks/useScrollReveals';

export default function App() {
  const content = useRef<HTMLElement>(null);
  useScrollReveals(content);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const openRelease = useCallback(() => setDownloadOpen(true), []);
  const closeRelease = useCallback(() => setDownloadOpen(false), []);

  return (
    <>
      <a className="skip-link" href="#showreel">Skip to the app preview</a>
      <Header onOpenDownload={openRelease} />
      <main id="main" ref={content} className="app-content">
        <HeroSection onOpenDownload={openRelease}>
          <ShowreelSection />
          <CastSection />
          <TunnelSection />
          <StagePreviewAndRoadmap />
          <EndAndFooterSection onOpenDownload={openRelease} />
        </HeroSection>
      </main>
      <DownloadModal open={downloadOpen} onClose={closeRelease} />
    </>
  );
}
