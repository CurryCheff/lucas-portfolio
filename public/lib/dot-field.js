/* ============================================
   DOT FIELD
   Canvas dot grid that bulges away from the cursor,
   with an SVG glow that brightens on fast movement.
   Ported from the React Bits <DotField /> component to
   a vanilla global, matching the GSAP/Lenis pattern.
   ============================================ */

(function () {
  const TWO_PI = Math.PI * 2;

  /**
   * @param {HTMLElement} container  Positioned element the field fills.
   * @param {Object} [options]
   * @returns {{ destroy: () => void }}
   */
  window.initDotField = function initDotField(container, options) {
    const opts = Object.assign(
      {
        dotRadius: 1.5,
        dotSpacing: 14,
        cursorRadius: 500,
        cursorForce: 0.1,
        bulgeOnly: true,
        bulgeStrength: 67,
        glowRadius: 160,
        sparkle: false,
        waveAmplitude: 0,
        gradientFrom: 'rgba(255, 255, 255, 0.35)',
        gradientTo: 'rgba(255, 255, 255, 0.12)',
        glowColor: 'rgba(255, 255, 255, 0.5)',
        pointerTarget: null,
      },
      options || {}
    );

    if (!container) return { destroy: () => {} };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { destroy: () => {} };
    }

    const glowId = 'dot-field-glow-' + Math.random().toString(36).slice(2, 9);

    const canvas = document.createElement('canvas');
    canvas.className = 'dot-field__canvas';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'dot-field__svg');
    const defs = document.createElementNS(svgNS, 'defs');
    const gradient = document.createElementNS(svgNS, 'radialGradient');
    gradient.setAttribute('id', glowId);
    const stop0 = document.createElementNS(svgNS, 'stop');
    stop0.setAttribute('offset', '0%');
    stop0.setAttribute('stop-color', opts.glowColor);
    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '100%');
    stop1.setAttribute('stop-color', 'transparent');
    gradient.appendChild(stop0);
    gradient.appendChild(stop1);
    defs.appendChild(gradient);
    const glowCircle = document.createElementNS(svgNS, 'circle');
    glowCircle.setAttribute('cx', '-9999');
    glowCircle.setAttribute('cy', '-9999');
    glowCircle.setAttribute('r', String(opts.glowRadius));
    glowCircle.setAttribute('fill', 'url(#' + glowId + ')');
    glowCircle.style.opacity = '0';
    svg.appendChild(defs);
    svg.appendChild(glowCircle);

    container.appendChild(canvas);
    container.appendChild(svg);

    const ctx = canvas.getContext('2d', { alpha: true });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const target = opts.pointerTarget || container;

    let dots = [];
    let w = 0;
    let h = 0;
    let resizeTimer = 0;
    let raf = 0;

    const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
    let glowOpacity = 0;
    let engagement = 0;
    let frameCount = 0;

    const buildDots = (width, height) => {
      const step = opts.dotRadius + opts.dotSpacing;
      const cols = Math.floor(width / step);
      const rows = Math.floor(height / step);
      const padX = (width % step) / 2;
      const padY = (height % step) / 2;
      const next = new Array(rows * cols);
      let idx = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const ax = padX + col * step + step / 2;
          const ay = padY + row * step + step / 2;
          next[idx++] = { ax: ax, ay: ay, sx: ax, sy: ay, vx: 0, vy: 0, x: ax, y: ay };
        }
      }
      dots = next;
    };

    const doResize = () => {
      const rect = container.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDots(w, h);
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(doResize, 100);
    };

    // Pointer position is measured against the container's own box, not the
    // page, since this runs inside a normal-flow footer rather than a fixed
    // full-viewport layer.
    const onPointerMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };

    const onPointerLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    const speedInterval = setInterval(() => {
      const dx = mouse.prevX - mouse.x;
      const dy = mouse.prevY - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      mouse.speed += (dist - mouse.speed) * 0.5;
      if (mouse.speed < 0.001) mouse.speed = 0;
      mouse.prevX = mouse.x;
      mouse.prevY = mouse.y;
    }, 20);

    const tick = () => {
      frameCount++;
      const len = dots.length;
      const t = frameCount * 0.02;

      const targetEngagement = Math.min(mouse.speed / 5, 1);
      engagement += (targetEngagement - engagement) * 0.06;
      if (engagement < 0.001) engagement = 0;

      glowOpacity += (engagement - glowOpacity) * 0.08;

      glowCircle.setAttribute('cx', String(mouse.x));
      glowCircle.setAttribute('cy', String(mouse.y));
      glowCircle.style.opacity = String(glowOpacity);

      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, opts.gradientFrom);
      grad.addColorStop(1, opts.gradientTo);
      ctx.fillStyle = grad;

      const cr = opts.cursorRadius;
      const crSq = cr * cr;
      const rad = opts.dotRadius / 2;
      const isBulge = opts.bulgeOnly;

      ctx.beginPath();

      for (let i = 0; i < len; i++) {
        const d = dots[i];
        const dx = mouse.x - d.ax;
        const dy = mouse.y - d.ay;
        const distSq = dx * dx + dy * dy;

        if (distSq < crSq && engagement > 0.01) {
          const dist = Math.sqrt(distSq);
          if (isBulge) {
            const tt = 1 - dist / cr;
            const push = tt * tt * opts.bulgeStrength * engagement;
            const angle = Math.atan2(dy, dx);
            d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15;
            d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15;
          } else {
            const angle = Math.atan2(dy, dx);
            const move = (500 / dist) * (mouse.speed * opts.cursorForce);
            d.vx += Math.cos(angle) * -move;
            d.vy += Math.sin(angle) * -move;
          }
        } else if (isBulge) {
          d.sx += (d.ax - d.sx) * 0.1;
          d.sy += (d.ay - d.sy) * 0.1;
        }

        if (!isBulge) {
          d.vx *= 0.9;
          d.vy *= 0.9;
          d.x = d.ax + d.vx;
          d.y = d.ay + d.vy;
          d.sx += (d.x - d.sx) * 0.1;
          d.sy += (d.y - d.sy) * 0.1;
        }

        let drawX = d.sx;
        let drawY = d.sy;
        if (opts.waveAmplitude > 0) {
          drawY += Math.sin(d.ax * 0.03 + t) * opts.waveAmplitude;
          drawX += Math.cos(d.ay * 0.03 + t * 0.7) * opts.waveAmplitude * 0.5;
        }

        if (opts.sparkle) {
          const hash = ((i * 2654435761) ^ (frameCount >> 3)) >>> 0;
          if (hash % 100 < 3) {
            ctx.moveTo(drawX + rad * 1.8, drawY);
            ctx.arc(drawX, drawY, rad * 1.8, 0, TWO_PI);
          } else {
            ctx.moveTo(drawX + rad, drawY);
            ctx.arc(drawX, drawY, rad, 0, TWO_PI);
          }
        } else {
          ctx.moveTo(drawX + rad, drawY);
          ctx.arc(drawX, drawY, rad, 0, TWO_PI);
        }
      }

      ctx.fill();
      raf = requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(container);
    doResize();
    raf = requestAnimationFrame(tick);

    target.addEventListener('pointermove', onPointerMove, { passive: true });
    target.addEventListener('pointerleave', onPointerLeave, { passive: true });

    return {
      destroy: () => {
        cancelAnimationFrame(raf);
        clearInterval(speedInterval);
        clearTimeout(resizeTimer);
        ro.disconnect();
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerleave', onPointerLeave);
        canvas.remove();
        svg.remove();
      },
    };
  };
})();
