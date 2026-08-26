(() => {
  'use strict';

  const onReady = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  onReady(() => {
    const lab = document.getElementById('collabLab');
    const demoSection = document.getElementById('demo');
    if (!lab || !demoSection) return;

    const heading = demoSection.querySelector('h2');
    const intro = demoSection.querySelector('.section-intro');
    if (heading) heading.textContent = 'A tiny Scene view, not a moving square.';
    if (intro) {
      intro.textContent = 'Orbit the camera, zoom, add primitives, select them in Hierarchy, move them, edit Transform values, and watch the shared Scene state appear in Editor B. This is still a browser illustration of the collaboration model — not Unity running in the page.';
    }

    const style = document.createElement('style');
    style.textContent = `
      .collab-lab.v2 { background:#17191c; }
      .collab-lab.v2 .lab-toolbar { align-items:center; }
      .collab-lab.v2 .lab-status { min-width:0; }
      .demo-toolstrip { display:flex; flex-wrap:wrap; gap:.38rem; align-items:center; }
      .demo-toolstrip .btn { min-height:30px; padding:.35rem .56rem; font-size:.68rem; }
      .demo-toolstrip .btn[data-active="true"] { border-color:var(--accent); color:var(--accent-soft); background:#243747; }
      .demo-toolstrip .danger:hover { border-color:var(--danger); color:#ffc2c2; }
      .demo-divider { width:1px; height:22px; background:var(--line); margin:0 .15rem; }
      .editor-pair.v2 { align-items:stretch; }
      .editor-pair.v2 .mini-editor { display:flex; flex-direction:column; min-height:500px; }
      .editor-pair.v2 .mini-body { flex:1; min-height:0; grid-template-columns:142px minmax(0,1fr) 154px; }
      .editor-pair.v2 .mini-editor.peer .mini-body { grid-template-columns:126px minmax(0,1fr); }
      .demo-hierarchy { padding:.45rem .4rem; border-right:1px solid #17191c; background:#23262a; overflow:auto; }
      .demo-hierarchy .label, .demo-inspector .label { padding:.28rem .38rem; color:#737981; font:.58rem var(--mono); text-transform:uppercase; letter-spacing:.04em; }
      .demo-hierarchy button { width:100%; display:flex; align-items:center; gap:.38rem; border:0; background:transparent; color:#b9bec5; text-align:left; padding:.34rem .4rem; font-size:.66rem; cursor:pointer; }
      .demo-hierarchy button:hover { background:#2b3036; }
      .demo-hierarchy button.selected { background:#355a7a; color:#fff; }
      .demo-hierarchy .obj-icon { width:9px; height:9px; flex:0 0 9px; border:1px solid currentColor; opacity:.8; }
      .demo-hierarchy .obj-icon.sphere { border-radius:50%; }
      .demo-hierarchy .obj-icon.light { transform:rotate(45deg); border-color:#e9ca71; }
      .demo-hierarchy .obj-icon.camera { border-radius:1px; border-color:#8db3de; }
      .demo-scene { position:relative; min-width:0; background:#2e3339; overflow:hidden; touch-action:none; }
      .demo-scene canvas { display:block; width:100%; height:100%; min-height:390px; cursor:grab; touch-action:none; }
      .demo-scene[data-mode="move"] canvas { cursor:crosshair; }
      .demo-scene canvas:active { cursor:grabbing; }
      .scene-badge { position:absolute; left:.58rem; top:.48rem; z-index:2; pointer-events:none; color:#858c94; font:.58rem var(--mono); text-shadow:0 1px 0 #1b1d21; }
      .axis-gizmo { position:absolute; right:.55rem; top:.5rem; z-index:2; width:42px; height:42px; pointer-events:none; font:.52rem var(--mono); color:#9ea4ac; }
      .axis-gizmo i { position:absolute; left:20px; top:19px; width:18px; height:1px; transform-origin:left center; background:#d46d6d; }
      .axis-gizmo i:nth-child(2) { background:#78b477; transform:rotate(-90deg); }
      .axis-gizmo i:nth-child(3) { background:#6fa9e4; transform:rotate(35deg); }
      .axis-gizmo b { position:absolute; font-weight:600; }
      .axis-gizmo .x { right:0; top:15px; color:#e08282; }
      .axis-gizmo .y { left:17px; top:0; color:#8ccc8b; }
      .axis-gizmo .z { right:3px; bottom:1px; color:#83b7eb; }
      .demo-inspector { padding:.45rem; border-left:1px solid #17191c; background:#23262a; color:#adb2b9; overflow:auto; }
      .demo-inspector .name { padding:.38rem .38rem .55rem; margin-bottom:.4rem; border-bottom:1px solid #3a3e44; color:#e1e3e7; font-size:.68rem; font-weight:650; overflow:hidden; text-overflow:ellipsis; }
      .demo-field { display:grid; grid-template-columns:14px minmax(0,1fr); gap:.25rem; align-items:center; margin:.24rem .28rem; color:#868d96; font:.6rem var(--mono); }
      .demo-field input { width:100%; min-width:0; height:24px; padding:0 .3rem; border:1px solid #3d4249; border-radius:2px; background:#1b1d21; color:#d5d9de; font:.61rem var(--mono); }
      .demo-field input:disabled { color:#6f757d; background:#202226; }
      .demo-inspector .component { margin:.55rem .28rem 0; padding-top:.55rem; border-top:1px solid #3a3e44; color:#d0d3d8; font:.6rem var(--mono); }
      .demo-inspector .owner { margin:.35rem .28rem; padding:.32rem .38rem; border:1px solid #3d4249; background:#1b1d21; color:#c4c9cf; font:.58rem var(--mono); }
      .demo-inspector .hint { margin:.6rem .28rem; color:#777e87; font:.56rem/1.55 var(--mono); }
      .editor-meta { display:grid; grid-template-columns:repeat(3,1fr); border-top:1px solid #17191c; }
      .editor-meta div { min-width:0; padding:.48rem .55rem; color:#7f8790; font:.58rem var(--mono); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .editor-meta div + div { border-left:1px solid #17191c; }
      .editor-meta b { color:#cfd4da; font-weight:500; }
      .peer-lock-note { position:absolute; right:.55rem; bottom:.5rem; padding:.24rem .38rem; border:1px solid #7d6842; background:rgba(43,36,24,.85); color:#e7c982; font:.56rem var(--mono); pointer-events:none; display:none; }
      .demo-scene.locked .peer-lock-note { display:block; }
      .lab-foot.v2 { align-items:start; }
      .lab-foot.v2 .controls-help { display:flex; flex-wrap:wrap; gap:.5rem 1.1rem; }
      .lab-foot.v2 kbd { padding:.08rem .25rem; border:1px solid #444a52; border-bottom-color:#2b2f34; border-radius:2px; background:#23262b; color:#c7ccd2; font:.56rem var(--mono); }
      @media (max-width:1000px) {
        .editor-pair.v2 { grid-template-columns:1fr; }
        .editor-pair.v2 .mini-editor + .mini-editor { border-left:0; border-top:1px solid var(--line-strong); }
      }
      @media (max-width:720px) {
        .collab-lab.v2 .lab-toolbar { align-items:flex-start; flex-direction:column; }
        .demo-toolstrip { width:100%; }
        .demo-toolstrip .btn { flex:0 0 auto; }
        .editor-pair.v2 .mini-editor { min-height:430px; }
        .editor-pair.v2 .mini-body { grid-template-columns:104px minmax(0,1fr); }
        .editor-pair.v2 .mini-editor.host .demo-inspector { grid-column:1 / -1; border-left:0; border-top:1px solid #17191c; display:grid; grid-template-columns:120px repeat(3,minmax(0,1fr)); gap:.2rem .35rem; align-items:center; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .label { display:none; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .name { margin:0; border-bottom:0; padding:.3rem; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .component { display:none; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .demo-field { margin:.1rem 0; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .owner,
        .editor-pair.v2 .mini-editor.host .demo-inspector .hint { display:none; }
        .demo-scene canvas { min-height:330px; }
      }
      @media (max-width:480px) {
        .editor-pair.v2 .mini-body, .editor-pair.v2 .mini-editor.peer .mini-body { grid-template-columns:86px minmax(0,1fr); }
        .demo-hierarchy button { padding:.3rem .28rem; font-size:.61rem; }
        .demo-scene canvas { min-height:300px; }
        .editor-meta { grid-template-columns:1fr 1fr; }
        .editor-meta div:last-child { display:none; }
        .editor-pair.v2 .mini-editor.host .demo-inspector { grid-template-columns:1fr 1fr 1fr; }
        .editor-pair.v2 .mini-editor.host .demo-inspector .name { grid-column:1 / -1; }
      }
    `;
    document.head.appendChild(style);

    lab.classList.add('v2');
    lab.innerHTML = `
      <div class="lab-toolbar">
        <div class="lab-status" aria-live="polite">session / <span id="v2SyncState">connected</span> · <span id="v2EventText">Shared Scene ready</span></div>
        <div class="demo-toolstrip" aria-label="Mini Scene controls">
          <button class="btn" type="button" id="modeOrbit" data-active="true">Orbit</button>
          <button class="btn" type="button" id="modeMove" data-active="false">Move</button>
          <span class="demo-divider" aria-hidden="true"></span>
          <button class="btn" type="button" id="addCube">+ Cube</button>
          <button class="btn" type="button" id="addSphere">+ Sphere</button>
          <button class="btn" type="button" id="addLight">+ Light</button>
          <button class="btn danger" type="button" id="deleteObject">Delete</button>
          <span class="demo-divider" aria-hidden="true"></span>
          <button class="btn" type="button" id="zoomIn" aria-label="Zoom in">Zoom +</button>
          <button class="btn" type="button" id="zoomOut" aria-label="Zoom out">Zoom −</button>
          <button class="btn" type="button" id="lockObject" data-active="false">Lock</button>
          <button class="btn" type="button" id="resetV2">Reset</button>
        </div>
      </div>
      <div class="editor-pair v2">
        <article class="mini-editor host">
          <div class="mini-head"><strong>Editor A · Eun</strong><span>Host · interactive</span></div>
          <div class="mini-body">
            <aside class="demo-hierarchy" id="hostHierarchy"><div class="label">Hierarchy</div></aside>
            <div class="demo-scene" id="hostSceneV2" data-mode="orbit">
              <span class="scene-badge" id="hostSceneBadge">Scene · Orbit mode</span>
              <span class="axis-gizmo" aria-hidden="true"><i></i><i></i><i></i><b class="x">X</b><b class="y">Y</b><b class="z">Z</b></span>
              <canvas id="hostCanvas" aria-label="Interactive 3D Scene illustration. Drag to orbit the camera or switch to Move mode to reposition the selected object."></canvas>
            </div>
            <aside class="demo-inspector" id="hostInspector">
              <div class="label">Inspector</div>
              <div class="name" id="inspectorName">Cube</div>
              <div class="component">Transform / Position</div>
              <label class="demo-field"><span>X</span><input id="fieldX" type="number" step="0.1"></label>
              <label class="demo-field"><span>Y</span><input id="fieldY" type="number" step="0.1"></label>
              <label class="demo-field"><span>Z</span><input id="fieldZ" type="number" step="0.1"></label>
              <div class="component">TeamForge</div>
              <div class="owner" id="ownerField">Owner · shared</div>
              <div class="hint">Orbit mode: drag the Scene.<br>Move mode: drag a selected object on the X/Z plane.<br>Wheel or Zoom buttons change camera distance.</div>
            </aside>
          </div>
          <div class="editor-meta"><div>Camera <b id="cameraMeta">35° / 24°</b></div><div>Selected <b id="selectedMeta">Cube</b></div><div>Objects <b id="objectCountMeta">2</b></div></div>
        </article>

        <article class="mini-editor peer">
          <div class="mini-head"><strong>Editor B · Peer</strong><span id="peerModeV2">Guest · following</span></div>
          <div class="mini-body">
            <aside class="demo-hierarchy" id="peerHierarchy"><div class="label">Hierarchy</div></aside>
            <div class="demo-scene" id="peerSceneV2" data-mode="follow">
              <span class="scene-badge">Scene · shared state</span>
              <span class="axis-gizmo" aria-hidden="true"><i></i><i></i><i></i><b class="x">X</b><b class="y">Y</b><b class="z">Z</b></span>
              <canvas id="peerCanvas" aria-label="Peer Scene illustration showing synchronized objects."></canvas>
              <span class="peer-lock-note">Selected object owned by Editor A</span>
            </div>
          </div>
          <div class="editor-meta"><div>View <b>independent</b></div><div>State <b id="peerStateMeta">synced</b></div><div>Objects <b id="peerObjectCountMeta">2</b></div></div>
        </article>
      </div>
      <div class="lab-foot v2"><span class="controls-help"><span><strong>Try it:</strong> orbit, zoom, add primitives, select one, switch to Move, then drag it.</span><span><kbd>Orbit</kbd> camera is local; Scene objects are mirrored to the peer.</span></span><span class="mono">browser simulation · real capture ↓</span></div>
    `;

    const $ = (id) => document.getElementById(id);
    const hostCanvas = $('hostCanvas');
    const peerCanvas = $('peerCanvas');
    const hostScene = $('hostSceneV2');
    const peerScene = $('peerSceneV2');
    const hostHierarchy = $('hostHierarchy');
    const peerHierarchy = $('peerHierarchy');
    const eventText = $('v2EventText');
    const syncState = $('v2SyncState');
    const peerMode = $('peerModeV2');
    const peerStateMeta = $('peerStateMeta');
    const modeOrbit = $('modeOrbit');
    const modeMove = $('modeMove');
    const lockButton = $('lockObject');
    const sceneBadge = $('hostSceneBadge');
    const inspectorName = $('inspectorName');
    const ownerField = $('ownerField');
    const fields = { x: $('fieldX'), y: $('fieldY'), z: $('fieldZ') };
    const cameraMeta = $('cameraMeta');
    const selectedMeta = $('selectedMeta');
    const objectCountMeta = $('objectCountMeta');
    const peerObjectCountMeta = $('peerObjectCountMeta');

    if (!hostCanvas || !peerCanvas) return;

    const initialObjects = () => [
      { id: 'light-1', type: 'light', name: 'Directional Light', pos: { x: -2.2, y: 2.8, z: -1.4 }, size: .7 },
      { id: 'cube-1', type: 'cube', name: 'Cube', pos: { x: 0, y: .65, z: 0 }, size: 1.3 }
    ];

    let objects = initialObjects();
    let selectedId = 'cube-1';
    let mode = 'orbit';
    let locked = false;
    let sequence = 2;
    let drag = null;
    let syncTimer = 0;
    const hostCamera = { yaw: .62, pitch: .42, distance: 7.2, target: { x: 0, y: .55, z: 0 } };
    const peerCamera = { yaw: -.62, pitch: .34, distance: 7.8, target: { x: 0, y: .45, z: 0 } };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const selected = () => objects.find((o) => o.id === selectedId) || null;
    const vec = (x=0,y=0,z=0) => ({x,y,z});
    const sub = (a,b) => vec(a.x-b.x, a.y-b.y, a.z-b.z);
    const dot = (a,b) => a.x*b.x + a.y*b.y + a.z*b.z;
    const cross = (a,b) => vec(a.y*b.z-a.z*b.y, a.z*b.x-a.x*b.z, a.x*b.y-a.y*b.x);
    const len = (a) => Math.hypot(a.x,a.y,a.z) || 1;
    const norm = (a) => { const l=len(a); return vec(a.x/l,a.y/l,a.z/l); };

    function cameraPosition(camera) {
      const cp = Math.cos(camera.pitch);
      return vec(
        camera.target.x + camera.distance * cp * Math.sin(camera.yaw),
        camera.target.y + camera.distance * Math.sin(camera.pitch),
        camera.target.z + camera.distance * cp * Math.cos(camera.yaw)
      );
    }

    function cameraBasis(camera) {
      const pos = cameraPosition(camera);
      const forward = norm(sub(camera.target, pos));
      let right = norm(cross(forward, vec(0,1,0)));
      if (!Number.isFinite(right.x)) right = vec(1,0,0);
      const up = norm(cross(right, forward));
      return { pos, forward, right, up };
    }

    function project(point, camera, width, height) {
      const basis = cameraBasis(camera);
      const rel = sub(point, basis.pos);
      const z = dot(rel, basis.forward);
      if (z <= .08) return null;
      const focal = Math.min(width, height) * .92;
      return {
        x: width * .5 + dot(rel, basis.right) * focal / z,
        y: height * .52 - dot(rel, basis.up) * focal / z,
        z,
        scale: focal / z
      };
    }

    function setupCanvas(canvas) {
      const rect = canvas.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      return { ctx, width: rect.width, height: rect.height };
    }

    function line(ctx, a, b, color, width=1) {
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);
      ctx.lineTo(b.x,b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    function drawGrid(ctx, camera, width, height) {
      ctx.fillStyle = '#30353b';
      ctx.fillRect(0,0,width,height);
      const minor = 'rgba(255,255,255,.045)';
      const major = 'rgba(255,255,255,.085)';
      for (let i=-5;i<=5;i++) {
        const c = i === 0 ? major : minor;
        line(ctx, project(vec(i,0,-5),camera,width,height), project(vec(i,0,5),camera,width,height), c, i===0?1.2:1);
        line(ctx, project(vec(-5,0,i),camera,width,height), project(vec(5,0,i),camera,width,height), c, i===0?1.2:1);
      }
      line(ctx, project(vec(-5,.01,0),camera,width,height), project(vec(5,.01,0),camera,width,height), 'rgba(211,94,94,.42)', 1.2);
      line(ctx, project(vec(0,.01,-5),camera,width,height), project(vec(0,.01,5),camera,width,height), 'rgba(80,140,220,.48)', 1.2);
    }

    const cubeFaces = [
      [0,1,3,2], [4,6,7,5], [0,4,5,1], [2,3,7,6], [0,2,6,4], [1,5,7,3]
    ];

    function cubeVertices(o) {
      const h = o.size * .5;
      const p = o.pos;
      return [
        vec(p.x-h,p.y-h,p.z-h), vec(p.x-h,p.y-h,p.z+h),
        vec(p.x-h,p.y+h,p.z-h), vec(p.x-h,p.y+h,p.z+h),
        vec(p.x+h,p.y-h,p.z-h), vec(p.x+h,p.y-h,p.z+h),
        vec(p.x+h,p.y+h,p.z-h), vec(p.x+h,p.y+h,p.z+h)
      ];
    }

    function drawCube(ctx, o, camera, width, height, isSelected, isPeer) {
      const pts3 = cubeVertices(o);
      const pts = pts3.map((p) => project(p,camera,width,height));
      if (pts.some((p)=>!p)) return;
      const faces = cubeFaces.map((face, index) => ({
        face,
        index,
        depth: face.reduce((s,i)=>s+pts[i].z,0)/face.length
      })).sort((a,b)=>b.depth-a.depth);
      const fills = isPeer
        ? ['rgba(98,151,204,.14)','rgba(98,151,204,.18)','rgba(98,151,204,.12)','rgba(98,151,204,.16)','rgba(98,151,204,.11)','rgba(98,151,204,.2)']
        : ['rgba(109,183,255,.16)','rgba(109,183,255,.23)','rgba(109,183,255,.13)','rgba(109,183,255,.19)','rgba(109,183,255,.12)','rgba(109,183,255,.26)'];
      for (const f of faces) {
        ctx.beginPath();
        const first = pts[f.face[0]];
        ctx.moveTo(first.x,first.y);
        for (let j=1;j<f.face.length;j++) ctx.lineTo(pts[f.face[j]].x,pts[f.face[j]].y);
        ctx.closePath();
        ctx.fillStyle = fills[f.index];
        ctx.fill();
        ctx.strokeStyle = isSelected ? (locked ? '#e6b86f' : '#dcecff') : 'rgba(205,214,223,.55)';
        ctx.lineWidth = isSelected ? 1.8 : 1;
        ctx.stroke();
      }
      if (isSelected) drawMoveGizmo(ctx,o,camera,width,height);
    }

    function drawSphere(ctx, o, camera, width, height, isSelected, isPeer) {
      const p = project(o.pos,camera,width,height);
      if (!p) return;
      const radius = Math.max(4, o.size * .52 * p.scale);
      const grad = ctx.createRadialGradient(p.x-radius*.35,p.y-radius*.4,radius*.1,p.x,p.y,radius);
      grad.addColorStop(0,isPeer?'rgba(188,220,246,.72)':'rgba(209,234,255,.86)');
      grad.addColorStop(.42,isPeer?'rgba(83,143,197,.5)':'rgba(80,153,217,.62)');
      grad.addColorStop(1,'rgba(29,54,75,.22)');
      ctx.beginPath();
      ctx.arc(p.x,p.y,radius,0,Math.PI*2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = isSelected ? (locked ? '#e6b86f' : '#e5f2ff') : 'rgba(204,218,230,.58)';
      ctx.lineWidth = isSelected?1.8:1;
      ctx.stroke();
      if (isSelected) drawMoveGizmo(ctx,o,camera,width,height);
    }

    function drawLight(ctx, o, camera, width, height, isSelected) {
      const p = project(o.pos,camera,width,height);
      if (!p) return;
      const r = clamp(o.size * p.scale * .32, 6, 17);
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(Math.PI/4);
      ctx.fillStyle = 'rgba(236,203,105,.3)';
      ctx.strokeStyle = isSelected ? '#ffe395' : 'rgba(236,203,105,.8)';
      ctx.lineWidth = isSelected?1.8:1;
      ctx.fillRect(-r/2,-r/2,r,r);
      ctx.strokeRect(-r/2,-r/2,r,r);
      ctx.restore();
      ctx.strokeStyle = 'rgba(236,203,105,.7)';
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4;
        ctx.beginPath();
        ctx.moveTo(p.x+Math.cos(a)*r*.8,p.y+Math.sin(a)*r*.8);
        ctx.lineTo(p.x+Math.cos(a)*r*1.45,p.y+Math.sin(a)*r*1.45);
        ctx.stroke();
      }
    }

    function drawMoveGizmo(ctx, o, camera, width, height) {
      const origin = project(o.pos,camera,width,height);
      const px = project(vec(o.pos.x+1.05,o.pos.y,o.pos.z),camera,width,height);
      const py = project(vec(o.pos.x,o.pos.y+1.05,o.pos.z),camera,width,height);
      const pz = project(vec(o.pos.x,o.pos.y,o.pos.z+1.05),camera,width,height);
      line(ctx,origin,px,'rgba(226,93,93,.95)',2);
      line(ctx,origin,py,'rgba(104,197,104,.95)',2);
      line(ctx,origin,pz,'rgba(91,154,230,.95)',2);
      if (origin) {
        ctx.fillStyle='#dce7f1';
        ctx.fillRect(origin.x-2,origin.y-2,4,4);
      }
    }

    function drawScene(canvas, camera, isPeer=false) {
      const {ctx,width,height}=setupCanvas(canvas);
      ctx.clearRect(0,0,width,height);
      drawGrid(ctx,camera,width,height);
      const ordered = objects.map((o) => {
        const p=project(o.pos,camera,width,height);
        return {o,depth:p?p.z:999};
      }).sort((a,b)=>b.depth-a.depth);
      for (const {o} of ordered) {
        const isSelected = o.id===selectedId;
        if (o.type==='cube') drawCube(ctx,o,camera,width,height,isSelected,isPeer);
        else if (o.type==='sphere') drawSphere(ctx,o,camera,width,height,isSelected,isPeer);
        else if (o.type==='light') drawLight(ctx,o,camera,width,height,isSelected);
      }
    }

    function hierarchyMarkup() {
      const rows = [`<button type="button" data-static="camera"><span class="obj-icon camera"></span>Main Camera</button>`];
      for (const o of objects) {
        rows.push(`<button type="button" data-object-id="${o.id}" class="${o.id===selectedId?'selected':''}"><span class="obj-icon ${o.type}"></span>${o.name}</button>`);
      }
      return `<div class="label">Hierarchy</div>${rows.join('')}`;
    }

    function renderHierarchy() {
      const html = hierarchyMarkup();
      hostHierarchy.innerHTML=html;
      peerHierarchy.innerHTML=html;
      hostHierarchy.querySelectorAll('[data-object-id]').forEach((button)=>{
        button.addEventListener('click',()=>{
          selectedId=button.dataset.objectId;
          announce(`Selected ${selected()?.name || 'object'} · selection mirrored`);
          renderAll();
        });
      });
      peerHierarchy.querySelectorAll('button').forEach((button)=>{ button.tabIndex=-1; button.disabled=true; });
    }

    function renderInspector() {
      const o=selected();
      inspectorName.textContent=o?o.name:'No selection';
      selectedMeta.textContent=o?o.name:'None';
      for (const axis of ['x','y','z']) {
        fields[axis].disabled=!o;
        fields[axis].value=o?o.pos[axis].toFixed(2):'';
      }
      ownerField.textContent=o?(locked?'Owner · Eun (locked)':'Owner · shared'):'No object selected';
      objectCountMeta.textContent=String(objects.length+1);
      peerObjectCountMeta.textContent=String(objects.length+1);
      cameraMeta.textContent=`${Math.round(hostCamera.yaw*180/Math.PI)}° / ${Math.round(hostCamera.pitch*180/Math.PI)}°`;
    }

    function renderAll() {
      renderHierarchy();
      renderInspector();
      drawScene(hostCanvas,hostCamera,false);
      drawScene(peerCanvas,peerCamera,true);
      peerScene.classList.toggle('locked',locked);
      peerMode.textContent=locked?'Guest · read only':'Guest · following';
      peerStateMeta.textContent=locked?'synced · locked':'synced';
      lockButton.dataset.active=String(locked);
      lockButton.textContent=locked?'Unlock':'Lock';
    }

    function announce(message) {
      eventText.textContent=message;
    }

    function sync(message) {
      syncState.textContent='syncing';
      peerStateMeta.textContent='receiving';
      announce(message);
      clearTimeout(syncTimer);
      syncTimer=setTimeout(()=>{
        syncState.textContent='connected';
        peerStateMeta.textContent=locked?'synced · locked':'synced';
        eventText.textContent='Editor B received the shared Scene state';
      },180);
    }

    function addObject(type) {
      sequence += 1;
      const count=objects.filter((o)=>o.type===type).length+1;
      const names={cube:'Cube',sphere:'Sphere',light:'Point Light'};
      const offsets={cube:[.7,.65,.6],sphere:[-.9,.7,.45],light:[1.3,2.2,-.7]};
      const off=offsets[type];
      const o={ id:`${type}-${sequence}`, type, name:`${names[type]}${count>1?' '+count:''}`, pos:{x:off[0],y:off[1],z:off[2]}, size:type==='light'?.7:1.15 };
      objects.push(o);
      selectedId=o.id;
      sync(`${o.name} created in Editor A`);
      renderAll();
    }

    function deleteSelected() {
      const o=selected();
      if(!o) return;
      const name=o.name;
      objects=objects.filter((item)=>item.id!==o.id);
      selectedId=objects.find((item)=>item.type!=='light')?.id || objects[0]?.id || null;
      locked=false;
      sync(`${name} deleted · Hierarchy mirrored`);
      renderAll();
    }

    function reset() {
      objects=initialObjects();
      selectedId='cube-1';
      mode='orbit';
      locked=false;
      sequence=2;
      hostCamera.yaw=.62; hostCamera.pitch=.42; hostCamera.distance=7.2;
      modeOrbit.dataset.active='true'; modeMove.dataset.active='false';
      hostScene.dataset.mode='orbit'; sceneBadge.textContent='Scene · Orbit mode';
      syncState.textContent='connected'; peerStateMeta.textContent='synced';
      announce('Demo reset · shared Scene ready');
      renderAll();
    }

    function setMode(next) {
      mode=next;
      modeOrbit.dataset.active=String(next==='orbit');
      modeMove.dataset.active=String(next==='move');
      hostScene.dataset.mode=next;
      sceneBadge.textContent=next==='orbit'?'Scene · drag to orbit':'Scene · drag object to move';
      announce(next==='orbit'?'Camera orbit is local to Editor A':'Move mode · drag a Scene object');
    }

    function nearestObject(clientX,clientY) {
      const rect=hostCanvas.getBoundingClientRect();
      const x=clientX-rect.left, y=clientY-rect.top;
      let best=null;
      for(const o of objects) {
        const p=project(o.pos,hostCamera,rect.width,rect.height);
        if(!p) continue;
        const d=Math.hypot(p.x-x,p.y-y);
        const threshold=o.type==='light'?28:Math.max(30,o.size*p.scale*.7);
        if(d<threshold && (!best || d<best.d)) best={o,d};
      }
      return best?.o || null;
    }

    function pointerDown(event) {
      const target=nearestObject(event.clientX,event.clientY);
      if(mode==='move' && target) {
        selectedId=target.id;
        drag={kind:'move',id:target.id,x:event.clientX,y:event.clientY,start:{...target.pos}};
        hostCanvas.setPointerCapture(event.pointerId);
        announce(`Moving ${target.name} · shared Transform preview`);
        renderAll();
        return;
      }
      if(mode==='move' && !target) {
        announce('Move mode · select an object in Hierarchy or tap one in Scene');
        return;
      }
      drag={kind:'orbit',x:event.clientX,y:event.clientY,yaw:hostCamera.yaw,pitch:hostCamera.pitch};
      hostCanvas.setPointerCapture(event.pointerId);
    }

    function pointerMove(event) {
      if(!drag) return;
      const dx=event.clientX-drag.x;
      const dy=event.clientY-drag.y;
      if(drag.kind==='orbit') {
        hostCamera.yaw=drag.yaw-dx*.008;
        hostCamera.pitch=clamp(drag.pitch+dy*.006,-.15,1.25);
        cameraMeta.textContent=`${Math.round(hostCamera.yaw*180/Math.PI)}° / ${Math.round(hostCamera.pitch*180/Math.PI)}°`;
        drawScene(hostCanvas,hostCamera,false);
        announce('Camera orbit changed locally · shared Scene untouched');
      } else {
        const o=objects.find((item)=>item.id===drag.id);
        if(!o) return;
        const sensitivity=hostCamera.distance/420;
        const cy=Math.cos(hostCamera.yaw), sy=Math.sin(hostCamera.yaw);
        const worldDx=dx*sensitivity;
        const worldDz=dy*sensitivity;
        o.pos.x=drag.start.x + worldDx*cy + worldDz*sy;
        o.pos.z=drag.start.z - worldDx*sy + worldDz*cy;
        syncState.textContent='syncing'; peerStateMeta.textContent='receiving';
        renderInspector();
        drawScene(hostCanvas,hostCamera,false);
        drawScene(peerCanvas,peerCamera,true);
      }
    }

    function pointerUp(event) {
      if(!drag) return;
      const kind=drag.kind;
      const moved=selected();
      drag=null;
      if(hostCanvas.hasPointerCapture(event.pointerId)) hostCanvas.releasePointerCapture(event.pointerId);
      if(kind==='move' && moved) sync(`${moved.name} Transform committed`);
      else announce('Camera orbit ready');
      renderAll();
    }

    hostCanvas.addEventListener('pointerdown',pointerDown);
    hostCanvas.addEventListener('pointermove',pointerMove);
    hostCanvas.addEventListener('pointerup',pointerUp);
    hostCanvas.addEventListener('pointercancel',()=>{drag=null;});
    hostCanvas.addEventListener('wheel',(event)=>{
      event.preventDefault();
      hostCamera.distance=clamp(hostCamera.distance+Math.sign(event.deltaY)*.55,3.8,12);
      drawScene(hostCanvas,hostCamera,false);
      announce('Camera zoom changed locally');
    },{passive:false});

    modeOrbit.addEventListener('click',()=>setMode('orbit'));
    modeMove.addEventListener('click',()=>setMode('move'));
    $('addCube').addEventListener('click',()=>addObject('cube'));
    $('addSphere').addEventListener('click',()=>addObject('sphere'));
    $('addLight').addEventListener('click',()=>addObject('light'));
    $('deleteObject').addEventListener('click',deleteSelected);
    $('zoomIn').addEventListener('click',()=>{hostCamera.distance=clamp(hostCamera.distance-.65,3.8,12); drawScene(hostCanvas,hostCamera,false); announce('Camera zoomed in locally');});
    $('zoomOut').addEventListener('click',()=>{hostCamera.distance=clamp(hostCamera.distance+.65,3.8,12); drawScene(hostCanvas,hostCamera,false); announce('Camera zoomed out locally');});
    lockButton.addEventListener('click',()=>{
      if(!selected()) { announce('Select an object before locking'); return; }
      locked=!locked;
      sync(locked?`${selected().name} ownership assigned to Editor A`:`${selected().name} ownership released`);
      renderAll();
    });
    $('resetV2').addEventListener('click',reset);

    for(const axis of ['x','y','z']) {
      fields[axis].addEventListener('change',()=>{
        const o=selected();
        if(!o) return;
        const value=Number(fields[axis].value);
        if(!Number.isFinite(value)) { renderInspector(); return; }
        o.pos[axis]=clamp(value,-6,6);
        sync(`${o.name} Transform.${axis.toUpperCase()} edited in Inspector`);
        renderAll();
      });
    }

    const resizeObserver = new ResizeObserver(()=>{
      drawScene(hostCanvas,hostCamera,false);
      drawScene(peerCanvas,peerCamera,true);
    });
    resizeObserver.observe(hostCanvas);
    resizeObserver.observe(peerCanvas);

    renderAll();
  });
})();
