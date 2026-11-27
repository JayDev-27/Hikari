import { useEffect } from 'react';
import type { WebGLRenderer } from 'three';
import type { FluidPass } from '../webgl/FluidPass';

export function PointerWater() {
  useEffect(() => {
    const layer = document.createElement('canvas');
    layer.className = 'pointer-water';
    layer.setAttribute('aria-hidden', 'true');
    const topLayer = typeof layer.showPopover === 'function';
    if (topLayer) layer.popover = 'manual';
    layer.hidden = true;
    document.body.append(layer);

    // Draw the same fluid trail over the page without displacing the HTML underneath it.
    const trailSize = 64;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let renderer: WebGLRenderer | undefined;
    let fluid: FluidPass | undefined;
    let disposed = false;
    let loading = false;
    let frame = 0;
    let last = -Infinity;
    let dialog: Element | null = null;
    let x = 0, y = 0;

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = -Infinity;
      fluid?.resetPointer();
      if (topLayer && layer.matches(':popover-open')) layer.hidePopover();
      layer.hidden = true;
    }
    function resize() {
      const scale = Math.min(1, 800 / Math.max(innerWidth, innerHeight));
      renderer?.setPixelRatio(scale);
      renderer?.setSize(innerWidth, innerHeight, false);
      fluid?.resize(innerWidth, innerHeight, scale);
    }
    function draw(now: number) {
      if (!renderer || !fluid || now - last > 2050 || document.hidden || motion.matches) {
        stop();
        return;
      }
      fluid.render(renderer, null, now / 1000);
      frame = requestAnimationFrame(draw);
    }
    function start() {
      if (frame || !fluid || performance.now() - last > 2050) return;
      layer.hidden = false;
      if (topLayer && !layer.matches(':popover-open')) layer.showPopover();
      fluid.pushPointer(x, y);
      frame = requestAnimationFrame(draw);
    }
    async function load() {
      loading = true;
      try {
        const { createFluidOverlay } = await import('../webgl/FluidPass');
        if (disposed) return;
        ({ renderer, fluid } = createFluidOverlay(layer, trailSize));
        resize();
        start();
      } catch { stop(); }
    }
    function move(event: PointerEvent) {
      if (motion.matches || event.pointerType === 'touch') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The hero's own scene draws the wake (with refraction) there, so the overlay steps aside.
      if (target.closest('#top') && document.querySelector('.sky-canvas.is-ready')) {
        if (frame || last !== -Infinity) stop();
        return;
      }
      const current = document.querySelector('dialog[open]');
      if (current !== dialog) {
        stop();
        if (!topLayer) (current ?? document.body).append(layer);
        dialog = current;
      }
      last = performance.now();
      x = event.clientX / innerWidth;
      y = 1 - event.clientY / innerHeight;
      fluid?.pushPointer(x, y);
      if (fluid) start();
      else if (!loading) void load();
    }
    window.addEventListener('pointermove', move, { capture: true, passive: true });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', stop);
    motion.addEventListener('change', stop);
    return () => {
      disposed = true;
      stop();
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', stop);
      motion.removeEventListener('change', stop);
      fluid?.dispose();
      renderer?.dispose();
      layer.remove();
    };
  }, []);
  return null;
}
