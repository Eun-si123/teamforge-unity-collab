import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Exercise the existing illustration model without requiring a GPU or a DOM.
const source = readFileSync(new URL('./editor-demo-v4.js', import.meta.url), 'utf8');
const modelSource = source.slice(source.indexOf('class SharedScene'), source.indexOf('    const fallbackNodes'));
const SharedScene = vm.runInNewContext(`${modelSource}; SharedScene`, { structuredClone });
test('ownership blocks peer transform/rename/delete and unlock restores editing', () => {
  const model = new SharedScene();
  assert.equal(model.toggleLock('cube', 'a'), true);
  const transform = {position:[2,.5,0],rotation:[0,24,0],scale:[1,1,1]};
  assert.equal(model.setTransform('cube', transform, 'b'), false);
  assert.equal(model.rename('cube', 'Peer edit', 'b'), false);
  assert.equal(model.remove('cube', 'b'), false);
  assert.equal(model.toggleLock('cube', 'b'), false);
  assert.equal(model.records.get('cube').position[0], 0);
  assert.equal(model.setTransform('cube', transform, 'a'), true);
  assert.equal(model.toggleLock('cube', 'a'), true);
  assert.equal(model.setTransform('cube', {...transform,position:[3,.5,0]}, 'b'), true);
  assert.equal(model.records.get('cube').position[0], 3);
});
test('reset restores deleted Cube, clears ownership and removes created objects', () => {
  const model = new SharedScene();
  model.remove('cube','a');model.create('sphere','b');model.toggleLock('camera','a');model.reset();
  assert.equal(model.records.size,3);
  assert.equal(model.records.get('cube').position[0],0);
  assert.equal(model.records.get('camera').lockedBy,null);
});

function lightweightDemo() {
  class Element {
    constructor() { this.handlers = {}; this.attributes = {}; this.dataset = {}; this.style = {setProperty(){}}; this.parentElement = {clientWidth:120,removeAttribute(){}}; }
    addEventListener(type, callback) { this.handlers[type] = callback; }
    setAttribute(key,value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    before() {}
    focus() {}
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; }
    fire(type, overrides = {}) { this.handlers[type]?.({isPrimary:true,button:0,pointerId:1,clientX:0,preventDefault(){},...overrides}); }
  }
  const cubes = [new Element(), new Element()];
  const outputs = [new Element(), new Element()];
  const elements = Object.fromEntries(['collabLab','fallback-status','lockButton','moveButton','peerMoveButton','resetButton','loadDemo'].map(id=>[id,new Element()]));
  elements.collabLab.querySelectorAll = selector => selector === '.fallback-cube' ? cubes : outputs;
  elements.collabLab.querySelector = () => new Element();
  const code = readFileSync(new URL('./editor-demo-v2.js', import.meta.url),'utf8').replace("import(new URL('editor-demo-localize.js', assetBase)).catch(() => {});",'');
  vm.runInNewContext(code, {URL,document:{currentScript:{src:'https://example.test/demo.js'},getElementById:id=>elements[id],createElement:()=>new Element()}});
  return {cubes, outputs, elements};
}
test('lightweight pointer drag mirrors both directions and refuses locked peer edits', () => {
  const {cubes,outputs,elements} = lightweightDemo();
  cubes[0].fire('pointerdown');cubes[0].fire('pointermove',{clientX:36});cubes[0].fire('pointerup');
  assert.deepEqual(outputs.map(x=>x.textContent),['2.00','2.00']);
  elements.lockButton.fire('click');
  cubes[1].fire('pointerdown');cubes[1].fire('pointermove',{clientX:72});
  assert.equal(outputs[0].textContent,'2.00');
  assert.match(elements['fallback-status'].textContent,/cannot edit/);
  elements.lockButton.fire('click');
  cubes[1].fire('pointerdown');cubes[1].fire('pointermove',{clientX:-18});cubes[1].fire('pointercancel');
  assert.deepEqual(outputs.map(x=>x.textContent),['1.00','1.00']);
  cubes[1].fire('pointermove',{clientX:36});
  assert.equal(outputs[0].textContent,'1.00');
});
test('lightweight reset cancels capture; keyboard is bounded and respects ownership', () => {
  const {cubes,outputs,elements} = lightweightDemo();
  cubes[0].fire('pointerdown');elements.resetButton.fire('click');
  cubes[0].fire('pointermove',{clientX:72});assert.equal(outputs[0].textContent,'0.00');
  assert.equal(cubes[0].capture,null);
  cubes[1].fire('keydown',{key:'End'});assert.equal(outputs[0].textContent,'4.00');
  cubes[1].fire('keydown',{key:'ArrowRight'});assert.equal(outputs[0].textContent,'4.00');
  elements.lockButton.fire('click');cubes[1].fire('keydown',{key:'Home'});
  assert.equal(outputs[0].textContent,'4.00');
  cubes[0].fire('keydown',{key:'Home'});assert.equal(outputs[0].textContent,'0.00');
});
