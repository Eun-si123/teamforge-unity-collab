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

  import(assetUrl('editor-demo-localize.js')).catch((error) => {
    console.error('[TeamForge demo] Failed to load demo locale layer', error);
  });

  import(assetUrl('editor-demo-v4.js')).catch((error) => {
    console.error('[TeamForge demo] Failed to load editor-demo-v4.js', error);
    const lab = document.getElementById('collabLab');
    if (lab) {
      const korean = document.documentElement.lang.toLowerCase().startsWith('ko');
      lab.innerHTML = korean
        ? '<div class="v4-error">인터랙티브 브라우저 시뮬레이션을 불러오지 못했습니다. 아래의 실제 TeamForge 개발 캡처는 계속 확인할 수 있습니다.</div>'
        : '<div class="v4-error">The interactive browser simulation could not load. The real TeamForge development capture below is still available.</div>';
    }
  });
})();
