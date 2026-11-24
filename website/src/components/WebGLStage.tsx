import { useEffect, useRef } from 'react';
import { HikariStageScene } from '../webgl/HikariStageScene';

interface WebGLStageProps {
  onLoadProgress: (progress: number) => void;
  onReady: () => void;
}

export function WebGLStage({ onLoadProgress, onReady }: WebGLStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let stage: HikariStageScene | null = null;
    try {
      stage = new HikariStageScene(container, {
        onProgress: onLoadProgress,
        onReady,
      });
    } catch {
      // Graceful fallback when WebGL context is disabled or unavailable
      document.getElementById('hero')?.classList.add('hero-section--fallback');
      onLoadProgress(1);
      onReady();
    }

    return () => {
      stage?.dispose();
    };
  }, [onLoadProgress, onReady]);

  return <div ref={containerRef} className="webgl-stage" aria-hidden="true" />;
}
