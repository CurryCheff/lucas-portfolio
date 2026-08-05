/* ============================================
   Lucas Musungo // portfolio
   GSAP Animations & Micro-interactions
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  gsap.registerPlugin(ScrollTrigger);
  gsap.config({ force3D: true });

  // =============================================
  // LENIS SMOOTH SCROLL
  // =============================================
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
    wheelMultiplier: 1,
    touchMultiplier: 2,
    infinite: false,
  });

  // Sync Lenis with GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  // =============================================
  // CUSTOM CURSOR
  // =============================================
  const cursor = document.getElementById('cursor');
  const follower = document.getElementById('cursorFollower');

  if (window.innerWidth > 768) {
    document.addEventListener('mousemove', (e) => {
      gsap.set(cursor, { x: e.clientX, y: e.clientY });
      gsap.to(follower, {
        x: e.clientX,
        y: e.clientY,
        duration: 0.4,
        ease: 'power2.out',
      });
    });

    const hoverTargets = document.querySelectorAll(
      'a, button, .bento__card, .btn, .nav__link, .cta__email, .about__tag'
    );
    hoverTargets.forEach((el) => {
      el.addEventListener('mouseenter', () => document.body.classList.add('cursor--active'));
      el.addEventListener('mouseleave', () => document.body.classList.remove('cursor--active'));
    });
  }

  // =============================================
  // CLICK SPARK
  // =============================================
  initClickSpark({
    sparkColor: '#ffffff',
    sparkSize: 10,
    sparkRadius: 18,
    sparkCount: 8,
    duration: 400,
  });

  // =============================================
  // NAV SCROLL
  // =============================================
  const nav = document.getElementById('nav');
  ScrollTrigger.create({
    start: 'top -72',
    onUpdate: (self) => {
      nav.classList.toggle('nav--scrolled', self.progress > 0);
    },
  });

  // =============================================
  // GOOEY NAV
  // =============================================
  const gooeyNavEl = document.getElementById('gooeyNav');
  if (gooeyNavEl) {
    const gooeyNav = initGooeyNav(gooeyNavEl, {
      particleCount: 14,
      particleDistances: [80, 10],
      particleR: 100,
      animationTime: 560,
      timeVariance: 280,
      initialActiveIndex: -1,
    });

    // Keep the indicator in sync with the section under the viewport
    // midpoint. The hero has no nav item, so it resolves to -1 (none active).
    const navSections = Array.prototype.map.call(
      gooeyNavEl.querySelectorAll('a[href^="#"]'),
      (link) => document.querySelector(link.getAttribute('href'))
    );

    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: () => {
        const mid = window.innerHeight / 2;
        let index = -1;
        navSections.forEach((section, i) => {
          if (!section) return;
          const rect = section.getBoundingClientRect();
          if (rect.top <= mid && rect.bottom > mid) index = i;
        });
        gooeyNav.setActive(index);
      },
    });
  }

  // =============================================
  // MOBILE TOGGLE
  // =============================================
  const navToggle = document.getElementById('navToggle');
  const mobileOverlay = document.getElementById('mobileOverlay');

  navToggle.addEventListener('click', () => {
    mobileOverlay.classList.toggle('mobile-overlay--open');
  });

  mobileOverlay.querySelectorAll('.mobile-link').forEach((link) => {
    link.addEventListener('click', () => {
      mobileOverlay.classList.remove('mobile-overlay--open');
    });
  });

  // =============================================
  // HERO
  // =============================================

  // Cursor-reactive grid. Listeners bind to the section rather than the
  // canvas wrapper so the effect keeps tracking over the headline and buttons.
  const cursorGrid = document.getElementById('cursorGrid');
  if (cursorGrid) {
    initCursorGrid(cursorGrid, {
      pointerTarget: document.getElementById('hero'),
      cellSize: 64,
      color: '#ffffff',
      radius: 170,
      falloff: 'smooth',
      holdTime: 300,
      fadeDuration: 900,
      lineWidth: 1,
      maxOpacity: 0.42,
      fillOpacity: 0.05,
      gridOpacity: 0,
      clickPulse: true,
      pulseSpeed: 620,
    });
  }

  // Hero badge
  gsap.from('.hero__content .tech-tag', {
    y: 20,
    opacity: 0,
    duration: 0.7,
    ease: 'power3.out',
    delay: 0.15,
  });

  // Hero title reveal
  const heroLines = document.querySelectorAll('.hero__line span');
  heroLines.forEach((line, i) => {
    gsap.fromTo(line, {
      y: '110%',
      rotateX: 30,
    }, {
      y: 0,
      rotateX: 0,
      duration: 1.1,
      ease: 'power4.out',
      delay: 0.3 + i * 0.18,
    });
  });

  // Hero description
  gsap.from('.hero__desc', {
    y: 24,
    opacity: 0,
    duration: 0.7,
    ease: 'power3.out',
    delay: 0.85,
  });

  // Hero actions
  gsap.from('.hero__actions', {
    y: 24,
    opacity: 0,
    duration: 0.7,
    ease: 'power3.out',
    delay: 1,
  });

  // Hero scroll indicator
  gsap.from('.hero__scroll', {
    opacity: 0,
    duration: 0.5,
    ease: 'power2.out',
    delay: 1.3,
  });

  // =============================================
  // FADE-UP ELEMENTS (scroll triggered)
  // =============================================
  document.querySelectorAll('[data-anim="fade-up"]').forEach((el) => {
    gsap.fromTo(el, {
      y: 40,
      opacity: 0,
    }, {
      y: 0,
      opacity: 1,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        toggleActions: 'play none none none',
      },
    });
  });

  // =============================================
  // TEXT REVEAL (scroll triggered)
  // =============================================
  document.querySelectorAll('[data-anim="reveal"]').forEach((el) => {
    const children = el.querySelectorAll('span');
    children.forEach((child) => {
      gsap.fromTo(child, {
        y: '100%',
        rotateX: 15,
      }, {
        y: 0,
        rotateX: 0,
        duration: 1,
        ease: 'power4.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 82%',
          toggleActions: 'play none none none',
        },
      });
    });
  });

  // =============================================
  // BENTO CARDS STAGGER
  // =============================================
  document.querySelectorAll('[data-anim="project"]').forEach((card, i) => {
    gsap.fromTo(card, {
      y: 60,
      opacity: 0,
    }, {
      y: 0,
      opacity: 1,
      duration: 0.8,
      ease: 'power3.out',
      delay: i * 0.12,
      scrollTrigger: {
        trigger: card,
        start: 'top 88%',
        toggleActions: 'play none none none',
      },
    });
  });

  // =============================================
  // ABOUT TERMINAL — TYPING SEQUENCE
  // =============================================
  // Lines are already revealed via CSS keyframes.
  // Add a subtle parallax to the terminal on scroll.
  const terminal = document.querySelector('.about__terminal');
  if (terminal) {
    gsap.to(terminal, {
      y: '6%',
      ease: 'none',
      scrollTrigger: {
        trigger: '.about__inner',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1.5,
      },
    });
  }

  // =============================================
  // CTA
  // =============================================
  const ctaBg = document.getElementById('ctaBg');
  gsap.to(ctaBg, {
    scale: 1.08,
    ease: 'none',
    scrollTrigger: {
      trigger: '#contact',
      start: 'top bottom',
      end: 'bottom top',
      scrub: 1.5,
    },
  });

  gsap.from('.cta__email', {
    y: 30,
    opacity: 0,
    duration: 0.8,
    ease: 'power3.out',
    scrollTrigger: {
      trigger: '#contact',
      start: 'top 78%',
      toggleActions: 'play none none none',
    },
  });

  // =============================================
  // DOT FIELD (footer background)
  // =============================================
  const dotFieldEl = document.getElementById('dotField');
  if (dotFieldEl) {
    initDotField(dotFieldEl, {
      pointerTarget: document.getElementById('footer'),
      dotRadius: 1.5,
      dotSpacing: 16,
      cursorRadius: 220,
      bulgeStrength: 46,
      glowRadius: 140,
      gradientFrom: 'rgba(255, 255, 255, 0.32)',
      gradientTo: 'rgba(255, 255, 255, 0.1)',
      glowColor: 'rgba(255, 255, 255, 0.45)',
    });
  }

  // =============================================
  // FOOTER STAGGER
  // =============================================
  document.querySelectorAll('.footer__col').forEach((col, i) => {
    gsap.fromTo(col, {
      y: 20,
      opacity: 0,
    }, {
      y: 0,
      opacity: 1,
      duration: 0.5,
      ease: 'power3.out',
      delay: i * 0.08,
      scrollTrigger: {
        trigger: '#footer',
        start: 'top 88%',
        toggleActions: 'play none none none',
      },
    });
  });

  // =============================================
  // SMOOTH ANCHOR SCROLL (via Lenis)
  // =============================================
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (href === '#') return;
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) {
        lenis.scrollTo(target, {
          offset: -80,
          duration: 1.2,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        });
      }
    });
  });

  // =============================================
  // NAV ENTRANCE
  // =============================================
  gsap.from('.nav', {
    y: -16,
    opacity: 0,
    duration: 0.5,
    ease: 'power3.out',
    delay: 0.05,
  });

  // =============================================
  // REFRESH
  // =============================================
  ScrollTrigger.refresh();

  console.log('// Lucas Musungo — initialized');
});
