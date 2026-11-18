/* Steam Analysis sample gallery: the phone loop and the full size viewer.
   Works with assets/css/steam-sample-gallery.css and the #sample section of /steam-analysis/.
   Without this script the slides are plain links to the full size images. */
(function () {
  var gal = document.querySelector('.sa-gallery');
  var dlg = document.getElementById('sa-lightbox');
  if (!gal) return;
  var reel = gal.querySelector('.sa-reel');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Phone loop: a second copy of the strip, hidden from screen readers and from the tab order. Skipped with reduced motion.
     It is made only when the gallery is about to come into view, so the images below the fold stay unloaded until then. */
  function loop() {
    if (reduce.matches || gal.classList.contains('is-marquee')) return;
    var copy = reel.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.querySelectorAll('a').forEach(function (a) { a.tabIndex = -1; });
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

  if (!dlg || typeof dlg.showModal !== 'function') return;     /* old browsers keep the plain links */
  var links = Array.prototype.slice.call(reel.querySelectorAll('.sa-slide'));
  var N = links.length, cur = 0, last = null;
  var img = dlg.querySelector('.sa-lb-img'), count = dlg.querySelector('.sa-lb-count');

  function show(i) {
    cur = (i + N) % N;
    var a = links[cur];
    img.src = a.getAttribute('href');
    img.alt = a.querySelector('img').alt;
    count.textContent = (cur + 1) + ' / ' + N;
    var next = new Image(); next.src = links[(cur + 1) % N].getAttribute('href');       /* the next slide is ready when asked for */
  }
  function open(i, trigger) {
    last = trigger;
    show(i);
    document.documentElement.classList.add('sa-lb-open');
    dlg.showModal();
  }
  gal.addEventListener('click', function (e) {
    var a = e.target.closest('.sa-slide');
    if (!a) return;
    e.preventDefault();
    open(Number(a.getAttribute('data-i')), a.closest('[aria-hidden="true"]') ? links[Number(a.getAttribute('data-i'))] : a);
  });
  dlg.querySelector('[data-lb-prev]').addEventListener('click', function () { show(cur - 1); });
  dlg.querySelector('[data-lb-next]').addEventListener('click', function () { show(cur + 1); });
  dlg.querySelector('[data-lb-close]').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });          /* click on the backdrop */
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); }
  });
  dlg.addEventListener('close', function () {
    document.documentElement.classList.remove('sa-lb-open');
    if (last && last.focus) last.focus();
  });
})();
