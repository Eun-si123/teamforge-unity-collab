(() => {
  'use strict';

  const STORAGE_KEY = 'teamforge-theme';
  const THEMES = new Set(['light', 'dark']);
  const root = document.documentElement;
  const media = window.matchMedia?.('(prefers-color-scheme: light)');

  const english = { light: 'Light', dark: 'Dark', toLight: 'Switch to light theme', toDark: 'Switch to dark theme' };
  const localeCopy = () => {
    try {
      const data = JSON.parse(document.getElementById('teamforge-locale-ui')?.textContent || '{}');
      return {...english, ...data.theme};
    } catch { return english; }
  };
  const systemTheme = () => media?.matches ? 'light' : 'dark';
  const storedTheme = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return THEMES.has(value) ? value : null;
    } catch {
      return null;
    }
  };

  const updateMetaColor = (theme) => {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = theme === 'light' ? '#eeeee7' : '#191d1c';
  };

  const updateControl = () => {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    const theme = root.dataset.theme === 'light' ? 'light' : 'dark';
    const labels = localeCopy();
    button.dataset.theme = theme;
    button.textContent = labels[theme];
    button.setAttribute('aria-label', theme === 'light' ? labels.toDark : labels.toLight);
    button.setAttribute('title', theme === 'light' ? labels.toDark : labels.toLight);
  };

  const applyTheme = (theme, persist = false) => {
    const next = THEMES.has(theme) ? theme : systemTheme();
    root.dataset.theme = next;
    root.style.colorScheme = next;
    updateMetaColor(next);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    updateControl();
  };

  const createControl = () => {
    if (document.querySelector('[data-theme-toggle]')) return;
    const host = document.querySelector('.nav-links') || document.querySelector('nav .nav');
    if (!host) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    button.dataset.themeToggle = 'true';
    button.addEventListener('click', () => {
      const current = root.dataset.theme === 'light' ? 'light' : 'dark';
      applyTheme(current === 'light' ? 'dark' : 'light', true);
    });

    const localeMenu = host.querySelector('.locale-menu');
    const githubLink = host.querySelector('a[href*="github.com"]');
    host.insertBefore(button, localeMenu || githubLink || null);
    updateControl();
  };

  applyTheme(storedTheme() || systemTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createControl, { once: true });
  } else {
    createControl();
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(event.newValue);
  });

  media?.addEventListener?.('change', () => {
    if (!storedTheme()) applyTheme(systemTheme());
  });
})();
