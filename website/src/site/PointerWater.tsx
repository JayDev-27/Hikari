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

    // A browser backdrop filter displaces live HTML using the velocity field from the hero shader.
    const svgNS = 'http://www.w3.org/2000/svg';
    const filters = document.createElementNS(svgNS, 'svg');
    filters.setAttribute('width', '0');
    filters.setAttribute('height', '0');
    filters.style.position = 'absolute';
    filters.innerHTML = '<filter id="hikari-fluid-displacement" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feImage preserveAspectRatio="none" width="100%" height="100%" result="flow"/><feDisplacementMap in="SourceGraphic" in2="flow" xChannelSelector="R" yChannelSelector="G"/></filter>';
    document.body.append(filters);
    const fieldImage = filters.querySelector('feImage')!;
    const displacement = filters.querySelector('feDisplacementMap')!;
    const map = document.createElement('canvas');
    const size = 64;
    map.width = map.height = size;
    const context = map.getContext('2d')!;
    const pixels = context.createImageData(size, size);
    const field = new Uint8Array(pixels.data.length);
    let reading = false;
    let lastMap = -Infinity;
    async function updateMap(now: number) {
      if (!fluid || !renderer || reading || now - lastMap < 48) return;
      reading = true;
      lastMap = now;
      try {
        await fluid.readDisplacement(renderer, field);
        if (disposed || layer.hidden) return;
        for (let row = 0; row < size; row++) {
          for (let col = 0; col < size; col++) {
            const src = ((size - row - 1) * size + col) * 4;
            const dst = (row * size + col) * 4;
            const energy = field[src + 2] / 255;
            pixels.data[dst] = 128 + (field[src] - 128) * energy * Math.min(1, innerWidth / innerHeight);
            pixels.data[dst + 1] = 128 - (field[src + 1] - 128) * energy * Math.min(1, innerHeight / innerWidth);
            pixels.data[dst + 3] = 255;
          }
        }
        context.putImageData(pixels, 0, 0);
        fieldImage.setAttribute('href', map.toDataURL());
        layer.style.backdropFilter = 'url(#hikari-fluid-displacement)';
      } catch { /* The shader trail still renders if readback is unavailable. */ }
      finally { reading = false; }
    }

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
      displacement.setAttribute('scale', String(.044 * Math.max(innerWidth, innerHeight)));
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
      void updateMap(now);
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
        ({ renderer, fluid } = createFluidOverlay(layer, size));
        resize();
        start();
      } catch { stop(); }
    }
    function move(event: PointerEvent) {
      if (motion.matches || event.pointerType === 'touch') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('#top') && document.querySelector('.hero-bloom.live')) {
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
      filters.remove();
      layer.remove();
    };
  }, []);
  return null;
}
