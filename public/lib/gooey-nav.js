/* ============================================
   GOOEY NAV
   Metaball pill indicator with particle burst on
   selection. Ported from the React Bits <GooeyNav />
   component to a vanilla global, matching the
   GSAP/Lenis pattern used elsewhere.
   ============================================ */

(function () {
  /**
   * Enhances an existing `<ul><li><a>` nav with the gooey indicator.
   * The markup stays in the HTML so links still work without JS.
   *
   * @param {HTMLElement} container  Wrapper holding the `<ul>`.
   * @param {Object} [options]
   * @param {number} [options.initialActiveIndex=-1]
   *        -1 means "nothing active" — this site opens on the hero,
   *        which has no corresponding nav item.
   * @returns {{ setActive: (i: number) => void, destroy: () => void }}
   */
  window.initGooeyNav = function initGooeyNav(container, options) {
    const opts = Object.assign(
      {
        animationTime: 600,
        particleCount: 15,
        particleDistances: [90, 10],
        particleR: 100,
        timeVariance: 300,
        colors: [1, 2, 3, 1, 2, 3, 1, 4],
        initialActiveIndex: -1,
      },
      options || {}
    );

    if (!container) return { setActive: () => {}, destroy: () => {} };

    const list = container.querySelector('ul');
    const items = list ? Array.prototype.slice.call(list.querySelectorAll('li')) : [];
    if (!items.length) return { setActive: () => {}, destroy: () => {} };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const filterEl = document.createElement('span');
    filterEl.className = 'gooey-nav__effect gooey-nav__effect--filter';
    const textEl = document.createElement('span');
    textEl.className = 'gooey-nav__effect gooey-nav__effect--text';
    container.appendChild(filterEl);
    container.appendChild(textEl);

    let activeIndex = opts.initialActiveIndex;

    const noise = (n) => n / 2 - Math.random() * n;

    const getXY = (distance, pointIndex, totalPoints) => {
      const angle = ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
      return [distance * Math.cos(angle), distance * Math.sin(angle)];
    };

    const createParticle = (i, t, d, r) => {
      const rotate = noise(r / 10);
      return {
        start: getXY(d[0], opts.particleCount - i, opts.particleCount),
        end: getXY(d[1] + noise(7), opts.particleCount - i, opts.particleCount),
        time: t,
        scale: 1 + noise(0.2),
        color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
        rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
      };
    };

    const timers = [];

    const makeParticles = (element) => {
      if (reduceMotion) {
        element.classList.add('is-active');
        return;
      }
      const d = opts.particleDistances;
      const r = opts.particleR;
      const bubbleTime = opts.animationTime * 2 + opts.timeVariance;
      element.style.setProperty('--time', bubbleTime + 'ms');

      // Restart the pill animation with a forced reflow rather than rAF —
      // rAF doesn't fire while the tab isn't compositing, which would leave
      // the central blob invisible even though the particles still spawn.
      element.classList.remove('is-active');
      void element.offsetWidth;
      element.classList.add('is-active');

      for (let i = 0; i < opts.particleCount; i++) {
        const t = opts.animationTime * 2 + noise(opts.timeVariance * 2);
        const p = createParticle(i, t, d, r);

        const spawn = setTimeout(() => {
          const particle = document.createElement('span');
          const point = document.createElement('span');
          particle.className = 'gooey-nav__particle';
          particle.style.setProperty('--start-x', p.start[0] + 'px');
          particle.style.setProperty('--start-y', p.start[1] + 'px');
          particle.style.setProperty('--end-x', p.end[0] + 'px');
          particle.style.setProperty('--end-y', p.end[1] + 'px');
          particle.style.setProperty('--time', p.time + 'ms');
          particle.style.setProperty('--scale', String(p.scale));
          particle.style.setProperty('--color', 'var(--gooey-color-' + p.color + ', #ffffff)');
          particle.style.setProperty('--rotate', p.rotate + 'deg');

          point.className = 'gooey-nav__point';
          particle.appendChild(point);
          element.appendChild(particle);

          const cleanup = setTimeout(() => {
            if (particle.parentNode === element) element.removeChild(particle);
          }, t);
          timers.push(cleanup);
        }, 30);
        timers.push(spawn);
      }
    };

    const updateEffectPosition = (element) => {
      const containerRect = container.getBoundingClientRect();
      // Nav collapses to a hamburger on small screens; skip while hidden.
      if (!containerRect.width || !containerRect.height) return;
      const pos = element.getBoundingClientRect();
      const styles = {
        left: pos.x - containerRect.x + 'px',
        top: pos.y - containerRect.y + 'px',
        width: pos.width + 'px',
        height: pos.height + 'px',
      };
      Object.assign(filterEl.style, styles);
      Object.assign(textEl.style, styles);
      textEl.innerText = element.innerText;
    };

    const clearParticles = () => {
      const particles = filterEl.querySelectorAll('.gooey-nav__particle');
      Array.prototype.forEach.call(particles, (p) => {
        if (p.parentNode === filterEl) filterEl.removeChild(p);
      });
    };

    // Applies active state. `animate` is false for scroll-driven updates
    // that should track position without firing the particle burst.
    const setActive = (index, animate) => {
      items.forEach((li, i) => li.classList.toggle('is-active', i === index));

      if (index < 0 || !items[index]) {
        activeIndex = -1;
        filterEl.style.opacity = '0';
        textEl.style.opacity = '0';
        textEl.classList.remove('is-active');
        clearParticles();
        return;
      }

      const previous = activeIndex;
      activeIndex = index;
      filterEl.style.opacity = '';
      textEl.style.opacity = '';

      updateEffectPosition(items[index]);

      if (animate === false || previous === index) {
        textEl.classList.add('is-active');
        return;
      }

      clearParticles();
      textEl.classList.remove('is-active');
      void textEl.offsetWidth; // force reflow so the animation restarts
      textEl.classList.add('is-active');
      makeParticles(filterEl);
    };

    // A click starts a smooth scroll, during which the scroll sync would
    // otherwise report "between sections" and wipe the burst mid-flight.
    // Hold the clicked item until the scroll settles.
    let lockUntil = 0;

    const onClick = (e) => {
      const li = e.currentTarget;
      const index = items.indexOf(li);
      if (index === -1) return;
      lockUntil = performance.now() + opts.animationTime * 2 + opts.timeVariance + 400;
      if (index === activeIndex) return;
      setActive(index, true);
    };

    items.forEach((li) => li.addEventListener('click', onClick));

    const ro = new ResizeObserver(() => {
      if (activeIndex >= 0 && items[activeIndex]) updateEffectPosition(items[activeIndex]);
    });
    ro.observe(container);

    const onResize = () => {
      if (activeIndex >= 0 && items[activeIndex]) updateEffectPosition(items[activeIndex]);
    };
    window.addEventListener('resize', onResize);

    setActive(activeIndex, false);

    return {
      // Scroll-driven updates reposition the pill without a particle burst;
      // only clicks are worth the full effect. Ignored while a click-initiated
      // scroll is still in flight.
      setActive: (i) => {
        if (performance.now() < lockUntil) return;
        setActive(i, false);
      },
      destroy: () => {
        timers.forEach(clearTimeout);
        ro.disconnect();
        window.removeEventListener('resize', onResize);
        items.forEach((li) => li.removeEventListener('click', onClick));
        filterEl.remove();
        textEl.remove();
      },
    };
  };
})();
