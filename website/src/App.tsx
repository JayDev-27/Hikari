import { Component, type ReactNode, useCallback, useState } from 'react';
import { CastSection } from './components/CastSection';
import { DownloadModal } from './components/DownloadModal';
import { EndAndFooterSection } from './components/EndAndFooterSection';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { Preloader } from './components/Preloader';
import { ScrollIndicator } from './components/ScrollIndicator';
import { ShowreelSection } from './components/ShowreelSection';
import { StagePreviewAndRoadmap } from './components/StagePreviewAndRoadmap';
import { TunnelSection } from './components/TunnelSection';
import { WebGLStage } from './components/WebGLStage';
import { useSmoothScroll } from './hooks/useSmoothScroll';

class StageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    document.getElementById('hero')?.classList.add('hero-section--fallback');
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function App() {
  const [loadProgress, setLoadProgress] = useState(0);
  const [webglReady, setWebglReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const handleLoadProgress = useCallback((ratio: number) => {
    setLoadProgress(ratio);
  }, []);

  const handleWebglReady = useCallback(() => {
    setWebglReady(true);
  }, []);

  const handlePreloaderFinished = useCallback(() => {
    setIntroDone(true);
  }, []);

  useSmoothScroll(introDone);

  return (
    <>
      <Preloader
        loadProgress={loadProgress}
        webglReady={webglReady}
        onFinished={handlePreloaderFinished}
      />

      <StageErrorBoundary>
        <WebGLStage onLoadProgress={handleLoadProgress} onReady={handleWebglReady} />
      </StageErrorBoundary>

      <Header onOpenDownload={() => setDownloadOpen(true)} />
      <ScrollIndicator />

      <main className="app-content">
        <HeroSection onOpenDownload={() => setDownloadOpen(true)} />
        <ShowreelSection />
        <CastSection />
        <TunnelSection />
        <StagePreviewAndRoadmap />
        <EndAndFooterSection onOpenDownload={() => setDownloadOpen(true)} />
      </main>

      <DownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
    </>
  );
}
