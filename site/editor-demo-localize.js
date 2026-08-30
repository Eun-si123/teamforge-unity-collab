import './locale-picker.js';

const scriptBase = new URL('.', import.meta.url);
const documentLanguage = document.documentElement.lang.toLowerCase();

const runtime = {
  locale: null,
  translate(value) {
    return value;
  }
};

globalThis.TeamForgeDemoLocale = runtime;

function localeMatches(locale) {
  const htmlLang = String(locale.htmlLang || '').toLowerCase();
  const code = String(locale.code || '').toLowerCase();
  if (!documentLanguage) return false;
  return (
    documentLanguage === htmlLang ||
    documentLanguage === code ||
    (htmlLang && documentLanguage.startsWith(`${htmlLang}-`)) ||
    (code && documentLanguage.startsWith(`${code}-`))
  );
}

function renderTemplate(template, groups, mapGroups, terms) {
  return String(template).replace(/\{([A-Za-z0-9_-]+)\}/g, (_match, name) => {
    let value = groups && groups[name] !== undefined ? groups[name] : '';
    const termSet = mapGroups && mapGroups[name];
    if (termSet && terms && terms[termSet] && terms[termSet][value] !== undefined) {
      value = terms[termSet][value];
    }
    return value;
  });
}

function buildTranslator(bundle) {
  const exact = new Map(Object.entries(bundle.exact || {}));
  const attributes = new Map(Object.entries(bundle.attributes || {}));
  const terms = bundle.terms || {};
  const patterns = (bundle.patterns || []).map((entry) => ({
    regex: new RegExp(entry.source),
    template: entry.template,
    mapGroups: entry.mapGroups || {}
  }));

  const translateValue = (value) => {
    if (!value) return value;
    const trimmed = value.trim();
    if (!trimmed) return value;

    let translated = exact.get(trimmed);
    if (translated === undefined) {
      for (const entry of patterns) {
        const match = entry.regex.exec(trimmed);
        if (!match) continue;
        translated = renderTemplate(entry.template, match.groups || {}, entry.mapGroups, terms);
        break;
      }
    }

    if (translated === undefined || translated === trimmed) return value;
    return value.replace(trimmed, translated);
  };

  const translateElement = (element) => {
    if (!(element instanceof Element)) return;
    for (const attr of ['aria-label', 'title']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const translated = attributes.get(value) || translateValue(value);
      if (translated !== value) element.setAttribute(attr, translated);
    }
  };

  const translateTree = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = translateValue(root.nodeValue || '');
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const next = translateValue(node.nodeValue || '');
        if (next !== node.nodeValue) node.nodeValue = next;
      } else {
        translateElement(node);
      }
    }
  };

  return { translateValue, translateElement, translateTree };
}

function attachTranslator(translator) {
  const demo = document.getElementById('demo');
  if (!demo) return;

  translator.translateTree(demo);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        translator.translateTree(record.target);
        continue;
      }
      if (record.type === 'attributes') {
        translator.translateElement(record.target);
        continue;
      }
      record.addedNodes.forEach(translator.translateTree);
    }
  });

  observer.observe(demo, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title']
  });
}

async function loadRuntimeLocale() {
  if (!documentLanguage || documentLanguage === 'en' || documentLanguage.startsWith('en-')) {
    return runtime;
  }

  try {
    const registryResponse = await fetch(new URL('i18n/locales.json', scriptBase), { cache: 'no-cache' });
    if (!registryResponse.ok) throw new Error(`locale registry HTTP ${registryResponse.status}`);
    const registry = await registryResponse.json();
    if (registry.schemaVersion !== 1 || !Array.isArray(registry.locales)) {
      throw new Error('unsupported locale registry schema');
    }

    const locale = registry.locales.find(localeMatches);
    if (!locale || !locale.runtimeTranslation) return runtime;

    const translationResponse = await fetch(new URL(String(locale.runtimeTranslation), scriptBase), { cache: 'no-cache' });
    if (!translationResponse.ok) throw new Error(`runtime translation HTTP ${translationResponse.status}`);
    const bundle = await translationResponse.json();
    if (bundle.schemaVersion !== 1 || bundle.locale !== locale.code) {
      throw new Error(`runtime translation schema/locale mismatch for ${locale.code}`);
    }

    const translator = buildTranslator(bundle);
    runtime.locale = locale.code;
    runtime.translate = translator.translateValue;

    const attach = () => attachTranslator(translator);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }
    return runtime;
  } catch (error) {
    console.error('[TeamForge demo] Failed to initialize locale data', error);
    return runtime;
  }
}

export const ready = loadRuntimeLocale();
export const translate = (value) => runtime.translate(value);
