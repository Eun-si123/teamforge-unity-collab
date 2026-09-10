#!/usr/bin/env python3
"""Reject malformed/incomplete locale data before Pages publication."""
import ast
import hashlib
import json
import re
from pathlib import Path


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError(f'duplicate localization key: {key}')
        result[key] = value
    return result


def english_ui_digest(registry, repo_root=None):
    source = next(l for l in registry['locales'] if l['code'] == registry['defaultLocale'])
    content = {k: source.get(k) for k in ('menuAriaLabel', 'menuGroupLabel', 'localePicker', 'documentUi', 'theme', 'languageSection')}
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[1]
    tree = ast.parse((root / 'scripts/render_doc_pages.py').read_text())
    assignment = next(node for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PAGES' for t in node.targets))
    content['documentMetadata'] = [{k: page[k] for k in ('slug', 'title', 'heading', 'description', 'nav_label')} for page in ast.literal_eval(assignment.value)]
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def verify(repo_root):
    root = Path(repo_root)
    data = root / 'site/i18n'
    parsed = {p.name: json.loads(p.read_text(), object_pairs_hook=no_duplicates) for p in data.glob('*.json')}
    registry = parsed['locales.json']
    bundles = []
    digest = english_ui_digest(registry, root)
    for locale in registry['locales']:
        if not locale.get('publish', True) or locale['code'] == registry['defaultLocale']:
            continue
        manifest = parsed[Path(locale['homepageManifest']).name]
        if manifest.get('reviewedEnglishUi') != digest:
            raise RuntimeError(f"{locale['code']}: English locale UI changed; semantic review required")
        bundle = parsed[Path(locale['runtimeTranslation']).name]
        if bundle.get('locale') != locale['code'] or bundle.get('schemaVersion') != 1:
            raise RuntimeError(f"{locale['code']}: mismatched runtime bundle")
        if len({p['source'] for p in bundle['patterns']}) != len(bundle['patterns']):
            raise RuntimeError(f"{locale['code']}: duplicated pattern")
        for section in ('exact','attributes'):
            if any(not isinstance(v,str) or not v.strip() for v in bundle[section].values()):
                raise RuntimeError(f"{locale['code']}: empty {section} translation")
        for pattern in bundle['patterns']:
            groups = set(re.findall(r'\(\?<([\w-]+)>', pattern['source']))
            placeholders = set(re.findall(r'\{([\w-]+)\}', pattern['template']))
            if groups != placeholders:
                raise RuntimeError(f"{locale['code']}: missing/unknown template placeholder {pattern['source']}")
        bundles.append(bundle)
    # A locale cannot silently fall behind a source string already identified by
    # any maintained bundle. New English source changes also invalidate blob pins.
    for section in ('exact','attributes'):
        expected = set().union(*(set(b[section]) for b in bundles))
        for bundle in bundles:
            missing = expected - set(bundle[section])
            if missing:
                raise RuntimeError(f"{bundle['locale']}: missing {section} keys: {sorted(missing)}")
    for bundle in bundles:
        if {p['source'] for p in bundle['patterns']} != {p['source'] for p in bundles[0]['patterns']}:
            raise RuntimeError(f"{bundle['locale']}: missing runtime patterns")
    return len(bundles)


if __name__ == '__main__':
    import sys
    print(f'Verified {verify(sys.argv[1] if len(sys.argv)>1 else ".")} locale bundles and English UI review digests.')
