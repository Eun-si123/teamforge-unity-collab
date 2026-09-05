(() => {
  'use strict';

  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : new URL('editor-demo-v2.js', document.baseURI).href;
  const assetBase = new URL('.', scriptUrl);
  const assetUrl = (name) => new URL(name, assetBase).href;

  const ensureStylesheet = (selector, href, dataKey) => {
    if (document.querySelector(selector)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset[dataKey] = 'true';
    document.head.appendChild(link);
  };

  let demoLoadPromise = null;
  const loadDemo = () => {
    if (demoLoadPromise) return demoLoadPromise;
    demoLoadPromise = (async () => {
      ensureStylesheet(
        'link[data-teamforge-editor-v4-layout-fix]',
        assetUrl('editor-demo-v4-layout-fix.css'),
        'teamforgeEditorV4LayoutFix'
      );
      ensureStylesheet(
        'link[data-teamforge-editor-v4]',
        assetUrl('editor-demo-v4.css'),
        'teamforgeEditorV4'
      );

      try {
        const localeModule = await import(assetUrl('editor-demo-localize.js'));
        if (localeModule.ready) await localeModule.ready;
      } catch (error) {
        console.error('[TeamForge demo] Failed to load demo locale layer', error);
      }

      try {
        await import(assetUrl('editor-demo-v4.js'));
      } catch (error) {
        console.error('[TeamForge demo] Failed to load editor-demo-v4.js', error);
        const lab = document.getElementById('collabLab');
        if (lab) {
          const fallback = 'The interactive browser simulation could not load. The real TeamForge development capture below is still available.';
          const localized = globalThis.TeamForgeDemoLocale && typeof globalThis.TeamForgeDemoLocale.translate === 'function'
            ? globalThis.TeamForgeDemoLocale.translate(fallback)
            : fallback;
          lab.innerHTML = `<div class="v4-error">${localized}</div>`;
        }
      }
    })();
    return demoLoadPromise;
  };

  const hydrateProofVideo = () => {
    const video = document.querySelector('video[data-teamforge-proof-video]');
    if (!video || video.dataset.loaded === 'true') return;
    const load = () => {
      if (video.dataset.loaded === 'true') return;
      video.dataset.loaded = 'true';
      video.querySelectorAll('source[data-src]').forEach((source) => {
        source.src = source.dataset.src;
      });
      video.load();
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) video.controls = true;
      else video.play().catch(() => {});
    };
    if (!('IntersectionObserver' in window)) {
      load();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '300px 0px' });
    observer.observe(video);
  };

  const scheduleDemo = () => {
    const demo = document.getElementById('demo');
    hydrateProofVideo();
    if (!demo) return;
    if (!('IntersectionObserver' in window)) {
      loadDemo();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadDemo();
    }, { rootMargin: '100px 0px' });
    observer.observe(demo);
    demo.addEventListener('pointerenter', loadDemo, { once: true, passive: true });
    demo.addEventListener('focusin', loadDemo, { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleDemo, { once: true });
  } else {
    scheduleDemo();
  }
})();
