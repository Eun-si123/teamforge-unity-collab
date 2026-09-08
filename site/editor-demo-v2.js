/* Lightweight illustration first; Three.js is an explicit progressive enhancement. */
(() => {
  'use strict';
  const assetBase = new URL('.', document.currentScript.src);
  const lab = document.getElementById('collabLab');
  if (!lab) return;
  import(new URL('editor-demo-localize.js', assetBase)).catch(() => {});
  const translate = text => globalThis.TeamForgeDemoLocale?.translate?.(text) || text;
  let position = 0, locked = false;
  const status = document.getElementById('fallback-status');
  const lock = document.getElementById('lockButton');
  const render = message => {
    lab.style.setProperty('--demo-x', `${position * 18}px`);
    lab.dataset.locked = String(locked);
    lab.querySelectorAll('[data-fallback-x]').forEach(output => { output.textContent = position.toFixed(2); });
    lock.setAttribute('aria-pressed', String(locked));
    lock.textContent = translate(locked ? 'Release lock' : 'Lock object');
    status.textContent = translate(message);
  };
  document.getElementById('moveButton').addEventListener('click', () => {
    position = (position + 1) % 5;
    render('Transform mirrored to Editor B');
  });
  document.getElementById('peerMoveButton').addEventListener('click', () => {
    if (locked) { render('Editor B cannot edit: Cube is owned by Editor A'); return; }
    position = (position + 1) % 5;
    render('Transform mirrored to Editor A');
  });
  lock.addEventListener('click', () => {
    locked = !locked;
    render(locked ? 'Cube ownership assigned to Editor A' : 'Cube ownership released');
  });
  document.getElementById('resetButton').addEventListener('click', () => {
    position = 0; locked = false;
    render('Demo reset · Cube selected in both editors');
  });
  const start = document.getElementById('loadDemo');
  start.addEventListener('click', async () => {
    start.disabled = true;
    start.setAttribute('aria-busy', 'true');
    try {
      const locale = await import(new URL('editor-demo-localize.js', assetBase));
      if (locale.ready) await locale.ready;
      const sheet = document.createElement('link');
      sheet.rel = 'stylesheet'; sheet.href = new URL('editor-demo-v4.css', assetBase);
      sheet.dataset.teamforgeEditorV4 = 'true';
      document.head.append(sheet);
      await import(new URL('editor-demo-v4.js', assetBase));
    } catch {
      start.disabled = false;
      status.textContent = translate('The 3D illustration is unavailable. The lightweight controls and real capture still work.');
    } finally { start.removeAttribute('aria-busy'); }
  });
})();
