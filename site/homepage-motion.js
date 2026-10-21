/* Homepage progressive enhancement. Structure, art, demo and links work without this file. */
(() => {
  'use strict';
  if (!document.body.classList.contains('site-home')) return;
  const hero = document.querySelector('header.hero');
  const reactor = hero?.querySelector('.tfc-reactor');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!reducedMotion.matches && reactor && window.innerWidth > 900) {
    let queued = false;
    let shiftX = 0;
    let shiftY = 0;
    hero.addEventListener('pointermove', (event) => {
      shiftX = (event.clientX - innerWidth * .65) / 65;
      shiftY = (event.clientY - innerHeight * .5) / 90;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        reactor.style.setProperty('--tfc-x', shiftX + 'px');
        reactor.style.setProperty('--tfc-y', shiftY + 'px');
        queued = false;
      });
    }, { passive: true });
  }
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const targets = document.querySelectorAll(
    '#demo .section-head,#proof .proof-layout,#features .scope-layout,' +
    '#workflow .scope-layout,#contribute .contribution'
  );
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('tfc-visible');
    observer.unobserve(entry.target);
  }), { threshold: .08 });
  targets.forEach(element => {
    element.classList.add('tfc-reveal');
    observer.observe(element);
  });
})();
