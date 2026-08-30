import assert from 'node:assert/strict';
import test from 'node:test';

import {
  browserMatches,
  localeCodeForStaticElement,
  normalizeSearch,
  normalizeTag,
  recommendLocaleFromPreferences,
  searchHaystack,
} from './locale-picker.js';

const locales = [
  {
    code: 'en',
    label: 'English',
    htmlLang: 'en',
    hreflang: 'en',
    searchAliases: ['English', '영어'],
    browserMatches: ['en'],
  },
  {
    code: 'ko',
    label: '한국어',
    htmlLang: 'ko',
    hreflang: 'ko',
    searchAliases: ['Korean', '한국어', '韩语'],
    browserMatches: ['ko'],
  },
  {
    code: 'zh-Hans',
    label: '简体中文',
    htmlLang: 'zh-Hans',
    hreflang: 'zh-Hans',
    searchAliases: ['Chinese', 'Simplified Chinese', '중국어', '简体'],
    browserMatches: ['zh-Hans', 'zh-CN', 'zh-SG', 'zh-MY'],
  },
];

test('normalization handles whitespace, case, Unicode width, and underscore tags', () => {
  assert.equal(normalizeSearch('  ＣＨＩＮＥＳＥ   Language '), 'chinese language');
  assert.equal(normalizeTag('ZH_Hans'), 'zh-hans');
});

test('search haystack includes native labels, codes, and explicit aliases', () => {
  const haystack = searchHaystack(locales[2]);
  assert.ok(haystack.includes('简体中文'));
  assert.ok(haystack.includes('chinese'));
  assert.ok(haystack.includes('중국어'));
  assert.ok(haystack.includes('zh-hans'));
});

test('base-language browser rules match regional variants', () => {
  assert.equal(browserMatches(locales[1], 'ko-KR'), true);
  assert.equal(browserMatches(locales[0], 'en-US'), true);
});

test('Simplified Chinese rules do not guess Traditional Chinese', () => {
  assert.equal(browserMatches(locales[2], 'zh-CN'), true);
  assert.equal(browserMatches(locales[2], 'zh-Hans'), true);
  assert.equal(browserMatches(locales[2], 'zh-TW'), false);
  assert.equal(browserMatches(locales[2], 'zh-Hant'), false);
});

test('remembered explicit choice wins over browser recommendation', () => {
  const active = locales[0];
  const recommendation = recommendLocaleFromPreferences(
    locales,
    active,
    'zh-Hans',
    ['ko-KR'],
  );
  assert.equal(recommendation?.code, 'zh-Hans');
});

test('browser recommendation is used when no explicit remembered choice exists', () => {
  const active = locales[0];
  const recommendation = recommendLocaleFromPreferences(locales, active, '', ['ko-KR', 'en-US']);
  assert.equal(recommendation?.code, 'ko');
});

test('current locale is never recommended back to the user', () => {
  const active = locales[1];
  const recommendation = recommendLocaleFromPreferences(locales, active, 'ko', ['ko-KR']);
  assert.equal(recommendation, null);
});

test('static locale links can be identified by hreflang before enhancement replaces them', () => {
  const fakeAnchor = {
    textContent: '한국어',
    getAttribute(name) {
      if (name === 'hreflang') return 'ko';
      if (name === 'lang') return 'ko';
      return null;
    },
  };
  assert.equal(localeCodeForStaticElement(fakeAnchor, locales), 'ko');
});
