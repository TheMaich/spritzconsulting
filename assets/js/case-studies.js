// Case studies gallery: one panel open at a time. Hover opens a panel on mouse, click or keyboard
// focus opens it on touch and keyboard. Without JS the default panel (03) stays open and the rest
// remain readable as labels.
(() => {
  const gallery = document.querySelector('.cs-gallery');
  if (!gallery) return;

  const items = Array.from(gallery.querySelectorAll('.cs-item'));

  const setActive = (item) => {
    items.forEach((el) => {
      const on = el === item;
      el.classList.toggle('is-active', on);
      const btn = el.querySelector('.cs-trigger');
      if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  items.forEach((item) => {
    const btn = item.querySelector('.cs-trigger');
    if (!btn) return;
    btn.addEventListener('click', () => setActive(item));
    btn.addEventListener('focus', () => setActive(item));
    item.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') setActive(item);
    });
  });
})();
