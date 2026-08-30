(() => {
  'use strict';

  if (!document.documentElement.lang.toLowerCase().startsWith('ko')) return;

  const exact = new Map([
    ['A small Scene editor, built to explain the real workflow.', '실제 흐름을 설명하기 위해 만든 작은 Scene Editor.'],
    ['Both browser Editors share GameObjects, Transform changes, creation, deletion, names, and ownership — while each keeps its own Scene camera, selection, and tool state. It is an interactive illustration of TeamForge, not Unity running in the page.', '두 브라우저 Editor는 GameObject, Transform 변경, 생성·삭제, 이름과 Ownership을 공유하지만 Scene 카메라, Selection과 Tool 상태는 각 Editor에 따로 유지됩니다. 실제 Unity가 웹페이지에서 실행되는 것이 아니라 TeamForge의 동작 개념을 보여주는 인터랙티브 예시입니다.'],
    ['session / ', '세션 / '],
    ['loading', '불러오는 중'],
    ['Preparing miniature Scene editors', '미니 Scene Editor를 준비하는 중'],
    ['+ Create', '+ 생성'],
    ['Duplicate', '복제'],
    ['Delete', '삭제'],
    ['Lock', '잠금'],
    ['Unlock', '잠금 해제'],
    ['Reset', '초기화'],
    ['Loading the 3D Scene controls…', '3D Scene 컨트롤을 불러오는 중…'],
    ['unavailable', '사용 불가'],
    ['3D controls could not load', '3D 컨트롤을 불러오지 못함'],
    ['The interactive browser simulation could not load its pinned 3D modules. The real TeamForge development capture below is still available.', '인터랙티브 브라우저 시뮬레이션에 필요한 고정된 3D 모듈을 불러오지 못했습니다. 아래의 실제 TeamForge 개발 캡처는 계속 확인할 수 있습니다.'],
    ['connected', '연결됨'],
    ['Shared Scene ready', '공유 Scene 준비 완료'],
    ['Interactive browser simulation.', '인터랙티브 브라우저 시뮬레이션.'],
    ['Shared objects and ownership are mirrored; Scene cameras, selections, and tools stay local to each editor.', '공유 Object와 Ownership은 서로 동기화되지만 Scene 카메라, Selection과 Tool은 각 Editor에 로컬로 유지됩니다.'],
    ['concept interaction · real TeamForge capture ↓', '개념 인터랙션 · 실제 TeamForge 캡처 ↓'],
    ['Host', '호스트'],
    ['Peer', '피어'],
    ['interactive', '인터랙티브'],
    ['camera local · scene shared', '카메라는 로컬 · Scene은 공유'],
    ['View', '보기'],
    ['Move', '이동'],
    ['Rotate', '회전'],
    ['Scale', '크기'],
    ['Global', '글로벌'],
    ['Local', '로컬'],
    ['Frame', '프레임'],
    ['Top', '위'],
    ['Front', '앞'],
    ['Right', '오른쪽'],
    ['Nothing selected.', '선택된 항목이 없습니다.'],
    ['Position', '위치'],
    ['Rotation', '회전'],
    ['Owner · shared', '소유자 · 공유'],
    ['None', '없음'],
    ['Shared Scene ready · both editors are interactive', '공유 Scene 준비 완료 · 두 Editor 모두 조작 가능'],
    ['Demo reset · shared Scene restored', '데모 초기화 · 공유 Scene 복원됨'],
    ['Scene', 'Scene'],
    ['Inspector', 'Inspector'],
    ['Hierarchy', 'Hierarchy']
  ]);

  const attributes = new Map([
    ['Create GameObject', 'GameObject 생성'],
    ['Choose editor', 'Editor 선택'],
    ['GameObject active', 'GameObject 활성화'],
    ['GameObject name', 'GameObject 이름'],
    ['Editor A interactive Scene view', 'Editor A 인터랙티브 Scene 뷰'],
    ['Editor B interactive Scene view', 'Editor B 인터랙티브 Scene 뷰']
  ]);

  const patterns = [
    [/^Locked · ([AB])$/, '잠김 · $1'],
    [/^Owner · Editor ([AB])$/, '소유자 · Editor $1'],
    [/^Type · (.+)$/, '타입 · $1'],
    [/^(Editor [AB](?: · [^·]+)?) handles · Global$/, '$1 핸들 · 글로벌'],
    [/^(Editor [AB](?: · [^·]+)?) handles · Local$/, '$1 핸들 · 로컬'],
    [/^(.+) Transform mirrored from (Editor [AB](?: · .+)?)$/, '$1 Transform이 $2에서 동기화됨'],
    [/^(.+) (position|rotation|scale) edited in (Editor [AB](?: · .+)?)$/, (_m, name, prop, editor) => `${name} ${prop === 'position' ? '위치' : prop === 'rotation' ? '회전' : '크기'}를 ${editor}에서 편집함`],
    [/^(Editor [AB](?: · .+)?) selected (.+)$/, '$1에서 $2 선택됨'],
    [/^(Editor [AB](?: · .+)?) cleared selection$/, '$1 Selection 해제됨'],
    [/^(Editor [AB](?: · .+)?) · View tool$/, '$1 · 보기 Tool'],
    [/^(Editor [AB](?: · .+)?) · Move tool$/, '$1 · 이동 Tool'],
    [/^(Editor [AB](?: · .+)?) · Rotate tool$/, '$1 · 회전 Tool'],
    [/^(Editor [AB](?: · .+)?) · Scale tool$/, '$1 · 크기 Tool'],
    [/^(Editor [AB](?: · .+)?) camera · top$/, '$1 카메라 · 위'],
    [/^(Editor [AB](?: · .+)?) camera · front$/, '$1 카메라 · 앞'],
    [/^(Editor [AB](?: · .+)?) camera · right$/, '$1 카메라 · 오른쪽'],
    [/^(Editor [AB](?: · .+)?) camera · iso$/, '$1 카메라 · ISO'],
    [/^(.+) created in (Editor [AB](?: · .+)?) and mirrored$/, '$1이(가) $2에서 생성되어 동기화됨'],
    [/^(.+) duplicated in (Editor [AB](?: · .+)?) and mirrored$/, '$1이(가) $2에서 복제되어 동기화됨'],
    [/^(.+) deleted in (Editor [AB](?: · .+)?) and mirrored$/, '$1이(가) $2에서 삭제되어 동기화됨'],
    [/^(.+) locked by (Editor [AB](?: · .+)?)$/, '$1을(를) $2에서 잠금'],
    [/^(.+) lock released by (Editor [AB](?: · .+)?)$/, '$1의 잠금을 $2에서 해제함'],
    [/^Locked · (.+)$/, '잠김 · $1']
  ];

  const translateValue = (value) => {
    if (!value) return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    let translated = exact.get(trimmed);
    if (translated === undefined) {
      for (const [pattern, replacement] of patterns) {
        if (!pattern.test(trimmed)) continue;
        pattern.lastIndex = 0;
        translated = typeof replacement === 'function'
          ? trimmed.replace(pattern, (...args) => replacement(...args))
          : trimmed.replace(pattern, replacement);
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

  const attach = () => {
    const demo = document.getElementById('demo');
    if (!demo) return;
    translateTree(demo);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') {
          translateTree(record.target);
          continue;
        }
        if (record.type === 'attributes') {
          translateElement(record.target);
          continue;
        }
        record.addedNodes.forEach(translateTree);
      }
    });
    observer.observe(demo, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'title']
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
})();
