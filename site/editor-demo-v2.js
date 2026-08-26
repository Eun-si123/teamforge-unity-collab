(() => {
  'use strict';
  import('./editor-demo-v4.js').catch((error) => {
    console.error('[TeamForge demo] Failed to load editor-demo-v4.js', error);
    const lab = document.getElementById('collabLab');
    if (lab) {
      lab.innerHTML = '<div class="v4-error">The interactive browser simulation could not load. The real TeamForge development capture below is still available.</div>';
    }
  });
})();
