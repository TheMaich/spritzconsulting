/* Lenis smooth scrolling, shared by every page that loads it (list in DESIGN.md).
   Load after the vendor script, both deferred:
     <script src="/assets/vendor/lenis-1.3.26.min.js" defer></script>
     <script src="/assets/js/smooth-scroll.js" defer></script>
   The page's CSS owns html{ scroll-padding-top: var(--header-h) }. */
(() => {
  const root = document.documentElement;
  const header = document.getElementById('site-header');

  // --header-h mirrors the header's real height (breakpoints, .is-scrolled);
  // scroll-padding-top reads it, and native jumps and Lenis both honour that
  if (header) {
    const syncHeaderH = () => root.style.setProperty('--header-h', header.offsetHeight + 'px');
    syncHeaderH();
    if ('ResizeObserver' in window) new ResizeObserver(syncHeaderH).observe(header);
  }

  // Off for reduced motion, native on touch, ?lenis=off is a permanent kill switch
  if (!window.Lenis) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (new URLSearchParams(location.search).get('lenis') === 'off') return;

  const LENIS_CONFIG = {
    duration: 1.2,
    easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    wheelMultiplier: 1,
    smoothWheel: true,
    autoRaf: true,
    anchors: true
  };
  // The mobile menu locks scroll by flipping data-open; follow the attribute
  // so no page's setMenu needs to know about Lenis
  const menu = document.getElementById('mobile-menu');
  const syncMenu = () => (menu.dataset.open === 'true' ? lenis.stop() : lenis.start());
  // A menu link closes the menu and scrolls in the same click. The observer's
  // callback can land after Lenis' anchor handler, so also sync on window click,
  // registered before Lenis so it runs ahead of that handler.
  if (menu) addEventListener('click', syncMenu);

  const lenis = window.__lenis = new Lenis(LENIS_CONFIG);

  if (menu) {
    new MutationObserver(syncMenu).observe(menu, { attributes: true, attributeFilter: ['data-open'] });
    syncMenu();
  }
})();
