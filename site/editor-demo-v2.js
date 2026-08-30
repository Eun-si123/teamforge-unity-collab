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

  ensureStylesheet(
    'link[data-teamforge-site-theme]',
    assetUrl('site-theme.css'),
    'teamforgeSiteTheme'
  );

  ensureStylesheet(
    'link[data-teamforge-site-responsive]',
    assetUrl('site-responsive.css'),
    'teamforgeSiteResponsive'
  );

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

  const loadDemo = async () => {
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
  };

  loadDemo();
})();
