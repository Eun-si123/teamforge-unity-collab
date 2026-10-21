import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');
const src = read('site/index.html');
const registry = JSON.parse(read('site/i18n/locales.json'));

test('homepage scene is part of the source DOM, not runtime injected', () => {
  assert.match(src, /<body class="site-home">/);
  assert.match(src, /<div class="tfc-stage" aria-hidden="true">/);
  assert.match(src, /<div class="tfc-ticker" aria-hidden="true">/);
  assert.equal((src.match(/class="tfc-ring"/g) || []).length, 4);
  assert.match(src, /id="collabLab"/);
  assert.match(src, /id="moveButton"/);
  assert.match(src, /data-teamforge-proof-video/);
});

test('homepage has one canonical dedicated stylesheet and progressive motion script', () => {
  assert.match(src, /href="homepage.css"/);
  assert.match(src, /src="homepage-motion.js"/);
  assert.doesNotMatch(read('site/site-theme.css'), /cinematic-home\.css/);
  assert.doesNotMatch(read('site/site-navigation.js'), /cinematic-home\.js/);
  assert.ok(!existsSync('site/cinematic-home.css'));
  assert.ok(!existsSync('site/cinematic-home.js'));
  for (const path of ['homepage.css','homepage-motion.js']) {
    assert.ok(registry.sharedAssets.includes(path), path + ' missing from localized assets');
  }
});

test('motion script adds effects but never inserts or overwrites homepage markup', () => {
  const motion = read('site/homepage-motion.js');
  assert.doesNotMatch(motion, /innerHTML|insertAdjacentHTML|appendChild|\.prepend\(|\.after\(/);
  assert.match(motion, /prefers-reduced-motion/);
});

test('all published homepage translations have reviewed source and first-class routes', () => {
  const published = registry.locales.filter(loc => loc.publish !== false);
  assert.ok(published.length >= 20, 'unexpected localization regression');
  for (const locale of published) {
    if (locale.code === registry.defaultLocale) continue;
    assert.ok(locale.homepageManifest, locale.code);
    const manifest = JSON.parse(read(locale.homepageManifest));
    assert.ok(manifest.reviewedSources['site/index.html'], locale.code);
    assert.ok(manifest.replacements?.length > 0, locale.code);
  }
});

test('built static pages keep styles and media on root and translated pages', () => {
  const root = '.pages-site';
  if (!existsSync(join(root,'index.html'))) return;
  assert.ok(existsSync(join(root,'homepage.css')));
  assert.ok(existsSync(join(root,'homepage-motion.js')));
  for (const locale of ['en','ko','ja','de']) {
    const localRoot = registry.locales.find(entry => entry.code === locale)?.path ?? '';
    const html = read(join(root,localRoot,'index.html'));
    assert.match(html, /tfc-reactor/);
    assert.match(html, /tfc-ticker/);
    assert.match(html, /id="collabLab"/);
    assert.match(html, /homepage\.css/);
    assert.match(html, /homepage-motion\.js/);
  }
});
