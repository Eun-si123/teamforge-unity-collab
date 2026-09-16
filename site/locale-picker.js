const scriptBase = new URL('.', import.meta.url);
const STORAGE_KEY = 'teamforge.locale';
const STYLE_ID = 'teamforge-locale-picker-runtime-style';

export const normalizeSearch = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .normalize('NFC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

export const normalizeTag = (value) => String(value || '')
  .trim()
  .replace(/_/g, '-')
  .toLowerCase();

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .locale-menu-popover {
      width: min(360px, calc(100vw - 2rem));
      min-width: 280px;
      max-height: min(32rem, calc(100dvh - 2rem));
      overflow-x: hidden;
      overflow-y: auto;
      box-sizing: border-box;
      padding: .62rem;
    }
    .locale-menu[data-locale-picker-enhanced='true'] .locale-menu-popover {
      display: flex; flex-direction: column; overflow: hidden;
      position: fixed !important; right: auto !important;
      left: var(--locale-picker-left, 8px) !important; top: var(--locale-picker-top, 8px) !important;
      width: var(--locale-picker-width, calc(100vw - 16px)) !important; min-width: 0;
      max-height: min(32rem, var(--locale-picker-height, calc(100dvh - 2rem)));
    }
    .locale-picker-results { min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; padding: 2px; }
    .locale-picker-search-wrap { flex: 0 0 auto; z-index: 2; padding-bottom: .5rem; background: #202328; }
    .locale-picker-search {
      width: 100%; box-sizing: border-box; border: 1px solid var(--line-strong);
      background: #17191d; color: #fff; border-radius: 3px; padding: .62rem .68rem;
      font: inherit; font-size: .82rem; outline: none;
    }
    .locale-picker-search:focus { border-color: #777f89; box-shadow: 0 0 0 2px rgba(255,255,255,.08); }
    .locale-picker-heading { margin: .32rem .42rem .22rem; color: var(--quiet); font-size: .68rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .locale-picker-list { display: grid; gap: .08rem; }
    .locale-picker-option { display: flex !important; align-items: center; justify-content: space-between; gap: .6rem; }
    .locale-picker-option[data-hidden='true'] { display: none !important; }
    .locale-picker-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .locale-picker-badge { flex: 0 0 auto; color: #aeb5bd; font-size: .65rem; font-weight: 650; border: 1px solid #444a52; border-radius: 999px; padding: .12rem .38rem; }
    .locale-picker-suggested[hidden], .locale-picker-empty[hidden] { display: none !important; }
    .locale-picker-suggested { margin-bottom: .42rem; padding-bottom: .42rem; border-bottom: 1px solid var(--line); }
    .locale-picker-empty { padding: .72rem .58rem; color: var(--quiet); font-size: .78rem; }
    @media (max-width: 800px) {
      .locale-menu-popover {
        position: fixed !important; left: 1rem !important; right: 1rem !important; top: 4.6rem !important;
        width: auto !important; max-height: calc(100vh - 6rem); min-width: 0;
      }
    }
  `;
  document.head.append(style);
}

export function publishedLocales(registry) {
  return (registry.locales || []).filter((locale) => locale && locale.publish !== false);
}

export function localeMatchesTag(locale, rawTag) {
  const current = normalizeTag(rawTag);
  if (!current) return false;
  const values = [locale.code, locale.htmlLang, locale.hreflang].map(normalizeTag).filter(Boolean);
  return values.includes(current);
}

function localeMatchesDocument(locale) {
  return localeMatchesTag(locale, document.documentElement.lang);
}

function languageDisplayNames(locale, displayLocales = []) {
  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return [];
  const target = String(locale.htmlLang || locale.code || '').trim();
  if (!target) return [];

  const displayTags = [
    'en',
    target,
    ...displayLocales.map((item) => item?.htmlLang || item?.code),
  ].filter(Boolean);
  const names = new Set();
  for (const displayTag of displayTags) {
    try {
      const displayNames = new Intl.DisplayNames([displayTag], {
        type: 'language',
        languageDisplay: 'standard',
        fallback: 'none',
      });
      const name = displayNames.of(target);
      if (name) names.add(name);
    } catch {
      // Browsers with partial Intl data still have explicit registry aliases.
    }
  }
  return [...names];
}

export function searchHaystack(locale, displayLocales = []) {
  const aliases = Array.isArray(locale.searchAliases) ? locale.searchAliases : [];
  return normalizeSearch([
    locale.label,
    locale.code,
    locale.htmlLang,
    locale.hreflang,
    ...aliases,
    ...languageDisplayNames(locale, displayLocales),
  ].filter(Boolean).join(' '));
}

export function browserMatches(locale, rawTag) {
  const tag = normalizeTag(rawTag);
  if (!tag) return false;
  const configured = Array.isArray(locale.browserMatches) ? locale.browserMatches : [];
  const candidates = [locale.code, locale.htmlLang, locale.hreflang, ...configured]
    .map(normalizeTag)
    .filter(Boolean);

  return candidates.some((candidate) => {
    if (tag === candidate) return true;
    // A base-language rule such as `ko` may match `ko-KR`. Script/region-specific
    // rules only match exactly, so `zh-Hans` never guesses for `zh-Hant`.
    return !candidate.includes('-') && tag.startsWith(`${candidate}-`);
  });
}

export function recommendLocaleFromPreferences(
  locales,
  active,
  rememberedCode,
  browserLanguages = [],
) {
  const remembered = locales.find((locale) => locale.code === rememberedCode) || null;
  if (remembered && remembered.code !== active?.code) return remembered;

  for (const browserLanguage of browserLanguages) {
    const match = locales.find((locale) => browserMatches(locale, browserLanguage));
    if (match && match.code !== active?.code) return match;
  }
  return null;
}

function readRememberedCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function rememberLocale(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be unavailable in private/sandboxed contexts. Navigation still works.
  }
}

function recommendLocale(locales, active) {
  const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  return recommendLocaleFromPreferences(locales, active, readRememberedCode(), browserLanguages);
}

function localizedUi(active) {
  const ui = active?.localePicker && typeof active.localePicker === 'object'
    ? active.localePicker
    : {};
  return {
    searchPlaceholder: ui.searchPlaceholder || active?.menuAriaLabel || 'Search languages',
    suggestedLabel: ui.suggestedLabel || 'Suggested',
    allLanguagesLabel: ui.allLanguagesLabel || active?.menuGroupLabel || 'Languages',
    noResultsLabel: ui.noResultsLabel || 'No matching languages',
    previewLabel: ui.previewLabel || 'Preview',
  };
}

function localeUrl(locale) {
  const path = String(locale.path || '');
  return new URL(path, scriptBase).href;
}

export function localeCodeForStaticElement(element, locales) {
  const hrefLang = normalizeTag(element.getAttribute?.('hreflang'));
  const language = normalizeTag(element.getAttribute?.('lang'));
  const text = normalizeSearch(element.textContent || '');
  return locales.find((locale) => {
    const tags = [locale.code, locale.htmlLang, locale.hreflang].map(normalizeTag).filter(Boolean);
    return (
      (hrefLang && tags.includes(hrefLang)) ||
      (language && tags.includes(language)) ||
      text === normalizeSearch(locale.label)
    );
  })?.code || '';
}

function captureStaticTargets(popover, locales) {
  const targets = new Map();
  popover.querySelectorAll('a[href]').forEach((anchor) => {
    const code = localeCodeForStaticElement(anchor, locales);
    if (code) targets.set(code, anchor.href);
  });
  return targets;
}

function buildOption(locale, activeCode, ui, staticTargets, searchLocales, { suggested = false } = {}) {
  const isActive = locale.code === activeCode;
  const node = document.createElement(isActive ? 'strong' : 'a');
  node.className = 'locale-picker-option';
  node.lang = String(locale.htmlLang || locale.code || '');
  node.dir = 'auto';
  node.setAttribute('translate', 'no');
  node.dataset.localeCode = String(locale.code || '');
  node.dataset.search = searchHaystack(locale, searchLocales);
  if (suggested) node.dataset.suggested = 'true';

  if (!isActive) {
    node.href = staticTargets.get(locale.code) || localeUrl(locale);
    node.hreflang = String(locale.hreflang || locale.htmlLang || locale.code || '');
    node.addEventListener('click', () => rememberLocale(locale.code));
  }

  const label = document.createElement('span');
  label.className = 'locale-picker-option-label';
  label.dir = 'auto';
  label.textContent = String(locale.label || locale.code || '');
  node.append(label);

  if (String(locale.lifecycle || '') === 'preview') {
    const badge = document.createElement('span');
    badge.className = 'locale-picker-badge';
    badge.textContent = ui.previewLabel;
    node.append(badge);
  }

  return node;
}

function enhanceMenu(details, registry) {
  const popover = details.querySelector('.locale-menu-popover');
  if (!popover || details.dataset.localePickerEnhanced === 'true') return;

  const available = publishedLocales(registry);
  const staticTargets = captureStaticTargets(popover, available);
  const locales = available.filter(locale => localeMatchesDocument(locale) || staticTargets.has(locale.code));
  if (!locales.length) return;
  const active = locales.find(localeMatchesDocument) || locales.find((locale) => locale.code === registry.defaultLocale) || locales[0];
  const ui = localizedUi(active);
  const recommendation = recommendLocale(locales, active);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'locale-picker-search-wrap';
  const search = document.createElement('input');
  search.className = 'locale-picker-search';
  search.type = 'search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.placeholder = ui.searchPlaceholder;
  search.setAttribute('aria-label', ui.searchPlaceholder);
  searchWrap.append(search);

  const suggested = document.createElement('div');
  suggested.className = 'locale-picker-suggested';
  suggested.hidden = !recommendation;
  if (recommendation) {
    const heading = document.createElement('div');
    heading.className = 'locale-picker-heading';
    heading.textContent = ui.suggestedLabel;
    const list = document.createElement('div');
    list.className = 'locale-picker-list';
    list.append(buildOption(recommendation, active.code, ui, staticTargets, locales, { suggested: true }));
    suggested.append(heading, list);
  }

  const allHeading = document.createElement('div');
  allHeading.className = 'locale-picker-heading';
  allHeading.textContent = ui.allLanguagesLabel;

  const list = document.createElement('div');
  list.className = 'locale-picker-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', ui.allLanguagesLabel);
  locales.forEach((locale) => list.append(buildOption(locale, active.code, ui, staticTargets, locales)));

  const empty = document.createElement('div');
  empty.className = 'locale-picker-empty';
  empty.hidden = true;
  empty.setAttribute('role', 'status');
  empty.setAttribute('aria-live', 'polite');
  empty.textContent = ui.noResultsLabel;

  const results = document.createElement('div');
  results.className = 'locale-picker-results';
  results.append(suggested, allHeading, list, empty);
  popover.replaceChildren(searchWrap, results);
  details.dataset.localePickerEnhanced = 'true';

  const applyFilter = () => {
    const query = normalizeSearch(search.value);
    let visible = 0;
    list.querySelectorAll('.locale-picker-option').forEach((option) => {
      const matches = !query || String(option.dataset.search || '').includes(query);
      option.dataset.hidden = matches ? 'false' : 'true';
      if (matches) visible += 1;
    });
    suggested.hidden = Boolean(query) || !recommendation;
    empty.hidden = visible !== 0;
    results.scrollTop = 0;
  };

  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      details.open = false;
      details.querySelector('summary')?.focus();
    }
  });
  const positionPopover = () => {
    if (!details.open) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const anchor = details.querySelector('summary').getBoundingClientRect();
    const panelWidth = Math.min(360, width - 16);
    const panelTop = Math.max(top + 8, Math.min(anchor.bottom + 8, top + height - Math.min(240, height - 16) - 8));
    const preferredLeft = getComputedStyle(details).direction === 'rtl' ? anchor.left : anchor.right - panelWidth;
    popover.style.setProperty('--locale-picker-left', `${Math.max(left + 8, Math.min(preferredLeft, left + width - panelWidth - 8))}px`);
    popover.style.setProperty('--locale-picker-top', `${panelTop}px`);
    popover.style.setProperty('--locale-picker-width', `${panelWidth}px`);
    popover.style.setProperty('--locale-picker-height', `${top + height - panelTop - 8}px`);
  };
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, { passive: true });
  window.visualViewport?.addEventListener('resize', positionPopover);
  window.visualViewport?.addEventListener('scroll', positionPopover);
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    positionPopover();
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
  });
  document.addEventListener('pointerdown', (event) => {
    if (details.open && !details.contains(event.target)) details.open = false;
  });
}

async function initializeLocalePicker() {
  const menus = [...document.querySelectorAll('.locale-menu')];
  if (!menus.length) return;
  try {
    const response = await fetch(new URL('i18n/locales.json', scriptBase), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`locale registry HTTP ${response.status}`);
    const registry = await response.json();
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.locales)) {
      throw new Error('unsupported locale registry schema');
    }
    injectStyles();
    menus.forEach((menu) => enhanceMenu(menu, registry));
  } catch (error) {
    // The server-rendered locale links remain usable when enhancement fails.
    console.warn('[TeamForge locale picker] Enhancement unavailable; using static language menu.', error);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLocalePicker, { once: true });
  } else {
    initializeLocalePicker();
  }
}
