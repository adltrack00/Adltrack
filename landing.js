/* Phone menu on the home page: the menu button opens a full-screen list of links. */
(() => {
  const toggle = document.querySelector('.menu-toggle'), menu = document.querySelector('#mobile-menu');
  if (!toggle || !menu) return;
  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-locked', open);
    (open ? menu.querySelector('.menu-close') : toggle).focus();
  }
  toggle.addEventListener('click', () => setOpen(true));
  menu.addEventListener('click', e => { if (e.target.closest('.menu-close, a')) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
  // Rotating to a wider screen hides the menu button, so close the menu with it.
  matchMedia('(min-width: 641px)').addEventListener('change', e => { if (e.matches && !menu.hidden) setOpen(false); });
})();
