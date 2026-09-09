/* Native links/details remain usable if enhancement fails. */
(() => {
  const desktop = matchMedia('(min-width: 961px)');
  const menus = [...document.querySelectorAll('.site-menu')];
  const sync = () => menus.forEach(menu => { menu.open = desktop.matches; });
  sync();
  desktop.addEventListener('change', sync);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('details[open]').forEach(menu => {
      if (menu.classList.contains('site-menu') && desktop.matches) return;
      if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus();
      menu.open = false;
    });
  });
  document.addEventListener('click', event => {
    menus.forEach(menu => {
      if (!desktop.matches && (!menu.contains(event.target) || event.target.closest('a'))) menu.open = false;
    });
  });
  document.querySelectorAll('.site-menu-links a').forEach(link => {
    if (new URL(link.href).pathname === location.pathname && !link.hash) link.setAttribute('aria-current', 'page');
  });
  const toc = document.querySelector('.doc-toc');
  if (toc) {
    const nav = document.querySelector('.site-nav');
    const syncTocOffset = () => {
      if (desktop.matches) {
        toc.style.removeProperty('top');
        return;
      }
      const navHeight = nav?.getBoundingClientRect().height;
      if (navHeight) toc.style.top = `${Math.ceil(navHeight)}px`;
    };
    toc.open = desktop.matches;
    syncTocOffset();
    desktop.addEventListener('change', syncTocOffset);
    window.addEventListener('resize', syncTocOffset, {passive: true});
    toc.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (desktop.matches || !link) return;
      toc.open = false;
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (target) { target.tabIndex = -1; target.focus({preventScroll: true}); }
    });
  }
})();
