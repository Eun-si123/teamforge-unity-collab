(() => {
  'use strict';

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
    './site-theme.css',
    'teamforgeSiteTheme'
  );

  ensureStylesheet(
    'link[data-teamforge-site-responsive]',
    './site-responsive.css',
    'teamforgeSiteResponsive'
  );

  ensureStylesheet(
    'link[data-teamforge-editor-v4-layout-fix]',
    './editor-demo-v4-layout-fix.css',
    'teamforgeEditorV4LayoutFix'
  );

  import('./editor-demo-v4.js').catch((error) => {
    console.error('[TeamForge demo] Failed to load editor-demo-v4.js', error);
    const lab = document.getElementById('collabLab');
    if (lab) {
      lab.innerHTML = '<div class="v4-error">The interactive browser simulation could not load. The real TeamForge development capture below is still available.</div>';
    }
  });
})();
