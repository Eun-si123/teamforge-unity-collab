/* Lightweight illustration first; Three.js is an explicit progressive enhancement. */
(() => {
  'use strict';
  const assetBase = new URL('.', document.currentScript.src);
  const lab = document.getElementById('collabLab');
  if (!lab) return;
  import(new URL('editor-demo-localize.js', assetBase)).catch(() => {});
  const translate = text => globalThis.TeamForgeDemoLocale?.translate?.(text) || text;
  let position = 0, locked = false, drag = null;
  const cubes = [...lab.querySelectorAll('.fallback-cube')];
  const status = document.getElementById('fallback-status');
  const lock = document.getElementById('lockButton');
  const render = message => {
    lab.style.setProperty('--demo-progress', String(position / 4));
    lab.dataset.locked = String(locked);
    lab.querySelectorAll('[data-fallback-x]').forEach(output => { output.textContent = position.toFixed(2); });
    cubes.forEach(cube => cube.setAttribute('aria-valuenow', position.toFixed(2)));
    lock.setAttribute('aria-pressed', String(locked));
    lock.textContent = translate(locked ? 'Release lock' : 'Lock object');
    const announcement = translate(message);
    if (status.textContent !== announcement) status.textContent = announcement;
  };
  const move = (editor, next) => {
    if (editor === 'b' && locked) {
      render('Editor B cannot edit: Cube is owned by Editor A');
      return false;
    }
    position = Math.max(0, Math.min(4, next));
    render(editor === 'a' ? 'Transform mirrored to Editor B' : 'Transform mirrored to Editor A');
    return true;
  };
  const endDrag = () => {
    const previous = drag;
    drag = null;
    lab.removeAttribute('data-dragging');
    if (previous?.cube.hasPointerCapture(previous.id)) previous.cube.releasePointerCapture(previous.id);
  };
  const hint = document.createElement('p');
  hint.id = 'fallback-drag-hint';
  hint.className = 'small';
  hint.textContent = translate('Drag either Cube sideways, or use the buttons. Arrow keys also move a focused Cube.');
  lab.querySelector('.fallback-controls').before(hint);
  cubes.forEach((cube, index) => {
    const editor = index === 0 ? 'a' : 'b';
    cube.parentElement.removeAttribute('aria-hidden');
    cube.tabIndex = 0;
    cube.setAttribute('role', 'slider');
    cube.setAttribute('aria-label', `Editor ${editor.toUpperCase()} · Cube X`);
    cube.setAttribute('aria-valuemin', '0');
    cube.setAttribute('aria-valuemax', '4');
    cube.setAttribute('aria-valuenow', '0');
    cube.setAttribute('aria-orientation', 'horizontal');
    cube.setAttribute('aria-describedby', hint.id);
    cube.addEventListener('keydown', event => {
      const next = {ArrowLeft: position - 0.25, ArrowRight: position + 0.25, Home: 0, End: 4}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      endDrag();
      move(editor, next);
    });
    cube.addEventListener('pointerdown', event => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      cube.focus({preventScroll: true});
      if (!move(editor, position)) return;
      drag = {cube, id: event.pointerId, x: event.clientX, position, travel: Math.max(1, cube.parentElement.clientWidth - 48)};
      cube.setPointerCapture(event.pointerId);
      lab.dataset.dragging = 'true';
    });
    cube.addEventListener('pointermove', event => {
      if (!drag || drag.cube !== cube || drag.id !== event.pointerId) return;
      move(editor, drag.position + (event.clientX - drag.x) * 4 / drag.travel);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      cube.addEventListener(type, event => {
        if (drag?.cube === cube && drag.id === event.pointerId) endDrag();
      });
    }
  });
  document.getElementById('moveButton').addEventListener('click', () => {
    endDrag();
    position = (Math.floor(position) + 1) % 5;
    render('Transform mirrored to Editor B');
  });
  document.getElementById('peerMoveButton').addEventListener('click', () => {
    if (locked) { render('Editor B cannot edit: Cube is owned by Editor A'); return; }
    endDrag();
    position = (Math.floor(position) + 1) % 5;
    render('Transform mirrored to Editor A');
  });
  lock.addEventListener('click', () => {
    endDrag();
    locked = !locked;
    render(locked ? 'Cube ownership assigned to Editor A' : 'Cube ownership released');
  });
  document.getElementById('resetButton').addEventListener('click', () => {
    endDrag();
    position = 0; locked = false;
    render('Demo reset · Cube selected in both editors');
  });
  const start = document.getElementById('loadDemo');
  start.addEventListener('click', async () => {
    endDrag();
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
