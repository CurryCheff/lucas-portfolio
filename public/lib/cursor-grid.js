/* ============================================
   CURSOR GRID
   Canvas lattice that lights up around the pointer.
   Ported from the React Bits <CursorGrid /> component
   to a vanilla global, matching the GSAP/Lenis pattern.
   ============================================ */

(function () {
  const FALLOFF_CURVES = {
    linear: (t) => t,
    smooth: (t) => t * t * (3 - 2 * t),
    sharp: (t) => t * t * t,
  };

  const hexToRgb = (hex) => {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const num = parseInt(v.slice(0, 6), 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };

  /**
   * @param {HTMLElement} container  Element the canvas fills and is measured against.
   * @param {Object} [options]       See defaults below.
   * @param {HTMLElement} [options.pointerTarget]
   *        Element the pointer listeners bind to. Defaults to `container`, but
   *        should be an ancestor when content sits above the canvas — otherwise
   *        moving over that content stops firing pointermove.
   * @returns {{ destroy: () => void }}
   */
  window.initCursorGrid = function initCursorGrid(container, options) {
    const opts = Object.assign(
      {
        cellSize: 70,
        color: '#ffffff',
        radius: 140,
        falloff: 'smooth',
        holdTime: 400,
        fadeDuration: 800,
        lineWidth: 1.2,
        maxOpacity: 1,
        fillOpacity: 0,
        gridOpacity: 0,
        cellRadius: 0,
        clickPulse: true,
        pulseSpeed: 600,
        pointerTarget: null,
      },
      options || {}
    );

    if (!container) return { destroy: () => {} };

    // Honour reduced-motion: skip the rAF loop entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { destroy: () => {} };
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'cursor-grid__canvas';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = opts.pointerTarget || container;

    // Grid state: one alpha + timestamp pair per cell, indexed row-major.
    let cols = 0;
    let rows = 0;
    let offX = 0;
    let offY = 0;
    let alphas = new Float32Array(0);
    let touched = new Float64Array(0);
    let w = 0;
    let h = 0;
    const pulses = [];
    let raf = 0;
    let running = false;
    let lastFrame = 0;

    const rebuild = () => {
      w = container.offsetWidth;
      h = container.offsetHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / opts.cellSize) + 1;
      rows = Math.ceil(h / opts.cellSize) + 1;
      // Center the lattice so edge cells crop evenly on both sides
      offX = (w - cols * opts.cellSize) / 2;
      offY = (h - rows * opts.cellSize) / 2;
      alphas = new Float32Array(cols * rows);
      touched = new Float64Array(cols * rows);
    };

    const cellCenterX = (i) => offX + (i % cols) * opts.cellSize + opts.cellSize / 2;
    const cellCenterY = (i) => offY + Math.floor(i / cols) * opts.cellSize + opts.cellSize / 2;

    // Light up every cell whose center falls inside the radius, with the
    // configured falloff curve mapping distance to brightness.
    const energize = (x, y, boost) => {
      const r = Math.max(opts.radius, 1);
      const ease = FALLOFF_CURVES[opts.falloff] || FALLOFF_CURVES.linear;
      const now = performance.now();
      const minCol = Math.max(0, Math.floor((x - r - offX) / opts.cellSize));
      const maxCol = Math.min(cols - 1, Math.floor((x + r - offX) / opts.cellSize));
      const minRow = Math.max(0, Math.floor((y - r - offY) / opts.cellSize));
      const maxRow = Math.min(rows - 1, Math.floor((y + r - offY) / opts.cellSize));
      for (let cRow = minRow; cRow <= maxRow; cRow++) {
        for (let cCol = minCol; cCol <= maxCol; cCol++) {
          const i = cRow * cols + cCol;
          const dist = Math.hypot(cellCenterX(i) - x, cellCenterY(i) - y);
          if (dist > r) continue;
          const level = ease(1 - dist / r) * opts.maxOpacity * (boost || 1);
          if (level > alphas[i]) {
            alphas[i] = level;
            touched[i] = now;
          } else if (level > 0) {
            touched[i] = now;
          }
        }
      }
    };

    const draw = (now) => {
      const dt = Math.min(now - lastFrame, 50);
      lastFrame = now;
      ctx.clearRect(0, 0, w, h);
      const rgb = hexToRgb(opts.color);
      const cr = rgb[0];
      const cg = rgb[1];
      const cb = rgb[2];

      // Optional faint static lattice
      if (opts.gridOpacity > 0) {
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + opts.gridOpacity + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let cCol = 0; cCol <= cols; cCol++) {
          const x = Math.round(offX + cCol * opts.cellSize) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (let cRow = 0; cRow <= rows; cRow++) {
          const y = Math.round(offY + cRow * opts.cellSize) + 0.5;
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }

      // Expanding click pulses hand their energy to cells as they pass
      for (let pi = pulses.length - 1; pi >= 0; pi--) {
        const pulse = pulses[pi];
        const age = (now - pulse.t0) / 1000;
        const ringR = age * opts.pulseSpeed;
        if (ringR > Math.hypot(w, h)) {
          pulses.splice(pi, 1);
          continue;
        }
        const band = opts.cellSize;
        const minCol = Math.max(0, Math.floor((pulse.x - ringR - band - offX) / opts.cellSize));
        const maxCol = Math.min(cols - 1, Math.floor((pulse.x + ringR + band - offX) / opts.cellSize));
        const minRow = Math.max(0, Math.floor((pulse.y - ringR - band - offY) / opts.cellSize));
        const maxRow = Math.min(rows - 1, Math.floor((pulse.y + ringR + band - offY) / opts.cellSize));
        for (let cRow = minRow; cRow <= maxRow; cRow++) {
          for (let cCol = minCol; cCol <= maxCol; cCol++) {
            const i = cRow * cols + cCol;
            const dist = Math.hypot(cellCenterX(i) - pulse.x, cellCenterY(i) - pulse.y);
            if (Math.abs(dist - ringR) < band / 2 && opts.maxOpacity > alphas[i]) {
              alphas[i] = opts.maxOpacity;
              touched[i] = now;
            }
          }
        }
      }

      let anyVisible = pulses.length > 0;
      const fadeStep = dt / Math.max(opts.fadeDuration, 16);
      const half = opts.cellSize / 2;

      for (let i = 0; i < alphas.length; i++) {
        let a = alphas[i];
        if (a <= 0) continue;
        if (now - touched[i] > opts.holdTime) {
          a = Math.max(0, a - fadeStep);
          alphas[i] = a;
          if (a <= 0) continue;
        }
        anyVisible = true;

        const cx = cellCenterX(i);
        const cy = cellCenterY(i);
        const gradient = ctx.createRadialGradient(cx, cy, half * 0.1, cx, cy, opts.cellSize);
        gradient.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a + ')');
        gradient.addColorStop(1, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)');

        const x = cx - half + 0.5;
        const y = cy - half + 0.5;
        const s = opts.cellSize - 1;

        ctx.beginPath();
        if (opts.cellRadius > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, s, s, opts.cellRadius);
        } else {
          ctx.rect(x, y, s, s);
        }
        if (opts.fillOpacity > 0) {
          ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a * opts.fillOpacity + ')';
          ctx.fill();
        }
        ctx.strokeStyle = gradient;
        ctx.lineWidth = opts.lineWidth;
        ctx.stroke();
      }

      if (anyVisible) {
        raf = requestAnimationFrame(draw);
      } else {
        running = false;
        if (opts.gridOpacity <= 0) ctx.clearRect(0, 0, w, h);
      }
    };

    const wake = () => {
      if (running) return;
      running = true;
      lastFrame = performance.now();
      raf = requestAnimationFrame(draw);
    };

    const toLocal = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };

    const onPointerMove = (e) => {
      const p = toLocal(e);
      energize(p[0], p[1]);
      wake();
    };

    const onPointerDown = (e) => {
      if (!opts.clickPulse) return;
      const p = toLocal(e);
      pulses.push({ x: p[0], y: p[1], t0: performance.now() });
      wake();
    };

    const ro = new ResizeObserver(() => {
      rebuild();
      wake();
    });
    ro.observe(container);
    rebuild();
    wake();

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerdown', onPointerDown);

    return {
      destroy: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerdown', onPointerDown);
        canvas.remove();
      },
    };
  };
})();
