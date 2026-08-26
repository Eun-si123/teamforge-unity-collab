(() => {
  'use strict';

  if (!document.querySelector('link[data-teamforge-editor-v4-layout-fix]')) {
    const layoutFix = document.createElement('link');
    layoutFix.rel = 'stylesheet';
    layoutFix.href = './editor-demo-v4-layout-fix.css';
    layoutFix.dataset.teamforgeEditorV4LayoutFix = 'true';
    document.head.appendChild(layoutFix);
  }

  import('./editor-demo-v4.js').catch((error) => {
    console.error('[TeamForge demo] Failed to load editor-demo-v4.js', error);
    const lab = document.getElementById('collabLab');
    if (lab) {
      lab.innerHTML = '<div class="v4-error">The interactive browser simulation could not load. The real TeamForge development capture below is still available.</div>';
    }
  });
})();
