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
  assert.match(src, /href="homepage\.css\?v=20261123-proof3"/);
  assert.match(src, /src="homepage-motion\.js\?v=20261123-forged1"/);
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


test('hero design is a deliberate original comic-poster treatment, not a neon UI overlay', () => {
  const css = read('site/homepage.css');
  assert.match(css, /--forge-ember:#ff6342/);
  assert.match(css, /\.site-home header\.hero\.wrap/);
  assert.match(css, /\.tfc-stage::before/);
  assert.match(css, /\.tfc-cube/);
  assert.match(css, /\.site-home #demo/);
  assert.match(css, /\.site-home #proof/);
  assert.match(css, /\.site-home #features/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /box-shadow:\s*0 0 [0-9]+px/);
  assert.doesNotMatch(css, /@keyframes tfc-marquee/);
  assert.doesNotMatch(css, /radial-gradient\(/);
});

test('landing release CSS/JS URL versions match the reviewed locale source pin', () => {
  assert.match(src, /homepage\.css\?v=20261123-proof3/);
  assert.match(src, /homepage-motion\.js\?v=20261123-forged1/);
  const pinned = new Set(
    registry.locales.filter(locale => locale.publish !== false &&
      locale.code !== registry.defaultLocale)
      .map(locale => JSON.parse(read(locale.homepageManifest)).reviewedSources['site/index.html'])
  );
  assert.equal(pinned.size, 1, 'localizations must review one exact source blob');
});


test('mobile hero illustration is replaced by a compact editor relationship', () => {
  const css = read('site/homepage.css');
  assert.match(css, /Mobile hero usability/);
  assert.match(css, /\.site-home \.tfc-reactor,\s*\.site-home \.tfc-scanline\s*\{display:none\}/);
  assert.match(css, /\.site-home \.tfc-stage \{[\s\S]*?grid-template-columns:minmax\(0,1fr\) 33px minmax\(0,1fr\)/);
  assert.match(css, /\.site-home header\.hero\.wrap \{[\s\S]*?min-height:0/);
  assert.match(css, /\.site-home \.tfc-scene-label \+ \.tfc-scene-label \{grid-column:3\}/);
  assert.match(css, /@media \(max-width:410px\)/);
  assert.doesNotMatch(css, /@media \(max-width:760px\)\s*\{\s*\.site-home \.tfc-stage \{height:385px/);
});


test('desktop hero uses real existing Unity development poster, not giant fake editor geometry', () => {
  const css=read('site/homepage.css');
  assert.match(css, /min-width:761px/);
  assert.match(css, /assets\/teamforge-demo-poster\.jpg/);
  assert.match(css, /aspect-ratio:5\.3\s*\/\s*1/);
  assert.match(css, /\.site-home \.tfc-reactor,[\s\S]*?\{display:none\}/);
  assert.ok(existsSync('site/assets/teamforge-demo-poster.jpg'));
});
