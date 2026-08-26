(() => {
  'use strict';

  const onReady = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  onReady(async () => {
    const lab = document.getElementById('collabLab');
    const demoSection = document.getElementById('demo');
    if (!lab || !demoSection) return;

    const heading = demoSection.querySelector('h2');
    const intro = demoSection.querySelector('.section-intro');
    if (heading) heading.textContent = 'A Scene view that behaves like one.';
    if (intro) {
      intro.textContent = 'The interaction model follows Unity Editor conventions: select GameObjects in Scene or Hierarchy, use Q/W/E/R for View, Move, Rotate, and Scale, edit Transform values in Inspector, and use familiar Scene navigation while TeamForge mirrors object state to the peer.';
    }

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './editor-demo-v3.css';
    document.head.appendChild(stylesheet);

    lab.classList.add('v3');
    lab.tabIndex = 0;
    lab.innerHTML = `
      <div class="lab-toolbar">
        <div class="lab-status" aria-live="polite">session / <span id="v3SyncState">loading</span> · <span id="v3EventText">Preparing Scene view</span></div>
        <div class="v3-session-actions">
          <select class="v3-create" id="v3Create" aria-label="Create GameObject">
            <option value="">+ Create</option>
            <option value="cube">Cube</option>
            <option value="sphere">Sphere</option>
            <option value="light">Light</option>
          </select>
          <button class="btn" type="button" id="v3Duplicate">Duplicate</button>
          <button class="btn" type="button" id="v3Delete">Delete</button>
          <button class="btn" type="button" id="v3Lock" data-active="false">Lock</button>
          <button class="btn" type="button" id="v3Reset">Reset</button>
        </div>
      </div>
      <div class="v3-loading" id="v3Loading">Loading the interactive 3D Scene…</div>
    `;

    const $ = (id) => document.getElementById(id);
    const syncState = $('v3SyncState');
    const eventText = $('v3EventText');
    const loading = $('v3Loading');

    let THREE, OrbitControls, TransformControls;
    try {
      const modules = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/three@0.180.0/+esm'),
        import('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js/+esm'),
        import('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/TransformControls.js/+esm')
      ]);
      THREE = modules[0];
      OrbitControls = modules[1].OrbitControls;
      TransformControls = modules[2].TransformControls;
      if (!THREE || !OrbitControls || !TransformControls) throw new Error('3D controls did not load');
    } catch (error) {
      console.error('[TeamForge demo] Failed to load 3D modules', error);
      syncState.textContent = 'unavailable';
      eventText.textContent = '3D modules could not load';
      loading.className = 'v3-error';
      loading.textContent = 'The interactive Scene demo could not load its pinned 3D modules. The real TeamForge development capture below is still available.';
      return;
    }

    lab.innerHTML = `
      <div class="lab-toolbar">
        <div class="lab-status" aria-live="polite">session / <span id="v3SyncState">connected</span> · <span id="v3EventText">Shared Scene ready</span></div>
        <div class="v3-session-actions">
          <select class="v3-create" id="v3Create" aria-label="Create GameObject">
            <option value="">+ Create</option>
            <option value="cube">Cube</option>
            <option value="sphere">Sphere</option>
            <option value="light">Light</option>
          </select>
          <button class="btn" type="button" id="v3Duplicate">Duplicate</button>
          <button class="btn" type="button" id="v3Delete">Delete</button>
          <button class="btn" type="button" id="v3Lock" data-active="false">Lock</button>
          <button class="btn" type="button" id="v3Reset">Reset</button>
        </div>
      </div>

      <div class="v3-editor-pair">
        <article class="v3-editor host">
          <div class="v3-editor-head"><strong>Editor A · Eun</strong><span>Host · interactive</span></div>
          <div class="v3-workspace">
            <aside class="v3-hierarchy">
              <div class="v3-panel-title">Hierarchy</div>
              <div class="v3-scene-root" id="v3HostHierarchy"></div>
            </aside>
            <div class="v3-scene" id="v3HostScene">
              <div class="v3-tool-overlay" aria-label="Transform tools">
                <button type="button" data-tool="view" title="View Tool (Q)">Q<span>View</span></button>
                <button type="button" data-tool="move" title="Move Tool (W)">W<span>Move</span></button>
                <button type="button" data-tool="rotate" title="Rotate Tool (E)">E<span>Rotate</span></button>
                <button type="button" data-tool="scale" title="Scale Tool (R)">R<span>Scale</span></button>
              </div>
              <div class="v3-tool-settings" aria-label="Tool handle settings">
                <button type="button" id="v3Pivot" data-active="true">Pivot</button>
                <button type="button" id="v3Space" data-active="false">Global</button>
              </div>
              <div class="v3-view-gizmo" aria-label="Scene view orientation">
                <button type="button" class="x" data-view="x" title="Right view">X</button>
                <button type="button" class="y" data-view="y" title="Top view">Y</button>
                <button type="button" class="z" data-view="z" title="Front view">Z</button>
                <button type="button" class="iso" data-view="iso" title="Perspective isometric view">ISO</button>
              </div>
              <canvas id="v3HostCanvas" tabindex="0" aria-label="Interactive 3D Scene view. Select objects, use transform gizmos, or navigate the Scene camera."></canvas>
              <div class="v3-scene-hint" id="v3HostHint">Alt+LMB Orbit · MMB Pan · Wheel Zoom · F Frame selected</div>
            </div>
            <aside class="v3-inspector">
              <div class="v3-panel-title">Inspector</div>
              <div class="v3-inspector-body" id="v3Inspector">
                <div class="v3-name-line">
                  <input class="v3-active-check" id="v3Active" type="checkbox" checked aria-label="GameObject active">
                  <input class="v3-name-input" id="v3Name" type="text" aria-label="GameObject name">
                </div>
                <div class="v3-component">
                  <div class="v3-component-head">Transform</div>
                  <div class="v3-transform-group">
                    <div class="v3-transform-row" data-prop="position"><span>Position</span></div>
                    <div class="v3-transform-row" data-prop="rotation"><span>Rotation</span></div>
                    <div class="v3-transform-row" data-prop="scale"><span>Scale</span></div>
                  </div>
                </div>
                <div class="v3-owner" id="v3Owner"><strong>TeamForge</strong><br>Owner · shared</div>
              </div>
            </aside>
          </div>
          <div class="v3-statusbar"><span>Tool <strong id="v3ToolMeta">Move</strong></span><span>Selected <strong id="v3SelectedMeta">Cube</strong></span><span>Objects <strong id="v3ObjectCount">3</strong></span></div>
        </article>

        <article class="v3-editor peer">
          <div class="v3-editor-head"><strong>Editor B · Peer</strong><span id="v3PeerMode">Guest · connected</span></div>
          <div class="v3-workspace">
            <aside class="v3-hierarchy">
              <div class="v3-panel-title">Hierarchy</div>
              <div class="v3-scene-root" id="v3PeerHierarchy"></div>
            </aside>
            <div class="v3-scene" id="v3PeerScene">
              <div class="v3-view-gizmo" aria-label="Peer Scene view orientation">
                <button type="button" class="x" data-peer-view="x">X</button>
                <button type="button" class="y" data-peer-view="y">Y</button>
                <button type="button" class="z" data-peer-view="z">Z</button>
                <button type="button" class="iso" data-peer-view="iso">ISO</button>
              </div>
              <canvas id="v3PeerCanvas" tabindex="0" aria-label="Peer 3D Scene view showing synchronized GameObjects. Drag to orbit this independent view."></canvas>
              <div class="v3-peer-badge" id="v3PeerBadge">Remote selection · Cube</div>
            </div>
          </div>
          <div class="v3-statusbar"><span>View <strong>independent</strong></span><span>Scene state <strong id="v3PeerState">synced</strong></span><span>Objects <strong id="v3PeerCount">3</strong></span></div>
        </article>
      </div>

      <div class="v3-lab-foot">
        <div class="v3-shortcuts"><span><strong>Unity-style controls:</strong></span><span><kbd>Q</kbd> View</span><span><kbd>W</kbd> Move</span><span><kbd>E</kbd> Rotate</span><span><kbd>R</kbd> Scale</span><span><kbd>F</kbd> Frame selected</span><span><kbd>Alt + LMB</kbd> Orbit</span><span><kbd>MMB</kbd> Pan</span><span><kbd>Wheel</kbd> Zoom</span></div>
        <span class="mono">browser simulation · real capture ↓</span>
      </div>
    `;

    const get = (id) => document.getElementById(id);
    const hostCanvas = get('v3HostCanvas');
    const peerCanvas = get('v3PeerCanvas');
    const hostHierarchy = get('v3HostHierarchy');
    const peerHierarchy = get('v3PeerHierarchy');
    const hostSceneEl = get('v3HostScene');
    const peerSceneEl = get('v3PeerScene');
    const inspector = get('v3Inspector');
    const nameInput = get('v3Name');
    const activeInput = get('v3Active');
    const ownerField = get('v3Owner');
    const createSelect = get('v3Create');
    const duplicateButton = get('v3Duplicate');
    const deleteButton = get('v3Delete');
    const lockButton = get('v3Lock');
    const resetButton = get('v3Reset');
    const peerMode = get('v3PeerMode');
    const peerBadge = get('v3PeerBadge');
    const hostHint = get('v3HostHint');
    const toolMeta = get('v3ToolMeta');
    const selectedMeta = get('v3SelectedMeta');
    const objectCount = get('v3ObjectCount');
    const peerCount = get('v3PeerCount');
    const peerState = get('v3PeerState');
    const spaceButton = get('v3Space');
    const sync = get('v3SyncState');
    const eventLabel = get('v3EventText');

    const AXES = ['x', 'y', 'z'];
    const DEFAULTS = {
      camera: { name: 'Main Camera', type: 'camera', position: [-3.8, 2.8, 4.6], rotation: [18, -38, 0], scale: [1, 1, 1] },
      light: { name: 'Directional Light', type: 'light', position: [2.2, 3.8, 1.6], rotation: [48, -30, 0], scale: [1, 1, 1] },
      cube: { name: 'Cube', type: 'cube', position: [0, .5, 0], rotation: [0, 24, 0], scale: [1, 1, 1] }
    };

    const state = {
      tool: 'move',
      space: 'world',
      selectedId: 'cube',
      lockedId: null,
      nextId: 1,
      objects: new Map()
    };

    const hostObjects = new Map();
    const peerObjects = new Map();
    let peerSelectionBox = null;
    let hostPointerDown = null;
    let transformGesture = false;
    let navOverride = false;
    let running = true;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const degToRad = (v) => THREE.MathUtils.degToRad(v);
    const radToDeg = (v) => THREE.MathUtils.radToDeg(v);
    const safeNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

    function createRenderer(canvas) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      return renderer;
    }

    function makeWorld() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x30343a);
      scene.fog = new THREE.Fog(0x30343a, 22, 42);

      const grid = new THREE.GridHelper(30, 30, 0x5f6770, 0x41464d);
      grid.material.transparent = true;
      grid.material.opacity = .72;
      scene.add(grid);

      const axes = new THREE.AxesHelper(1.5);
      axes.material.transparent = true;
      axes.material.opacity = .72;
      scene.add(axes);

      const hemi = new THREE.HemisphereLight(0xbcd6ee, 0x353b43, 1.35);
      scene.add(hemi);

      const key = new THREE.DirectionalLight(0xffffff, 2.3);
      key.position.set(5, 8, 4);
      key.castShadow = true;
      scene.add(key);

      return scene;
    }

    const hostScene = makeWorld();
    const peerScene3D = makeWorld();
    const hostRenderer = createRenderer(hostCanvas);
    const peerRenderer = createRenderer(peerCanvas);

    const hostCamera = new THREE.PerspectiveCamera(50, 1, .05, 100);
    hostCamera.position.set(6.4, 4.8, 7.2);
    const peerCamera = new THREE.PerspectiveCamera(50, 1, .05, 100);
    peerCamera.position.set(-6.2, 4.1, 6.4);

    const hostOrbit = new OrbitControls(hostCamera, hostCanvas);
    hostOrbit.target.set(0, .6, 0);
    hostOrbit.enableDamping = true;
    hostOrbit.dampingFactor = .08;
    hostOrbit.minDistance = 1.8;
    hostOrbit.maxDistance = 24;
    hostOrbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    hostOrbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    hostOrbit.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
    hostOrbit.touches.ONE = THREE.TOUCH.ROTATE;
    hostOrbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    hostOrbit.update();

    const peerOrbit = new OrbitControls(peerCamera, peerCanvas);
    peerOrbit.target.set(0, .6, 0);
    peerOrbit.enableDamping = true;
    peerOrbit.dampingFactor = .08;
    peerOrbit.minDistance = 1.8;
    peerOrbit.maxDistance = 24;
    peerOrbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    peerOrbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    peerOrbit.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
    peerOrbit.touches.ONE = THREE.TOUCH.ROTATE;
    peerOrbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    peerOrbit.update();

    const transform = new TransformControls(hostCamera, hostCanvas);
    transform.setMode('translate');
    transform.setSpace('world');
    transform.setSize(.82);
    hostScene.add(transform.getHelper());

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function standardMaterial(color) {
      return new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .05 });
    }

    function markRoot(root, id) {
      root.userData.tfId = id;
      root.traverse((node) => { node.userData.tfRootId = id; });
      return root;
    }

    function makeCameraVisual(id) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(.55, .38, .72), standardMaterial(0x52677e));
      body.castShadow = true;
      body.receiveShadow = true;
      root.add(body);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(.18, .26, .34, 14), standardMaterial(0x7195b8));
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -.48;
      root.add(lens);
      return markRoot(root, id);
    }

    function makeLightVisual(id) {
      const root = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(.22, 18, 12), standardMaterial(0xe5c566));
      core.castShadow = true;
      root.add(core);
      const rayMat = new THREE.LineBasicMaterial({ color: 0xe7cb76 });
      const points = [];
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8;
        points.push(new THREE.Vector3(Math.cos(a) * .3, 0, Math.sin(a) * .3));
        points.push(new THREE.Vector3(Math.cos(a) * .58, 0, Math.sin(a) * .58));
      }
      root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), rayMat));
      return markRoot(root, id);
    }

    function makeObjectVisual(record) {
      let root;
      if (record.type === 'cube') {
        root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standardMaterial(0x648fba));
        root.castShadow = true;
        root.receiveShadow = true;
      } else if (record.type === 'sphere') {
        root = new THREE.Mesh(new THREE.SphereGeometry(.56, 32, 20), standardMaterial(0x7e91b2));
        root.castShadow = true;
        root.receiveShadow = true;
      } else if (record.type === 'light') {
        root = makeLightVisual(record.id);
      } else if (record.type === 'camera') {
        root = makeCameraVisual(record.id);
      } else {
        root = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standardMaterial(0x777777));
      }
      return markRoot(root, record.id);
    }

    function applyRecordToObject(record, object) {
      object.position.fromArray(record.position);
      object.rotation.set(degToRad(record.rotation[0]), degToRad(record.rotation[1]), degToRad(record.rotation[2]), 'XYZ');
      object.scale.fromArray(record.scale);
      object.visible = record.active !== false;
      object.updateMatrixWorld(true);
    }

    function captureObjectToRecord(object, record) {
      record.position = [object.position.x, object.position.y, object.position.z];
      record.rotation = [radToDeg(object.rotation.x), radToDeg(object.rotation.y), radToDeg(object.rotation.z)];
      record.scale = [object.scale.x, object.scale.y, object.scale.z];
      record.active = object.visible;
    }

    function addRecord(record, announce = true) {
      state.objects.set(record.id, record);
      const hostObject = makeObjectVisual(record);
      const peerObject = makeObjectVisual(record);
      applyRecordToObject(record, hostObject);
      applyRecordToObject(record, peerObject);
      hostObjects.set(record.id, hostObject);
      peerObjects.set(record.id, peerObject);
      hostScene.add(hostObject);
      peerScene3D.add(peerObject);
      if (announce) signal(`${record.name} created and mirrored`);
    }

    function removeRecord(id, announce = true) {
      const record = state.objects.get(id);
      const hostObject = hostObjects.get(id);
      const peerObject = peerObjects.get(id);
      if (!record || !hostObject || !peerObject) return;
      if (state.selectedId === id) transform.detach();
      hostScene.remove(hostObject);
      peerScene3D.remove(peerObject);
      disposeObject(hostObject);
      disposeObject(peerObject);
      hostObjects.delete(id);
      peerObjects.delete(id);
      state.objects.delete(id);
      if (state.lockedId === id) state.lockedId = null;
      if (state.selectedId === id) state.selectedId = state.objects.has('cube') ? 'cube' : (state.objects.keys().next().value || null);
      if (announce) signal(`${record.name} deleted and mirrored`);
      selectObject(state.selectedId, false);
    }

    function disposeObject(root) {
      root.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((m) => m.dispose && m.dispose());
        }
      });
    }

    function resetScene() {
      transform.detach();
      [...state.objects.keys()].forEach((id) => removeRecord(id, false));
      state.objects.clear();
      hostObjects.clear();
      peerObjects.clear();
      state.lockedId = null;
      state.nextId = 1;
      Object.entries(DEFAULTS).forEach(([id, item]) => addRecord({ id, ...structuredClone(item), active: true }, false));
      state.selectedId = 'cube';
      hostCamera.position.set(6.4, 4.8, 7.2);
      hostOrbit.target.set(0, .6, 0);
      peerCamera.position.set(-6.2, 4.1, 6.4);
      peerOrbit.target.set(0, .6, 0);
      hostOrbit.update();
      peerOrbit.update();
      setTool('move', false);
      selectObject('cube', false);
      signal('Demo reset · shared Scene restored');
    }

    function uniqueName(base) {
      const names = new Set([...state.objects.values()].map((r) => r.name));
      if (!names.has(base)) return base;
      let i = 1;
      while (names.has(`${base} (${i})`)) i += 1;
      return `${base} (${i})`;
    }

    function createObject(type) {
      const baseName = type === 'cube' ? 'Cube' : type === 'sphere' ? 'Sphere' : 'Light';
      const id = `${type}-${state.nextId++}`;
      const offset = (state.nextId % 4) * .35;
      const record = {
        id,
        name: uniqueName(baseName),
        type,
        position: [offset - .5, type === 'light' ? 2.3 : .55, offset - .35],
        rotation: type === 'light' ? [40, -30, 0] : [0, 0, 0],
        scale: [1, 1, 1],
        active: true
      };
      addRecord(record);
      selectObject(id, false);
    }

    function duplicateSelected() {
      const source = state.objects.get(state.selectedId);
      if (!source) return;
      const id = `${source.type}-${state.nextId++}`;
      const record = structuredClone(source);
      record.id = id;
      record.name = uniqueName(source.name.replace(/ \(\d+\)$/, ''));
      record.position[0] += .7;
      record.position[2] += .35;
      addRecord(record);
      selectObject(id, false);
    }

    function syncPeer(id, message = 'Transform mirrored to Editor B') {
      const hostObject = hostObjects.get(id);
      const peerObject = peerObjects.get(id);
      const record = state.objects.get(id);
      if (!hostObject || !peerObject || !record) return;
      captureObjectToRecord(hostObject, record);
      applyRecordToObject(record, peerObject);
      peerState.textContent = 'syncing';
      sync.textContent = 'syncing';
      eventLabel.textContent = message;
      window.requestAnimationFrame(() => {
        peerState.textContent = 'synced';
        sync.textContent = 'connected';
      });
      updateInspector();
      updatePeerSelectionBox();
    }

    function signal(message) {
      sync.textContent = 'connected';
      peerState.textContent = 'synced';
      eventLabel.textContent = message;
      renderHierarchy();
      updateInspector();
      updateMeta();
      updatePeerSelectionBox();
    }

    function iconClass(type) {
      return type === 'sphere' ? 'sphere' : type === 'light' ? 'light' : type === 'camera' ? 'camera' : 'cube';
    }

    function hierarchyMarkup(peer = false) {
      const rows = [...state.objects.values()].map((record) => {
        const selected = !peer && record.id === state.selectedId;
        const remote = peer && record.id === state.selectedId;
        const locked = record.id === state.lockedId;
        const classes = ['v3-object-row'];
        if (selected) classes.push('selected');
        if (remote) classes.push('remote-selected');
        if (locked) classes.push('locked');
        return `<button type="button" class="${classes.join(' ')}" data-id="${record.id}"><span class="v3-object-icon ${iconClass(record.type)}"></span><span>${escapeHtml(record.name)}</span></button>`;
      }).join('');
      return `<button type="button" class="v3-scene-row" tabindex="-1">▾ SampleScene</button>${rows}`;
    }

    function renderHierarchy() {
      hostHierarchy.innerHTML = hierarchyMarkup(false);
      peerHierarchy.innerHTML = hierarchyMarkup(true);
      hostHierarchy.querySelectorAll('[data-id]').forEach((button) => {
        button.addEventListener('click', () => selectObject(button.dataset.id));
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
    }

    function buildInspectorFields() {
      inspector.querySelectorAll('.v3-transform-row').forEach((row) => {
        AXES.forEach((axis) => {
          const label = document.createElement('label');
          label.className = `v3-axis-field ${axis}`;
          label.innerHTML = `<b>${axis.toUpperCase()}</b><input type="number" step="0.1" data-prop="${row.dataset.prop}" data-axis="${axis}">`;
          row.appendChild(label);
        });
      });

      inspector.querySelectorAll('input[data-prop]').forEach((input) => {
        input.addEventListener('change', () => {
          const record = state.objects.get(state.selectedId);
          const object = hostObjects.get(state.selectedId);
          if (!record || !object) return;
          const index = AXES.indexOf(input.dataset.axis);
          if (index < 0) return;
          const prop = input.dataset.prop;
          if (prop === 'position') {
            object.position.setComponent(index, clamp(safeNumber(input.value, object.position.getComponent(index)), -20, 20));
          } else if (prop === 'rotation') {
            const eulerValues = [radToDeg(object.rotation.x), radToDeg(object.rotation.y), radToDeg(object.rotation.z)];
            eulerValues[index] = clamp(safeNumber(input.value, eulerValues[index]), -360, 360);
            object.rotation.set(degToRad(eulerValues[0]), degToRad(eulerValues[1]), degToRad(eulerValues[2]), 'XYZ');
          } else if (prop === 'scale') {
            object.scale.setComponent(index, clamp(safeNumber(input.value, object.scale.getComponent(index)), .05, 10));
          }
          object.updateMatrixWorld(true);
          syncPeer(state.selectedId, `${record.name} ${prop} edited in Inspector`);
        });
      });
    }

    function updateInspector() {
      const record = state.objects.get(state.selectedId);
      const object = hostObjects.get(state.selectedId);
      const disabled = !record || !object;
      nameInput.disabled = disabled;
      activeInput.disabled = disabled;
      inspector.querySelectorAll('input[data-prop]').forEach((input) => { input.disabled = disabled; });
      if (disabled) {
        nameInput.value = '';
        ownerField.innerHTML = '<strong>TeamForge</strong><br>No GameObject selected';
        return;
      }

      nameInput.value = record.name;
      activeInput.checked = record.active !== false;
      const values = {
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [radToDeg(object.rotation.x), radToDeg(object.rotation.y), radToDeg(object.rotation.z)],
        scale: [object.scale.x, object.scale.y, object.scale.z]
      };
      inspector.querySelectorAll('input[data-prop]').forEach((input) => {
        const index = AXES.indexOf(input.dataset.axis);
        input.value = values[input.dataset.prop][index].toFixed(input.dataset.prop === 'rotation' ? 1 : 2);
      });
      const locked = state.lockedId === record.id;
      ownerField.innerHTML = `<strong>TeamForge</strong><br>${locked ? 'Owner · Eun (locked)' : 'Owner · shared'}<br>Type · ${escapeHtml(record.type)}`;
      lockButton.dataset.active = String(locked);
      lockButton.textContent = locked ? 'Unlock' : 'Lock';
    }

    function updateMeta() {
      const record = state.objects.get(state.selectedId);
      selectedMeta.textContent = record ? record.name : 'None';
      objectCount.textContent = String(state.objects.size);
      peerCount.textContent = String(state.objects.size);
      toolMeta.textContent = state.tool[0].toUpperCase() + state.tool.slice(1);
      const locked = state.lockedId && state.lockedId === state.selectedId;
      peerMode.textContent = locked ? 'Guest · object read only' : 'Guest · connected';
      peerBadge.textContent = record ? (locked ? `Owned by Eun · ${record.name}` : `Remote selection · ${record.name}`) : 'No remote selection';
      peerBadge.classList.toggle('locked', Boolean(locked));
    }

    function attachTransform() {
      const object = hostObjects.get(state.selectedId);
      if (!object || state.tool === 'view') {
        transform.detach();
        return;
      }
      transform.attach(object);
      transform.setMode(state.tool === 'move' ? 'translate' : state.tool);
      transform.setSpace(state.space);
    }

    function selectObject(id, announce = true) {
      if (!id || !state.objects.has(id)) {
        state.selectedId = null;
        transform.detach();
      } else {
        state.selectedId = id;
        attachTransform();
      }
      renderHierarchy();
      updateInspector();
      updateMeta();
      updatePeerSelectionBox();
      if (announce) {
        const record = state.objects.get(state.selectedId);
        eventLabel.textContent = record ? `Selected ${record.name} · selection awareness mirrored` : 'Selection cleared';
      }
    }

    function setTool(tool, announce = true) {
      state.tool = tool;
      document.querySelectorAll('[data-tool]').forEach((button) => { button.dataset.active = String(button.dataset.tool === tool); });
      hostHint.textContent = tool === 'view'
        ? 'Q View · drag to Pan · Alt+LMB Orbit · MMB Pan · Wheel Zoom'
        : `${tool === 'move' ? 'W Move' : tool === 'rotate' ? 'E Rotate' : 'R Scale'} · drag gizmo handles · Alt+LMB Orbit · MMB Pan · F Frame selected`;
      attachTransform();
      updateMeta();
      if (announce) eventLabel.textContent = `${tool[0].toUpperCase() + tool.slice(1)} tool selected`;
    }

    function toggleSpace() {
      state.space = state.space === 'world' ? 'local' : 'world';
      transform.setSpace(state.space);
      spaceButton.textContent = state.space === 'world' ? 'Global' : 'Local';
      spaceButton.dataset.active = String(state.space === 'local');
      eventLabel.textContent = `Handle rotation · ${spaceButton.textContent}`;
    }

    function updatePeerSelectionBox() {
      if (peerSelectionBox) {
        peerScene3D.remove(peerSelectionBox);
        peerSelectionBox.geometry.dispose();
        peerSelectionBox.material.dispose();
        peerSelectionBox = null;
      }
      const peerObject = peerObjects.get(state.selectedId);
      if (!peerObject || !peerObject.visible) return;
      peerSelectionBox = new THREE.BoxHelper(peerObject, state.lockedId === state.selectedId ? 0xe7c982 : 0x6db7ff);
      peerScene3D.add(peerSelectionBox);
    }

    function setView(camera, orbit, view) {
      const target = orbit.target.clone();
      const distance = Math.max(3, camera.position.distanceTo(target));
      const positions = {
        x: new THREE.Vector3(distance, 0, 0),
        y: new THREE.Vector3(0, distance, 0.0001),
        z: new THREE.Vector3(0, 0, distance),
        iso: new THREE.Vector3(distance * .68, distance * .52, distance * .68)
      };
      camera.position.copy(target).add(positions[view] || positions.iso);
      camera.up.set(0, 1, 0);
      if (view === 'y') camera.up.set(0, 0, -1);
      camera.lookAt(target);
      orbit.update();
    }

    function frameSelected() {
      const object = hostObjects.get(state.selectedId);
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const direction = hostCamera.position.clone().sub(hostOrbit.target).normalize();
      const distance = Math.max(2.2, sphere.radius * 4.5);
      hostOrbit.target.copy(sphere.center);
      hostCamera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
      hostOrbit.update();
      const record = state.objects.get(state.selectedId);
      eventLabel.textContent = `Frame Selected · ${record ? record.name : 'GameObject'}`;
    }

    function getRootId(object) {
      let current = object;
      while (current) {
        if (current.userData && current.userData.tfRootId) return current.userData.tfRootId;
        current = current.parent;
      }
      return null;
    }

    function pickHostObject(event) {
      const rect = hostCanvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, hostCamera);
      const roots = [...hostObjects.values()].filter((obj) => obj.visible);
      const hits = raycaster.intersectObjects(roots, true);
      for (const hit of hits) {
        const id = getRootId(hit.object);
        if (id) return id;
      }
      return null;
    }

    function restoreNavigationAfterPointer() {
      window.setTimeout(() => {
        navOverride = false;
        transform.enabled = true;
        hostOrbit.enabled = true;
        hostOrbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        hostOrbit.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
        attachTransform();
      }, 0);
    }

    hostCanvas.addEventListener('pointerdown', (event) => {
      lab.focus({ preventScroll: true });
      hostPointerDown = { x: event.clientX, y: event.clientY, button: event.button, pointerType: event.pointerType, altKey: event.altKey };

      if (event.pointerType === 'touch') return;

      if (event.button === 0 && (event.altKey || state.tool === 'view')) {
        navOverride = true;
        transform.enabled = false;
        hostOrbit.enabled = true;
        hostOrbit.mouseButtons.LEFT = event.altKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      } else if (event.button === 0) {
        hostOrbit.enabled = false;
        transform.enabled = true;
      } else if (event.button === 1) {
        navOverride = true;
        transform.enabled = false;
        hostOrbit.enabled = true;
        hostOrbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      } else if (event.button === 2 && event.altKey) {
        navOverride = true;
        transform.enabled = false;
        hostOrbit.enabled = true;
        hostOrbit.mouseButtons.RIGHT = THREE.MOUSE.DOLLY;
      }
    }, true);

    hostCanvas.addEventListener('pointerup', (event) => {
      if (hostPointerDown && !navOverride && !transformGesture && hostPointerDown.button === 0) {
        const moved = Math.hypot(event.clientX - hostPointerDown.x, event.clientY - hostPointerDown.y);
        if (moved < 5) {
          const id = pickHostObject(event);
          if (id) selectObject(id);
        }
      }
      hostPointerDown = null;
      restoreNavigationAfterPointer();
    });

    hostCanvas.addEventListener('pointercancel', () => {
      hostPointerDown = null;
      restoreNavigationAfterPointer();
    });
    window.addEventListener('pointerup', () => {
      if (navOverride) restoreNavigationAfterPointer();
    });

    hostCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
    peerCanvas.addEventListener('contextmenu', (event) => event.preventDefault());

    transform.addEventListener('mouseDown', () => {
      transformGesture = true;
      hostOrbit.enabled = false;
      sync.textContent = 'syncing';
      peerState.textContent = 'syncing';
    });
    transform.addEventListener('objectChange', () => {
      if (state.selectedId) syncPeer(state.selectedId, `${state.tool} gizmo changed shared Transform`);
    });
    transform.addEventListener('mouseUp', () => {
      hostOrbit.enabled = true;
      sync.textContent = 'connected';
      peerState.textContent = 'synced';
      window.setTimeout(() => { transformGesture = false; }, 0);
    });

    nameInput.addEventListener('change', () => {
      const record = state.objects.get(state.selectedId);
      if (!record) return;
      const next = nameInput.value.trim().slice(0, 40);
      if (!next) {
        nameInput.value = record.name;
        return;
      }
      record.name = next;
      signal(`Renamed GameObject to ${next}`);
    });

    activeInput.addEventListener('change', () => {
      const record = state.objects.get(state.selectedId);
      const hostObject = hostObjects.get(state.selectedId);
      const peerObject = peerObjects.get(state.selectedId);
      if (!record || !hostObject || !peerObject) return;
      record.active = activeInput.checked;
      hostObject.visible = record.active;
      peerObject.visible = record.active;
      signal(`${record.name} ${record.active ? 'enabled' : 'disabled'}`);
    });

    createSelect.addEventListener('change', () => {
      if (createSelect.value) createObject(createSelect.value);
      createSelect.value = '';
    });
    duplicateButton.addEventListener('click', duplicateSelected);
    deleteButton.addEventListener('click', () => { if (state.selectedId) removeRecord(state.selectedId); });
    lockButton.addEventListener('click', () => {
      if (!state.selectedId) return;
      const record = state.objects.get(state.selectedId);
      state.lockedId = state.lockedId === state.selectedId ? null : state.selectedId;
      signal(state.lockedId ? `${record.name} locked by Editor A` : `${record.name} lock released`);
    });
    resetButton.addEventListener('click', resetScene);
    spaceButton.addEventListener('click', toggleSpace);

    document.querySelectorAll('[data-tool]').forEach((button) => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => setView(hostCamera, hostOrbit, button.dataset.view));
    });
    document.querySelectorAll('[data-peer-view]').forEach((button) => {
      button.addEventListener('click', () => setView(peerCamera, peerOrbit, button.dataset.peerView));
    });

    lab.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === 'q') setTool('view');
      else if (key === 'w') setTool('move');
      else if (key === 'e') setTool('rotate');
      else if (key === 'r') setTool('scale');
      else if (key === 'f') frameSelected();
      else if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (key === 'delete' || key === 'backspace') {
        if (state.selectedId) removeRecord(state.selectedId);
      }
    });

    function resizeRenderer(renderer, camera, canvas) {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.floor(width * pixelRatio);
      const targetHeight = Math.floor(height * pixelRatio);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeRenderer(hostRenderer, hostCamera, hostCanvas);
      resizeRenderer(peerRenderer, peerCamera, peerCanvas);
    });
    resizeObserver.observe(hostSceneEl);
    resizeObserver.observe(peerSceneEl);

    const intersectionObserver = new IntersectionObserver((entries) => {
      running = entries.some((entry) => entry.isIntersecting);
    }, { rootMargin: '300px 0px' });
    intersectionObserver.observe(demoSection);

    function animate() {
      window.requestAnimationFrame(animate);
      if (!running) return;
      resizeRenderer(hostRenderer, hostCamera, hostCanvas);
      resizeRenderer(peerRenderer, peerCamera, peerCanvas);
      hostOrbit.update();
      peerOrbit.update();
      if (peerSelectionBox) peerSelectionBox.update();
      hostRenderer.render(hostScene, hostCamera);
      peerRenderer.render(peerScene3D, peerCamera);
    }

    buildInspectorFields();
    Object.entries(DEFAULTS).forEach(([id, item]) => addRecord({ id, ...structuredClone(item), active: true }, false));
    setTool('move', false);
    selectObject('cube', false);
    renderHierarchy();
    updateInspector();
    updateMeta();
    updatePeerSelectionBox();
    sync.textContent = 'connected';
    eventLabel.textContent = 'Shared Scene ready · Unity-style controls enabled';
    animate();
  });
})();
