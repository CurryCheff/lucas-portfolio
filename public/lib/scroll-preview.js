/* ============================================
   SCROLL PREVIEW
   Measures how far each project card's tall screenshot
   needs to translate to reveal the rest of the page on
   hover. The hover motion itself is pure CSS (:hover);
   this only computes --scroll-distance per image, since
   that depends on measured pixel heights CSS can't know.
   ============================================ */

(function () {
  /**
   * @param {string} [selector='.bento__scroll-preview']
   * @returns {{ destroy: () => void }}
   */
  window.initScrollPreviews = function initScrollPreviews(selector) {
    const sel = selector || '.bento__scroll-preview';
    const images = Array.prototype.slice.call(document.querySelectorAll(sel));
    if (!images.length) return { destroy: () => {} };

    // Reduced-motion: leave --scroll-distance unset. The CSS fallback
    // (var(--scroll-distance, 0px)) already means "no motion" on its own,
    // so there's nothing further to do here.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { destroy: () => {} };
    }

    const cleanups = [];

    images.forEach((img) => {
      const container = img.closest('.bento__media');
      if (!container) return;

      const measure = () => {
        const distance = Math.max(0, img.offsetHeight - container.offsetHeight);
        img.style.setProperty('--scroll-distance', distance + 'px');
      };

      if (img.complete) {
        measure();
      } else {
        img.addEventListener('load', measure, { once: true });
        cleanups.push(() => img.removeEventListener('load', measure));
      }

      const ro = new ResizeObserver(measure);
      ro.observe(container);
      cleanups.push(() => ro.disconnect());
    });

    return {
      destroy: () => cleanups.forEach((fn) => fn()),
    };
  };
})();
