#!/usr/bin/env python3
"""Check generated human routes, fragments, assets and progressive-enhancement contracts."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import sys

BASE = 'https://eun-si123.github.io/teamforge-unity-collab/'
class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.links, self.assets, self.ids, self.videos, self.h1 = [], [], set(), [], 0
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'): self.ids.add(attrs['id'])
        if tag == 'h1': self.h1 += 1
        if tag == 'a' and 'href' in attrs: self.links.append(attrs['href'])
        if tag in ('script', 'img', 'source') and attrs.get('src'): self.assets.append(attrs['src'])
        if tag == 'video':
            self.videos.append(attrs)
            if attrs.get('poster'): self.assets.append(attrs['poster'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet': self.assets.append(attrs['href'])

def verify(root):
    root = root.resolve()
    pages = {p.resolve(): Page(p.read_text()) for p in root.rglob('*.html') if not p.name.startswith('__')}
    errors = []
    routes = {p: page for p, page in pages.items() if p.name == 'index.html'}
    for path, page in routes.items():
        label = str(path.relative_to(root))
        if page.h1 != 1: errors.append(f'{label}: expected one h1, got {page.h1}')
        for href in page.links + page.assets:
            url = urlsplit(href)
            if url.scheme and not href.startswith(BASE): continue
            if href.startswith('//'): continue
            relative = url.path
            if relative.startswith('/teamforge-unity-collab/'): relative = relative[len('/teamforge-unity-collab/'):]
            target = root / relative.lstrip('/') if url.scheme or relative.startswith('/') else path.parent / relative
            if not relative: target = path
            if target.is_dir(): target /= 'index.html'
            target = target.resolve()
            if not target.is_relative_to(root) or not target.exists():
                errors.append(f'{label}: missing local target {href}')
            elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                errors.append(f'{label}: missing fragment {href}')
        for video in page.videos:
            if 'autoplay' in video or video.get('preload') != 'none' or 'controls' not in video:
                errors.append(f'{label}: evidence video must be user-controlled and not eagerly loaded')
    for locale in ('', 'ko/', 'zh-hans/'):
        page = routes[root / locale / 'index.html']
        required = {'main', 'demo', 'collabLab', 'moveButton', 'peerMoveButton', 'lockButton', 'resetButton', 'loadDemo', 'status'}
        if required - page.ids: errors.append(f'{locale}: missing accessible demo/landing targets {required - page.ids}')
    for slug in ('docs', 'about', 'contributing'):
        if root / slug / 'index.html' not in routes: errors.append(f'missing {slug} route')
    if errors: raise SystemExit('\n'.join(errors))
    print(f'Verified {len(routes)} human routes: single titles, local links/fragments/assets, accessible demo controls and user-controlled evidence video.')

if __name__ == '__main__': verify(Path(sys.argv[1]))
