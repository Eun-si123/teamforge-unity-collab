(() => {
  'use strict';

  const ready = (fn) => document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn();

  ready(async () => {
    const lab = document.getElementById('collabLab');
    const demo = document.getElementById('demo');
    if (!lab || !demo) return;

    const heading = demo.querySelector('h2');
    const intro = demo.querySelector('.section-intro');
    if (heading) heading.textContent = 'A small Scene editor, built to explain the real workflow.';
    if (intro) intro.textContent = 'Both browser Editors share GameObjects, Transform changes, creation, deletion, names, and ownership — while each keeps its own Scene camera, selection, and tool state. It is an interactive illustration of TeamForge, not Unity running in the page.';

    if (!document.querySelector('link[data-teamforge-editor-v4]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './editor-demo-v4.css';
      link.dataset.teamforgeEditorV4 = 'true';
      document.head.appendChild(link);
    }

    lab.classList.add('v4');
    lab.innerHTML = `
      <div class="v4-sessionbar">
        <div class="v4-session-status" aria-live="polite">session / <span id="v4Sync">loading</span> · <span id="v4Event">Preparing miniature Scene editors</span></div>
        <div class="v4-session-actions">
          <select id="v4Create" aria-label="Create GameObject"><option value="">+ Create</option><option value="cube">Cube</option><option value="sphere">Sphere</option><option value="light">Light</option></select>
          <button class="btn" id="v4Duplicate" type="button">Duplicate</button>
          <button class="btn" id="v4Delete" type="button">Delete</button>
          <button class="btn" id="v4Lock" type="button">Lock</button>
          <button class="btn" id="v4Reset" type="button">Reset</button>
        </div>
      </div>
      <div class="v4-loading" id="v4Loading">Loading the 3D Scene controls…</div>`;

    const syncText = document.getElementById('v4Sync');
    const eventText = document.getElementById('v4Event');
    const loading = document.getElementById('v4Loading');

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
      if (!THREE || !OrbitControls || !TransformControls) throw new Error('3D controls unavailable');
    } catch (error) {
      console.error('[TeamForge demo] 3D modules failed to load', error);
      syncText.textContent = 'unavailable';
      eventText.textContent = '3D controls could not load';
      loading.className = 'v4-error';
      loading.textContent = 'The interactive browser simulation could not load its pinned 3D modules. The real TeamForge development capture below is still available.';
      return;
    }

    const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
    const stripCount = (name) => String(name).replace(/ \(\d+\)$/, '');
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const d2r = (v) => THREE.MathUtils.degToRad(v);
    const r2d = (v) => THREE.MathUtils.radToDeg(v);
    const numberOr = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;

    class SharedScene {
      constructor() { this.records = new Map(); this.listeners = new Set(); this.nextId = 1; this.reset(false); }
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
      emit(type, payload = {}) { this.listeners.forEach((fn) => fn(type, payload)); }
      defaults() { return [
        { id:'camera', name:'Main Camera', type:'camera', position:[-3.8,2.8,4.6], rotation:[18,-38,0], scale:[1,1,1], active:true, lockedBy:null },
        { id:'light', name:'Directional Light', type:'light', position:[2.2,3.8,1.6], rotation:[48,-30,0], scale:[1,1,1], active:true, lockedBy:null },
        { id:'cube', name:'Cube', type:'cube', position:[0,.5,0], rotation:[0,24,0], scale:[1,1,1], active:true, lockedBy:null }
      ]; }
      reset(announce = true) { this.records.clear(); this.nextId = 1; this.defaults().forEach((r) => this.records.set(r.id, structuredClone(r))); this.emit('reset', { announce }); }
      canEdit(record, editorId) { return !!record && (!record.lockedBy || record.lockedBy === editorId); }
      uniqueName(base, ignoreId = null) {
        const names = new Set([...this.records.values()].filter((r) => r.id !== ignoreId).map((r) => r.name));
        if (!names.has(base)) return base;
        let i = 1; while (names.has(`${base} (${i})`)) i += 1; return `${base} (${i})`;
      }
      create(type, editorId) {
        const base = type === 'cube' ? 'Cube' : type === 'sphere' ? 'Sphere' : 'Light';
        const id = `${type}-${this.nextId++}`;
        const offset = (this.nextId % 4) * .35;
        const record = { id, name:this.uniqueName(base), type, position:[offset-.5,type==='light'?2.3:.55,offset-.35], rotation:type==='light'?[40,-30,0]:[0,0,0], scale:[1,1,1], active:true, lockedBy:editorId };
        this.records.set(id, record); this.emit('structure', { id, editorId, action:'created' }); return record;
      }
      duplicate(id, editorId) {
        const src = this.records.get(id); if (!this.canEdit(src, editorId)) return null;
        const copy = structuredClone(src); copy.id = `${src.type}-${this.nextId++}`; copy.name = this.uniqueName(stripCount(src.name)); copy.position = [src.position[0]+.7,src.position[1],src.position[2]+.35]; copy.rotation = src.rotation.slice(); copy.scale = src.scale.slice(); copy.lockedBy = editorId;
        this.records.set(copy.id, copy); this.emit('structure', { id:copy.id, editorId, action:'duplicated' }); return copy;
      }
      remove(id, editorId) { const r=this.records.get(id); if(!this.canEdit(r,editorId)) return false; this.records.delete(id); this.emit('structure',{id,editorId,action:'deleted',record:r}); return true; }
      rename(id, value, editorId) { const r=this.records.get(id); if(!this.canEdit(r,editorId)) return false; const next=String(value||'').trim().slice(0,40); if(!next) return false; r.name=this.uniqueName(stripCount(next),id); this.emit('rename',{id,editorId}); return true; }
      setActive(id, active, editorId) { const r=this.records.get(id); if(!this.canEdit(r,editorId)) return false; r.active=!!active; this.emit('active',{id,editorId}); return true; }
      setTransform(id, t, editorId) { const r=this.records.get(id); if(!this.canEdit(r,editorId)) return false; r.position=t.position.slice(); r.rotation=t.rotation.slice(); r.scale=t.scale.map((v)=>Math.max(.05,v)); this.emit('transform',{id,editorId}); return true; }
      toggleLock(id, editorId) { const r=this.records.get(id); if(!r || (r.lockedBy && r.lockedBy!==editorId)) return false; r.lockedBy=r.lockedBy===editorId?null:editorId; this.emit('lock',{id,editorId}); return true; }
    }

    lab.innerHTML = `
      <div class="v4-sessionbar">
        <div class="v4-session-status" aria-live="polite">session / <span id="v4Sync">connected</span> · <span id="v4Event">Shared Scene ready</span></div>
        <div class="v4-session-actions">
          <select id="v4Create" aria-label="Create GameObject"><option value="">+ Create</option><option value="cube">Cube</option><option value="sphere">Sphere</option><option value="light">Light</option></select>
          <button class="btn" id="v4Duplicate" type="button">Duplicate</button><button class="btn" id="v4Delete" type="button">Delete</button><button class="btn" id="v4Lock" type="button">Lock</button><button class="btn" id="v4Reset" type="button">Reset</button>
        </div>
      </div>
      <div class="v4-mobile-switch" role="tablist" aria-label="Choose editor"><button type="button" data-mobile-editor="a" class="active" role="tab" aria-selected="true">Editor A</button><button type="button" data-mobile-editor="b" role="tab" aria-selected="false">Editor B</button></div>
      <div class="v4-editor-pair" data-mobile-active="a" id="v4EditorPair"></div>
      <div class="v4-lab-foot"><div><strong>Interactive browser simulation.</strong> Shared objects and ownership are mirrored; Scene cameras, selections, and tools stay local to each editor.</div><span class="mono">concept interaction · real TeamForge capture ↓</span></div>`;

    const model = new SharedScene();
    const pair = document.getElementById('v4EditorPair');
    const createSelect = document.getElementById('v4Create');
    const duplicateButton = document.getElementById('v4Duplicate');
    const deleteButton = document.getElementById('v4Delete');
    const lockButton = document.getElementById('v4Lock');
    const resetButton = document.getElementById('v4Reset');

    const site = {
      active:null, editors:new Map(), selections:new Map(), running:true,
      setActive(editor){ this.active=editor; this.editors.forEach((e)=>e.root.classList.toggle('active-editor',e===editor)); this.updateActions(); },
      setSelection(editorId,id){ this.selections.set(editorId,id); this.editors.forEach((e)=>e.updateRemoteSelection()); },
      message(text,syncing=false){ const s=document.getElementById('v4Sync'); const e=document.getElementById('v4Event'); s.textContent=syncing?'syncing':'connected'; e.textContent=text; if(syncing) requestAnimationFrame(()=>{s.textContent='connected';}); },
      updateActions(){ const e=this.active; const r=e&&e.selectedId?model.records.get(e.selectedId):null; const editable=e?model.canEdit(r,e.id):false; duplicateButton.disabled=!editable; deleteButton.disabled=!editable; lockButton.disabled=!r||!!(r.lockedBy&&e&&r.lockedBy!==e.id); lockButton.textContent=!r?'Lock':r.lockedBy===e.id?'Unlock':r.lockedBy?`Locked · ${r.lockedBy.toUpperCase()}`:'Lock'; }
    };

    const material = (color) => new THREE.MeshStandardMaterial({ color, roughness:.62, metalness:.05 });
    const markRoot = (root,id) => { root.userData.tfRootId=id; root.traverse((n)=>{n.userData.tfRootId=id;}); return root; };
    function makeVisual(record){
      let root;
      if(record.type==='cube') root=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material(0x648fba));
      else if(record.type==='sphere') root=new THREE.Mesh(new THREE.SphereGeometry(.56,32,20),material(0x7e91b2));
      else if(record.type==='light'){ root=new THREE.Group(); const core=new THREE.Mesh(new THREE.SphereGeometry(.22,18,12),material(0xe5c566)); root.add(core); const pts=[]; for(let i=0;i<8;i++){const a=Math.PI*2*i/8;pts.push(new THREE.Vector3(Math.cos(a)*.3,0,Math.sin(a)*.3),new THREE.Vector3(Math.cos(a)*.58,0,Math.sin(a)*.58));} root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xe7cb76}))); }
      else { root=new THREE.Group(); const body=new THREE.Mesh(new THREE.BoxGeometry(.55,.38,.72),material(0x52677e)); const lens=new THREE.Mesh(new THREE.CylinderGeometry(.18,.26,.34,14),material(0x7195b8)); lens.rotation.x=Math.PI/2;lens.position.z=-.48;root.add(body,lens); }
      root.traverse((n)=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}}); return markRoot(root,record.id);
    }
    function disposeVisual(root){root.traverse((n)=>{if(n.geometry)n.geometry.dispose();if(n.material){(Array.isArray(n.material)?n.material:[n.material]).forEach((m)=>m&&m.dispose&&m.dispose());}});}

    class Editor {
      constructor(id,label,cameraPos){
        this.id=id;this.label=label;this.selectedId=null;this.tool='move';this.space='world';this.objects=new Map();this.selectionBox=null;this.remoteBox=null;this.pointerDown=null;this.transformDragging=false;this.navOverride=false;
        this.build(); this.scene=this.makeWorld(); this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,powerPreference:'high-performance'}); this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); this.renderer.outputColorSpace=THREE.SRGBColorSpace; this.renderer.shadowMap.enabled=true;
        this.camera=new THREE.PerspectiveCamera(50,1,.05,100); this.camera.position.fromArray(cameraPos);
        this.orbit=new OrbitControls(this.camera,this.canvas); this.orbit.target.set(0,.6,0); this.orbit.enableDamping=true; this.orbit.dampingFactor=.08; this.orbit.minDistance=1.8; this.orbit.maxDistance=24; this.orbit.touches.ONE=THREE.TOUCH.ROTATE; this.orbit.touches.TWO=THREE.TOUCH.DOLLY_PAN; this.orbit.update();
        this.transform=new TransformControls(this.camera,this.canvas); this.transform.setMode('translate');this.transform.setSpace('world');this.transform.setSize(.82);this.scene.add(this.transform.getHelper()); this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
        this.bind();this.setTool('move',false);
      }
      build(){
        const root=document.createElement('article');root.className='v4-editor';root.dataset.editorId=this.id;root.dataset.panel='scene';root.innerHTML=`<div class="v4-editor-head"><div><strong>${escapeHtml(this.label)}</strong><span>${this.id==='a'?'Host':'Peer'} · interactive</span></div><em>camera local · scene shared</em></div><div class="v4-editor-tools"><button type="button" data-tool="view"><kbd>Q</kbd><span>View</span></button><button type="button" data-tool="move"><kbd>W</kbd><span>Move</span></button><button type="button" data-tool="rotate"><kbd>E</kbd><span>Rotate</span></button><button type="button" data-tool="scale"><kbd>R</kbd><span>Scale</span></button><button type="button" data-space>Global</button><button type="button" data-frame>Frame</button></div><div class="v4-workspace"><aside class="v4-hierarchy"><div class="v4-panel-head">Hierarchy</div><div class="v4-hierarchy-body"></div></aside><div class="v4-scene"><canvas tabindex="0" aria-label="${escapeHtml(this.label)} interactive Scene view"></canvas><div class="v4-orientation"><button type="button" data-view="top">Top</button><button type="button" data-view="front">Front</button><button type="button" data-view="right">Right</button><button type="button" data-view="iso">ISO</button></div><div class="v4-scene-hint">Alt+LMB Orbit · MMB Pan · Wheel / Alt+RMB Zoom · F Frame</div></div><aside class="v4-inspector"><div class="v4-panel-head">Inspector</div><div class="v4-inspector-body"></div></aside></div><div class="v4-mobile-panels"><button type="button" data-panel="hierarchy">Hierarchy</button><button type="button" data-panel="scene" class="active">Scene</button><button type="button" data-panel="inspector">Inspector</button></div><div class="v4-statusbar"><span>Tool <strong data-meta-tool>Move</strong></span><span>Selected <strong data-meta-selection>None</strong></span><span>Objects <strong data-meta-count>0</strong></span></div>`;
        pair.appendChild(root);this.root=root;this.canvas=root.querySelector('canvas');this.sceneEl=root.querySelector('.v4-scene');this.hierarchy=root.querySelector('.v4-hierarchy-body');this.inspector=root.querySelector('.v4-inspector-body');this.metaTool=root.querySelector('[data-meta-tool]');this.metaSelection=root.querySelector('[data-meta-selection]');this.metaCount=root.querySelector('[data-meta-count]');
      }
      makeWorld(){const s=new THREE.Scene();s.background=new THREE.Color(0x30343a);s.fog=new THREE.Fog(0x30343a,22,42);const grid=new THREE.GridHelper(30,30,0x5f6770,0x41464d);grid.material.transparent=true;grid.material.opacity=.72;s.add(grid);const axes=new THREE.AxesHelper(1.5);axes.material.transparent=true;axes.material.opacity=.72;s.add(axes,new THREE.HemisphereLight(0xbcd6ee,0x353b43,1.35));const key=new THREE.DirectionalLight(0xffffff,2.3);key.position.set(5,8,4);s.add(key);return s;}
      bind(){
        this.root.addEventListener('pointerdown',()=>site.setActive(this),true);this.root.addEventListener('focusin',()=>site.setActive(this));
        this.root.querySelectorAll('[data-tool]').forEach((b)=>b.addEventListener('click',()=>this.setTool(b.dataset.tool)));
        this.root.querySelector('[data-space]').addEventListener('click',()=>{this.space=this.space==='world'?'local':'world';this.root.querySelector('[data-space]').textContent=this.space==='world'?'Global':'Local';this.transform.setSpace(this.tool==='scale'?'local':this.space);site.message(`${this.label} handles · ${this.space==='world'?'Global':'Local'}`);});
        this.root.querySelector('[data-frame]').addEventListener('click',()=>this.frameSelected());this.root.querySelectorAll('[data-view]').forEach((b)=>b.addEventListener('click',()=>this.setView(b.dataset.view)));this.root.querySelectorAll('[data-panel]').forEach((b)=>b.addEventListener('click',()=>{this.root.dataset.panel=b.dataset.panel;this.root.querySelectorAll('[data-panel]').forEach((x)=>x.classList.toggle('active',x===b));requestAnimationFrame(()=>this.resize());}));
        this.canvas.addEventListener('contextmenu',(e)=>e.preventDefault());
        this.canvas.addEventListener('pointerdown',(e)=>{site.setActive(this);lab.focus({preventScroll:true});this.pointerDown={x:e.clientX,y:e.clientY,button:e.button};if(e.pointerType==='touch')return;if(e.button===0&&e.altKey){this.navOverride=true;this.transform.enabled=false;this.orbit.enabled=true;this.orbit.mouseButtons.LEFT=THREE.MOUSE.ROTATE;}else if(e.button===1){this.navOverride=true;this.transform.enabled=false;this.orbit.enabled=true;this.orbit.mouseButtons.MIDDLE=THREE.MOUSE.PAN;}else if(e.button===2&&e.altKey){this.navOverride=true;this.transform.enabled=false;this.orbit.enabled=true;this.orbit.mouseButtons.RIGHT=THREE.MOUSE.DOLLY;}else if(e.button===0&&this.tool!=='view')this.orbit.enabled=false;},true);
        const restore=()=>{this.navOverride=false;this.transform.enabled=true;this.orbit.enabled=true;this.configureOrbit();this.attachTransform();};
        this.canvas.addEventListener('pointerup',(e)=>{if(this.pointerDown&&!this.transformDragging&&!this.navOverride&&this.pointerDown.button===0&&Math.hypot(e.clientX-this.pointerDown.x,e.clientY-this.pointerDown.y)<6)this.select(this.pick(e),true);this.pointerDown=null;restore();});this.canvas.addEventListener('pointercancel',()=>{this.pointerDown=null;restore();});
        this.transform.addEventListener('dragging-changed',(e)=>{this.transformDragging=!!e.value;this.orbit.enabled=!e.value;if(!e.value)this.configureOrbit();});
        this.transform.addEventListener('objectChange',()=>{const r=this.selectedId?model.records.get(this.selectedId):null;const o=this.selectedId?this.objects.get(this.selectedId):null;if(!r||!o||!model.canEdit(r,this.id)){this.attachTransform();return;}model.setTransform(r.id,{position:[o.position.x,o.position.y,o.position.z],rotation:[r2d(o.rotation.x),r2d(o.rotation.y),r2d(o.rotation.z)],scale:[o.scale.x,o.scale.y,o.scale.z]},this.id);site.message(`${r.name} Transform mirrored from ${this.label}`,true);});
      }
      configureOrbit(){this.orbit.mouseButtons.LEFT=this.tool==='view'?THREE.MOUSE.ROTATE:null;this.orbit.mouseButtons.MIDDLE=THREE.MOUSE.PAN;this.orbit.mouseButtons.RIGHT=THREE.MOUSE.DOLLY;}
      applyRecord(r){let o=this.objects.get(r.id);if(!o){o=makeVisual(r);this.objects.set(r.id,o);this.scene.add(o);}o.position.fromArray(r.position);o.rotation.set(d2r(r.rotation[0]),d2r(r.rotation[1]),d2r(r.rotation[2]),'XYZ');o.scale.fromArray(r.scale);o.visible=r.active!==false;o.updateMatrixWorld(true);}
      removeVisual(id){const o=this.objects.get(id);if(!o)return;if(this.selectedId===id)this.transform.detach();this.scene.remove(o);disposeVisual(o);this.objects.delete(id);}
      syncAll(){for(const[id]of this.objects)if(!model.records.has(id))this.removeVisual(id);model.records.forEach((r)=>this.applyRecord(r));if(this.selectedId&&!model.records.has(this.selectedId))this.selectedId=null;this.renderHierarchy();this.renderInspector();this.attachTransform();this.updateHelpers();this.updateMeta();}
      onModel(type,p){if(type==='reset'||type==='structure'){this.syncAll();return;}if(p.id){const r=model.records.get(p.id);if(r)this.applyRecord(r);else this.removeVisual(p.id);}if(type==='rename'||type==='lock'||type==='active')this.renderHierarchy();if(this.selectedId===p.id||type==='lock')this.renderInspector(true);this.attachTransform();this.updateHelpers();this.updateMeta();}
      renderHierarchy(){const remote=[...site.selections.entries()].find(([eid])=>eid!==this.id)?.[1]||null;this.hierarchy.innerHTML='<div class="v4-scene-row">▾ SampleScene</div>'+[...model.records.values()].map((r)=>`<button type="button" class="v4-object-row${r.id===this.selectedId?' selected':''}${r.id===remote?' remote-selected':''}${r.lockedBy?' locked':''}" data-object-id="${r.id}"><span class="v4-object-icon ${r.type}"></span><span class="v4-object-name">${escapeHtml(r.name)}</span>${r.lockedBy?`<span class="v4-lock-chip">${r.lockedBy.toUpperCase()}</span>`:''}</button>`).join('');this.hierarchy.querySelectorAll('[data-object-id]').forEach((b)=>b.addEventListener('click',()=>this.select(b.dataset.objectId,true)));}
      renderInspector(soft=false){const r=this.selectedId?model.records.get(this.selectedId):null;if(!r){this.inspector.innerHTML='<div class="v4-empty">Nothing selected.</div>';return;}if(soft&&this.inspector.dataset.objectId===r.id){this.fillTransformInputs();this.updateInspectorDisabled();return;}this.inspector.dataset.objectId=r.id;this.inspector.innerHTML=`<div class="v4-name-line"><input type="checkbox" data-active ${r.active!==false?'checked':''} aria-label="GameObject active"><input type="text" data-name value="${escapeHtml(r.name)}" aria-label="GameObject name"></div><div class="v4-component"><div class="v4-component-head">Transform</div>${['position','rotation','scale'].map((prop)=>`<div class="v4-transform-row"><span>${prop[0].toUpperCase()+prop.slice(1)}</span>${['x','y','z'].map((axis)=>`<label class="${axis}"><b>${axis.toUpperCase()}</b><input type="number" step="0.1" data-prop="${prop}" data-axis="${axis}"></label>`).join('')}</div>`).join('')}</div><div class="v4-owner"><strong>TeamForge</strong><span>${r.lockedBy?`Owner · Editor ${r.lockedBy.toUpperCase()}`:'Owner · shared'}</span><span>Type · ${escapeHtml(r.type)}</span></div>`;this.fillTransformInputs();const active=this.inspector.querySelector('[data-active]');const name=this.inspector.querySelector('[data-name]');active.addEventListener('change',()=>model.setActive(r.id,active.checked,this.id));name.addEventListener('change',()=>{if(!model.rename(r.id,name.value,this.id))name.value=r.name;});this.inspector.querySelectorAll('input[data-prop]').forEach((input)=>input.addEventListener('change',()=>this.commitInspector(r,input)));this.updateInspectorDisabled();}
      fillTransformInputs(){const r=this.selectedId?model.records.get(this.selectedId):null;const o=this.selectedId?this.objects.get(this.selectedId):null;if(!r||!o)return;const vals={position:[o.position.x,o.position.y,o.position.z],rotation:[r2d(o.rotation.x),r2d(o.rotation.y),r2d(o.rotation.z)],scale:[o.scale.x,o.scale.y,o.scale.z]};this.inspector.querySelectorAll('input[data-prop]').forEach((input)=>{if(document.activeElement===input)return;const i=['x','y','z'].indexOf(input.dataset.axis);input.value=vals[input.dataset.prop][i].toFixed(input.dataset.prop==='rotation'?1:2);});}
      commitInspector(r,input){const o=this.objects.get(r.id);if(!o||!model.canEdit(r,this.id))return;const i=['x','y','z'].indexOf(input.dataset.axis);const prop=input.dataset.prop;if(prop==='position')o.position.setComponent(i,clamp(numberOr(input.value,o.position.getComponent(i)),-20,20));else if(prop==='rotation'){const v=[r2d(o.rotation.x),r2d(o.rotation.y),r2d(o.rotation.z)];v[i]=clamp(numberOr(input.value,v[i]),-360,360);o.rotation.set(d2r(v[0]),d2r(v[1]),d2r(v[2]),'XYZ');}else o.scale.setComponent(i,clamp(numberOr(input.value,o.scale.getComponent(i)),.05,10));model.setTransform(r.id,{position:[o.position.x,o.position.y,o.position.z],rotation:[r2d(o.rotation.x),r2d(o.rotation.y),r2d(o.rotation.z)],scale:[o.scale.x,o.scale.y,o.scale.z]},this.id);site.message(`${r.name} ${prop} edited in ${this.label}`,true);}
      updateInspectorDisabled(){const r=this.selectedId?model.records.get(this.selectedId):null;const disabled=!r||!model.canEdit(r,this.id);this.inspector.querySelectorAll('input').forEach((i)=>{i.disabled=disabled;});}
      select(id,announce=false){this.selectedId=id&&model.records.has(id)?id:null;site.setActive(this);site.setSelection(this.id,this.selectedId);this.renderHierarchy();this.renderInspector();this.attachTransform();this.updateHelpers();this.updateMeta();if(announce){const r=this.selectedId?model.records.get(this.selectedId):null;site.message(r?`${this.label} selected ${r.name}`:`${this.label} cleared selection`);}}
      updateRemoteSelection(){this.renderHierarchy();this.updateHelpers();}
      attachTransform(){const r=this.selectedId?model.records.get(this.selectedId):null;const o=this.selectedId?this.objects.get(this.selectedId):null;if(!r||!o||this.tool==='view'||!model.canEdit(r,this.id)){this.transform.detach();return;}this.transform.attach(o);this.transform.setMode(this.tool==='move'?'translate':this.tool);this.transform.setSpace(this.tool==='scale'?'local':this.space);}
      setTool(tool,announce=true){this.tool=tool;this.configureOrbit();this.root.querySelectorAll('[data-tool]').forEach((b)=>{b.dataset.active=String(b.dataset.tool===tool);});this.attachTransform();this.metaTool.textContent=tool[0].toUpperCase()+tool.slice(1);if(announce)site.message(`${this.label} · ${tool[0].toUpperCase()+tool.slice(1)} tool`);}
      setView(view){const t=this.orbit.target.clone();const d=Math.max(3,this.camera.position.distanceTo(t));const offsets={front:new THREE.Vector3(0,0,d),right:new THREE.Vector3(d,0,0),top:new THREE.Vector3(0,d,.0001),iso:new THREE.Vector3(d*.68,d*.52,d*.68)};this.camera.position.copy(t).add(offsets[view]||offsets.iso);this.camera.up.set(0,1,0);if(view==='top')this.camera.up.set(0,0,-1);this.camera.lookAt(t);this.orbit.update();site.message(`${this.label} camera · ${view}`);}
      frameSelected(){const o=this.selectedId?this.objects.get(this.selectedId):null;if(!o)return;const box=new THREE.Box3().setFromObject(o);if(box.isEmpty())return;const sphere=box.getBoundingSphere(new THREE.Sphere());const dir=this.camera.position.clone().sub(this.orbit.target).normalize();this.orbit.target.copy(sphere.center);this.camera.position.copy(sphere.center).add(dir.multiplyScalar(Math.max(2.2,sphere.radius*4.5)));this.orbit.update();}
      pick(e){const rect=this.canvas.getBoundingClientRect();this.pointer.x=((e.clientX-rect.left)/rect.width)*2-1;this.pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;this.raycaster.setFromCamera(this.pointer,this.camera);for(const hit of this.raycaster.intersectObjects([...this.objects.values()].filter((o)=>o.visible),true)){let cur=hit.object;while(cur){if(cur.userData&&cur.userData.tfRootId)return cur.userData.tfRootId;cur=cur.parent;}}return null;}
      updateHelpers(){if(this.selectionBox){this.scene.remove(this.selectionBox);this.selectionBox.geometry.dispose();this.selectionBox.material.dispose();this.selectionBox=null;}if(this.remoteBox){this.scene.remove(this.remoteBox);this.remoteBox.geometry.dispose();this.remoteBox.material.dispose();this.remoteBox=null;}const own=this.selectedId?this.objects.get(this.selectedId):null;if(own&&own.visible){const r=model.records.get(this.selectedId);this.selectionBox=new THREE.BoxHelper(own,r&&r.lockedBy&&r.lockedBy!==this.id?0xe7c982:0x9bd0ff);this.scene.add(this.selectionBox);}const remote=[...site.selections.entries()].find(([eid])=>eid!==this.id)?.[1]||null;if(remote&&remote!==this.selectedId){const obj=this.objects.get(remote);if(obj&&obj.visible){this.remoteBox=new THREE.BoxHelper(obj,0x6db7ff);this.scene.add(this.remoteBox);}}}
      updateMeta(){const r=this.selectedId?model.records.get(this.selectedId):null;this.metaTool.textContent=this.tool[0].toUpperCase()+this.tool.slice(1);this.metaSelection.textContent=r?r.name:'None';this.metaCount.textContent=String(model.records.size);site.updateActions();}
      resize(){const w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight),pr=Math.min(window.devicePixelRatio||1,2);if(this.canvas.width!==Math.floor(w*pr)||this.canvas.height!==Math.floor(h*pr)){this.renderer.setPixelRatio(pr);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}}
      render(){this.orbit.update();if(this.selectionBox)this.selectionBox.update();if(this.remoteBox)this.remoteBox.update();this.renderer.render(this.scene,this.camera);}
    }

    const editorA=new Editor('a','Editor A · Eun',[6.4,4.8,7.2]);const editorB=new Editor('b','Editor B · Peer',[-6.2,4.1,6.4]);site.editors.set('a',editorA);site.editors.set('b',editorB);site.setActive(editorA);
    const unsubscribe=model.subscribe((type,payload)=>{site.editors.forEach((e)=>e.onModel(type,payload));site.updateActions();});site.editors.forEach((e)=>e.syncAll());editorA.select('cube');editorB.select('cube');site.setActive(editorA);site.message('Shared Scene ready · both editors are interactive');

    createSelect.addEventListener('change',()=>{if(!createSelect.value)return;const e=site.active||editorA;const r=model.create(createSelect.value,e.id);e.select(r.id);site.message(`${r.name} created in ${e.label} and mirrored`);createSelect.value='';});
    duplicateButton.addEventListener('click',()=>{const e=site.active||editorA;if(!e.selectedId)return;const r=model.duplicate(e.selectedId,e.id);if(r){e.select(r.id);site.message(`${r.name} duplicated in ${e.label} and mirrored`);}});
    deleteButton.addEventListener('click',()=>{const e=site.active||editorA;const r=e.selectedId?model.records.get(e.selectedId):null;if(r&&model.remove(r.id,e.id)){e.select(null);site.message(`${r.name} deleted in ${e.label} and mirrored`);}});
    lockButton.addEventListener('click',()=>{const e=site.active||editorA;const r=e.selectedId?model.records.get(e.selectedId):null;if(r&&model.toggleLock(r.id,e.id)){const u=model.records.get(r.id);site.message(u.lockedBy?`${u.name} locked by ${e.label}`:`${u.name} lock released by ${e.label}`);}});
    resetButton.addEventListener('click',()=>{model.reset();site.selections.clear();editorA.selectedId=null;editorB.selectedId=null;site.editors.forEach((e)=>e.syncAll());editorA.camera.position.set(6.4,4.8,7.2);editorB.camera.position.set(-6.2,4.1,6.4);editorA.orbit.target.set(0,.6,0);editorB.orbit.target.set(0,.6,0);editorA.select('cube');editorB.select('cube');site.setActive(editorA);site.message('Demo reset · shared Scene restored');});

    document.querySelectorAll('[data-mobile-editor]').forEach((b)=>b.addEventListener('click',()=>{pair.dataset.mobileActive=b.dataset.mobileEditor;document.querySelectorAll('[data-mobile-editor]').forEach((x)=>{const active=x===b;x.classList.toggle('active',active);x.setAttribute('aria-selected',String(active));});site.setActive(site.editors.get(b.dataset.mobileEditor));requestAnimationFrame(()=>site.editors.get(b.dataset.mobileEditor).resize());}));
    lab.addEventListener('keydown',(event)=>{const t=event.target;if(t instanceof HTMLInputElement||t instanceof HTMLSelectElement||t instanceof HTMLTextAreaElement||t.isContentEditable)return;const e=site.active||editorA;const k=event.key.toLowerCase();if(k==='q')e.setTool('view');else if(k==='w')e.setTool('move');else if(k==='e')e.setTool('rotate');else if(k==='r')e.setTool('scale');else if(k==='f')e.frameSelected();else if((event.ctrlKey||event.metaKey)&&k==='d'){event.preventDefault();duplicateButton.click();}else if(k==='delete'||k==='backspace'){event.preventDefault();deleteButton.click();}else return;event.preventDefault();});

    const resizeObserver=new ResizeObserver(()=>site.editors.forEach((e)=>e.resize()));site.editors.forEach((e)=>{resizeObserver.observe(e.sceneEl);e.resize();});const intersectionObserver=new IntersectionObserver((entries)=>{site.running=entries.some((entry)=>entry.isIntersecting);},{rootMargin:'300px 0px'});intersectionObserver.observe(demo);
    function animate(){requestAnimationFrame(animate);if(!site.running)return;site.editors.forEach((e)=>e.render());}animate();
    window.addEventListener('beforeunload',()=>{unsubscribe();resizeObserver.disconnect();intersectionObserver.disconnect();},{once:true});
  });
})();
