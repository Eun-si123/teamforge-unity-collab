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
