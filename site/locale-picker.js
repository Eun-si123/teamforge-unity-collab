const scriptBase = new URL('.', import.meta.url);
const STORAGE_KEY = 'teamforge.locale';
const STYLE_ID = 'teamforge-locale-picker-runtime-style';

const normalizeSearch = (value) => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const normalizeTag = (value) => String(value || '')
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
      max-height: min(70vh, 520px);
      overflow: auto;
      padding: .62rem;
    }
    .locale-picker-search-wrap { position: sticky; top: 0; z-index: 2; padding-bottom: .5rem; background: #202328; }
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

function publishedLocales(registry) {
  return (registry.locales || []).filter((locale) => locale && locale.publish !== false);
}

function localeMatchesDocument(locale) {
  const current = normalizeTag(document.documentElement.lang);
  if (!current) return false;
  const values = [locale.code, locale.htmlLang, locale.hreflang].map(normalizeTag).filter(Boolean);
  return values.includes(current);
}

function searchHaystack(locale) {
  const aliases = Array.isArray(locale.searchAliases) ? locale.searchAliases : [];
  return normalizeSearch([
    locale.label,
    locale.code,
    locale.htmlLang,
    locale.hreflang,
    ...aliases,
  ].filter(Boolean).join(' '));
}

function browserMatches(locale, rawTag) {
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

function readRemembered(locales) {
  try {
    const code = localStorage.getItem(STORAGE_KEY);
    return locales.find((locale) => locale.code === code) || null;
  } catch {
    return null;
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
  const remembered = readRemembered(locales);
  if (remembered && remembered.code !== active?.code) return remembered;

  const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  for (const browserLanguage of browserLanguages) {
    const match = locales.find((locale) => browserMatches(locale, browserLanguage));
    if (match && match.code !== active?.code) return match;
  }
  return null;
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

function buildOption(locale, activeCode, ui, { suggested = false } = {}) {
  const isActive = locale.code === activeCode;
  const node = document.createElement(isActive ? 'strong' : 'a');
  node.className = 'locale-picker-option';
  node.lang = String(locale.htmlLang || locale.code || '');
  node.setAttribute('translate', 'no');
  node.dataset.localeCode = String(locale.code || '');
  node.dataset.search = searchHaystack(locale);
  if (suggested) node.dataset.suggested = 'true';

  if (!isActive) {
    node.href = localeUrl(locale);
    node.hreflang = String(locale.hreflang || locale.htmlLang || locale.code || '');
    node.addEventListener('click', () => rememberLocale(locale.code));
  }

  const label = document.createElement('span');
  label.className = 'locale-picker-option-label';
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

  const locales = publishedLocales(registry);
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
    list.append(buildOption(recommendation, active.code, ui, { suggested: true }));
    suggested.append(heading, list);
  }

  const allHeading = document.createElement('div');
  allHeading.className = 'locale-picker-heading';
  allHeading.textContent = ui.allLanguagesLabel;

  const list = document.createElement('div');
  list.className = 'locale-picker-list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', ui.allLanguagesLabel);
  locales.forEach((locale) => list.append(buildOption(locale, active.code, ui)));

  const empty = document.createElement('div');
  empty.className = 'locale-picker-empty';
  empty.hidden = true;
  empty.setAttribute('role', 'status');
  empty.setAttribute('aria-live', 'polite');
  empty.textContent = ui.noResultsLabel;

  popover.replaceChildren(searchWrap, suggested, allHeading, list, empty);
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
  };

  search.addEventListener('input', applyFilter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      details.open = false;
      details.querySelector('summary')?.focus();
    }
  });
  details.addEventListener('toggle', () => {
    if (!details.open) return;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLocalePicker, { once: true });
} else {
  initializeLocalePicker();
}
