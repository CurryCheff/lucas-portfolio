/* ============================================
   CLICK SPARK
   Radiating spark lines on click, site-wide. Ported
   from the React Bits <ClickSpark /> component to a
   vanilla global, matching the GSAP/Lenis pattern.
   ============================================ */

(function () {
  const EASINGS = {
    linear: (t) => t,
    'ease-in': (t) => t * t,
    'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    'ease-out': (t) => t * (2 - t),
  };

  /**
   * Attaches a document-wide click listener and draws sparks on a single
   * fixed full-viewport canvas. Unlike the React version (which wraps one
   * container and binds its own onClick), this covers the whole page, so
   * clicks are caught at the document level and filtered by `exclude`.
   *
   * @param {Object} [options]
   * @param {string} [options.exclude]  Selector for click targets that
   *        should NOT spark (buttons, CTAs — anything with its own strong
   *        click feedback already).
   * @returns {{ destroy: () => void }}
   */
  window.initClickSpark = function initClickSpark(options) {
    const opts = Object.assign(
      {
        sparkColor: '#ffffff',
        sparkSize: 10,
        sparkRadius: 15,
        sparkCount: 8,
        duration: 400,
        easing: 'ease-out',
        extraScale: 1,
        exclude: 'button, .btn, .cta__email',
      },
      options || {}
    );

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { destroy: () => {} };
    }

    const ease = EASINGS[opts.easing] || EASINGS['ease-out'];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement('canvas');
    canvas.className = 'click-spark__canvas';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    let sparks = [];
    let raf = 0;
    let resizeTimer = 0;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 100);
    };

    const draw = (timestamp) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      sparks = sparks.filter((spark) => {
        const elapsed = timestamp - spark.startTime;
        if (elapsed >= opts.duration) return false;

        const progress = elapsed / opts.duration;
        const eased = ease(progress);
        const distance = eased * opts.sparkRadius * opts.extraScale;
        const lineLength = opts.sparkSize * (1 - eased);

        const x1 = spark.x + distance * Math.cos(spark.angle);
        const y1 = spark.y + distance * Math.sin(spark.angle);
        const x2 = spark.x + (distance + lineLength) * Math.cos(spark.angle);
        const y2 = spark.y + (distance + lineLength) * Math.sin(spark.angle);

        ctx.strokeStyle = opts.sparkColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        return true;
      });

      raf = requestAnimationFrame(draw);
    };

    const onClick = (e) => {
      if (e.button !== 0) return;
      if (opts.exclude && e.target.closest(opts.exclude)) return;

      const now = performance.now();
      for (let i = 0; i < opts.sparkCount; i++) {
        sparks.push({
          x: e.clientX,
          y: e.clientY,
          angle: (2 * Math.PI * i) / opts.sparkCount,
          startTime: now,
        });
      }
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', onResize);
    document.addEventListener('click', onClick);

    return {
      destroy: () => {
        cancelAnimationFrame(raf);
        clearTimeout(resizeTimer);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('click', onClick);
        canvas.remove();
      },
    };
  };
})();
