/* ============================================
   MASKED HEADING
   Ported from React Bits' MaskedHeading (React + GSAP)
   to vanilla JS, matching the window.initX() pattern
   used by the other components in public/lib/.

   Given a heading element already in the DOM, replaces
   its content with a word-by-word SVG clip-path mask so
   an image/video shows through the letterforms, with
   idle drift + pointer parallax and a GSAP entrance.
   ============================================ */

(function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  let uid = 0;

  window.initMaskedHeading = function initMaskedHeading(root, options) {
    if (!root) return { destroy: () => {} };

    const opts = Object.assign(
      {
        text: root.textContent.trim(),
        mediaType: 'image',
        src: '',
        poster: '',
        fillScale: 1.25,
        parallax: 26,
        drift: 18,
        brightness: 1,
        saturation: 1,
        grayscale: false,
        reveal: 'rise',
        duration: 1.1,
        stagger: 0.09,
        trigger: 'view',
        align: 'center',
        weight: 700,
        tracking: -0.03,
        lineHeight: 1.06,
        textScale: 0.115,
      },
      options || {}
    );

    // Decorative/motion-heavy component: bail out entirely on reduced
    // motion and leave the plain heading text already in the markup,
    // matching this project's convention for the other canvas/GSAP
    // components (cursor-grid, dot-field, click-spark).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { destroy: () => {} };
    }

    if (!opts.src) return { destroy: () => {} };

    const words = String(opts.text).split(/\s+/).filter(Boolean);
    if (!words.length) return { destroy: () => {} };

    const clipId = `mh-${Date.now().toString(36)}-${uid++}`;

    root.classList.add('masked-heading');
    root.style.textAlign = opts.align;
    root.style.fontWeight = String(opts.weight);
    root.style.letterSpacing = `${opts.tracking}em`;
    root.style.lineHeight = String(opts.lineHeight);
    root.innerHTML = '';

    const svgNS = 'http://www.w3.org/2000/svg';
    const wordEls = [];
    const baseEls = [];
    const glyphEls = [];

    const measure = document.createElement('span');
    measure.className = 'masked-heading__measure';
    words.forEach((word) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'masked-heading__word';
      wordSpan.appendChild(document.createTextNode(word));
      const baseline = document.createElement('i');
      baseline.className = 'masked-heading__baseline';
      wordSpan.appendChild(baseline);
      measure.appendChild(wordSpan);
      wordEls.push(wordSpan);
      baseEls.push(baseline);
    });
    root.appendChild(measure);

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'masked-heading__defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const defs = document.createElementNS(svgNS, 'defs');
    const clipPath = document.createElementNS(svgNS, 'clipPath');
    clipPath.setAttribute('id', clipId);
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    words.forEach((word) => {
      const textEl = document.createElementNS(svgNS, 'text');
      textEl.textContent = word;
      clipPath.appendChild(textEl);
      glyphEls.push(textEl);
    });
    defs.appendChild(clipPath);
    svg.appendChild(defs);
    root.appendChild(svg);

    const revealEl = document.createElement('span');
    revealEl.className = 'masked-heading__reveal';
    const clipEl = document.createElement('span');
    clipEl.className = 'masked-heading__clip';
    clipEl.style.clipPath = `url(#${clipId})`;
    const mediaEl = document.createElement('span');
    mediaEl.className = 'masked-heading__media';

    let sourceEl;
    if (opts.mediaType === 'video') {
      sourceEl = document.createElement('video');
      sourceEl.autoplay = true;
      sourceEl.muted = true;
      sourceEl.loop = true;
      sourceEl.playsInline = true;
      if (opts.poster) sourceEl.poster = opts.poster;
    } else {
      sourceEl = document.createElement('img');
      sourceEl.alt = '';
      sourceEl.draggable = false;
    }
    sourceEl.className = 'masked-heading__source';
    sourceEl.src = opts.src;

    mediaEl.appendChild(sourceEl);
    clipEl.appendChild(mediaEl);
    revealEl.appendChild(clipEl);
    root.appendChild(revealEl);

    const offset = { x: 0, y: 0, tx: 0, ty: 0 };

    const place = () => {
      const W = root.clientWidth;
      const H = root.clientHeight;
      const maxX = Math.max(0, ((opts.fillScale - 1) / 2) * W);
      const maxY = Math.max(0, ((opts.fillScale - 1) / 2) * H);
      mediaEl.style.transform =
        `translate3d(${clamp(offset.x, -maxX, maxX).toFixed(2)}px, ${clamp(offset.y, -maxY, maxY).toFixed(2)}px, 0) scale(${opts.fillScale})`;
      mediaEl.style.filter =
        `brightness(${opts.brightness}) saturate(${opts.saturation})${opts.grayscale ? ' grayscale(1)' : ''}`;
    };

    const sync = () => {
      root.style.fontSize = `${clamp(root.clientWidth * opts.textScale, 20, 200).toFixed(1)}px`;
      const cs = window.getComputedStyle(measure);
      for (let i = 0; i < wordEls.length; i++) {
        const box = wordEls[i];
        const base = baseEls[i];
        const glyph = glyphEls[i];
        glyph.setAttribute('x', String(box.offsetLeft));
        glyph.setAttribute('y', String(base.offsetTop));
        glyph.style.fontFamily = cs.fontFamily;
        glyph.style.fontSize = cs.fontSize;
        glyph.style.fontWeight = cs.fontWeight;
        glyph.style.fontStyle = cs.fontStyle;
        glyph.style.letterSpacing = cs.letterSpacing;
      }
      place();
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(root);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(sync).catch(() => {});
    }

    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      clock += dt;

      const dx = Math.sin(clock * 0.21) * opts.drift;
      const dy = Math.cos(clock * 0.17) * opts.drift * 0.6;

      const ease = 1 - Math.exp(-dt / 0.18);
      offset.x += (offset.tx + dx - offset.x) * ease;
      offset.y += (offset.ty + dy - offset.y) * ease;

      place();
      raf = requestAnimationFrame(frame);
    };

    const onMove = (e) => {
      if (opts.parallax <= 0) return;
      const r = root.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / (r.width || 1)) * 2 - 1;
      const ny = ((e.clientY - r.top) / (r.height || 1)) * 2 - 1;
      offset.tx = clamp(nx, -1, 1) * -opts.parallax;
      offset.ty = clamp(ny, -1, 1) * -opts.parallax;
    };

    const onLeave = () => {
      offset.tx = 0;
      offset.ty = 0;
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);

    // --- Entrance reveal ---
    let tween = null;
    let io = null;
    const riseDistance = () => (parseFloat(window.getComputedStyle(root).fontSize) || 48) * 1.15;

    const settle = () => {
      gsap.set(glyphEls, { y: 0 });
      gsap.set(revealEl, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
    };

    const rest = () => {
      if (opts.reveal === 'rise') {
        gsap.set(glyphEls, { y: riseDistance() });
      } else if (opts.reveal === 'wipe') {
        gsap.set(revealEl, { clipPath: 'inset(0% 100% 0% 0%)' });
      } else if (opts.reveal === 'fade') {
        gsap.set(revealEl, { opacity: 0, scale: 1.08 });
      }
    };

    const play = () => {
      if (tween) tween.kill();
      if (opts.reveal === 'rise') {
        gsap.set(revealEl, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)' });
        tween = gsap.fromTo(
          glyphEls,
          { y: riseDistance() },
          { y: 0, duration: opts.duration, stagger: opts.stagger, ease: 'power4.out', overwrite: 'auto' }
        );
      } else if (opts.reveal === 'wipe') {
        gsap.set(glyphEls, { y: 0 });
        const state = { p: 100 };
        tween = gsap.to(state, {
          p: 0,
          duration: opts.duration,
          ease: 'power3.inOut',
          overwrite: 'auto',
          onUpdate: () => {
            revealEl.style.clipPath = `inset(0% ${state.p}% 0% 0%)`;
          },
        });
      } else {
        gsap.set(glyphEls, { y: 0 });
        tween = gsap.fromTo(
          revealEl,
          { opacity: 0, scale: 1.08 },
          { opacity: 1, scale: 1, duration: opts.duration, ease: 'power3.out', overwrite: 'auto' }
        );
      }
    };

    let onHoverEnter = null;

    if (opts.reveal === 'none') {
      settle();
    } else if (opts.trigger === 'hover') {
      settle();
      onHoverEnter = play;
      root.addEventListener('pointerenter', onHoverEnter);
    } else if (opts.trigger === 'view') {
      settle();
      rest();
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            play();
            io.disconnect();
          }
        },
        { threshold: 0.25 }
      );
      io.observe(root);
    } else {
      play();
    }

    return {
      destroy: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        if (io) io.disconnect();
        if (tween) tween.kill();
        root.removeEventListener('pointermove', onMove);
        root.removeEventListener('pointerleave', onLeave);
        if (onHoverEnter) root.removeEventListener('pointerenter', onHoverEnter);
      },
    };
  };
})();
