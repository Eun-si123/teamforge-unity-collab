import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTranslator} from './editor-demo-localize.js';
import {browserMatches, recommendLocaleFromPreferences} from './locale-picker.js';
const registry = JSON.parse(readFileSync(new URL('./i18n/locales.json', import.meta.url)));
const published = registry.locales.filter(l => l.publish);
test('the requested eight languages are published with unique routes', () => {
  assert.deepEqual(published.map(l=>l.code), ['en','ko','ja','zh-Hans','es','de','fr','pt-BR']);
  assert.equal(new Set(published.map(l=>l.path)).size, 8);
  assert.equal(registry.defaultLocale,'en');
  assert.equal(browserMatches(published.find(l=>l.code==='pt-BR'),'pt-PT'),false);
  assert.equal(recommendLocaleFromPreferences(published,published[0],'de',['ja-JP']).code,'de');
});
for (const locale of published.filter(l=>l.runtimeTranslation)) {
  const bundle=JSON.parse(readFileSync(new URL(locale.runtimeTranslation,import.meta.url)));
  const translator=buildTranslator(bundle);
  test(`${locale.code}: English fallback, dynamic ownership, and keyboard guidance`,()=>{
    assert.equal(translator.translateValue('A newly added English message'), 'A newly added English message');
    assert.equal(translator.translateValue('  Lock object  '),'  '+bundle.exact['Lock object']+'  ');
    assert.equal(translator.translateValue('session / '),bundle.exact['session /']+' ');
    assert.notEqual(translator.translateValue('Editor B cannot edit: Cube is owned by Editor A'),'Editor B cannot edit: Cube is owned by Editor A');
    assert.notEqual(translator.translateValue('Cube locked by Editor A'),'Cube locked by Editor A');
    assert.ok(translator.translateValue('Editor A ↔ Editor B · Cube X 1.25 · Owner A').includes('1.25'));
    assert.ok(bundle.exact['Drag either Cube sideways, or use the buttons. Arrow keys also move a focused Cube.']);
    assert.equal(translator.translateValue('SerializedProperty'), 'SerializedProperty');
    for (const editor of ['Editor A · Eun', 'Editor B · Peer']) {
      const label = translator.translateValue(`${editor} interactive Scene view`);
      assert.ok(label.includes(editor), 'preserve the complete editor identity');
      assert.ok(!label.includes('interactive Scene view'), 'translate the live canvas accessible label');
    }
  });
}
