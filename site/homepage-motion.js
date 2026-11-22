/* Progressive disclosure only. The illustration and navigation work without JS. */
(() => {
  'use strict';
  if (!document.body.classList.contains('site-home')) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
