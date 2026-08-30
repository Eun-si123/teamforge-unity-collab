# Searchable locale picker verification

This file records the minimum behavior expected from the progressive locale-menu enhancement.

- Static server-rendered locale links remain usable if JavaScript or the locale registry fetch fails.
- Search matches native labels, locale codes, and configured `searchAliases`.
- Browser-language recommendation reads `navigator.languages` locally and never redirects automatically.
- A locale selected by the user is remembered with `localStorage` and takes precedence over browser recommendation on later visits.
- Simplified Chinese recommendation uses explicit `browserMatches` (`zh-Hans`, `zh-CN`, `zh-SG`, `zh-MY`) so script/region guesses are not made from bare `zh`.
- Preview locales remain visibly labeled as preview in the enhanced picker.
- Search, recommendation, and lifecycle labels are localized from the active locale registry entry.
- Escape closes the picker and returns focus to the summary control.
- Mobile layout uses a fixed-width-safe panel without changing locale URLs or SEO behavior.
