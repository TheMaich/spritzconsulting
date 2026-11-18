/* Steam Analysis sample gallery: the loop on phones.
   Works with assets/css/steam-sample-gallery.css and the #sample section of /steam-analysis/. The slides are for looking at only. */
(function () {
  var gal = document.querySelector('.sa-gallery');
  if (!gal) return;
  var reel = gal.querySelector('.sa-reel');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* A second copy of the strip makes the loop. It is hidden from screen readers, and it is made only when the gallery is
     about to come into view, so the images below the fold stay unloaded until then. Skipped with reduced motion. */
  function loop() {
    if (reduce.matches || gal.classList.contains('is-marquee')) return;
    var copy = reel.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    reel.parentNode.appendChild(copy);
    gal.classList.add('is-marquee');
  }
  if ('IntersectionObserver' in window) {
    var near = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { near.disconnect(); loop(); }
    }, { rootMargin: '300px 0px' });
    near.observe(gal);
  } else {
    loop();
  }
})();
