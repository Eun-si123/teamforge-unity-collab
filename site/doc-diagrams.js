/* Only documentation diagrams load Mermaid; original source remains available. */
const blocks = [...document.querySelectorAll('pre > code.language-mermaid')];
if (blocks.length) {
  const locale = document.documentElement.lang;
  const labels = locale === 'ko' ? ['다이어그램 보기','다이어그램 원문','다이어그램을 불러오지 못했습니다. 아래 원문을 확인하세요.'] : locale === 'zh-Hans' ? ['查看图表','图表源代码','无法加载图表。请查看下方源代码。'] : ['Show diagram','Diagram source','The diagram could not load. The source below is still available.'];
  let modulePromise;
  let renderQueue = Promise.resolve();
  const rendered = [];
  for (const [index, code] of blocks.entries()) {
    const pre = code.parentElement;
    const source = code.textContent;
    const button = document.createElement('button');
    button.type='button';button.className='btn';button.textContent=labels[0];
    const details = document.createElement('details');
    const summary = document.createElement('summary');summary.textContent=labels[1];
    const result = document.createElement('div');result.className='rendered-diagram';
    result.tabIndex=0;result.setAttribute('role','region');result.setAttribute('aria-label',labels[0]);
    pre.before(button,result,details);details.append(summary,pre);
    const render = async () => {
      button.disabled=true;button.setAttribute('aria-busy','true');
      try {
        modulePromise ||= import('https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs');
        const {default:mermaid}=await modulePromise;
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:document.documentElement.dataset.theme==='light'?'neutral':'dark'});
        const presentation = source.replace(/^(flowchart|graph) LR/m, '$1 TB').replace(/\\n/g, '<br/>');
        const {svg}=await mermaid.render(`teamforge-diagram-${index}`,presentation);
        result.innerHTML=svg;button.hidden=true;
      } catch { result.textContent=labels[2];details.open=true; }
      finally {button.removeAttribute('aria-busy');}
    };
    button.addEventListener('click', () => {
      rendered.push(render);
      renderQueue = renderQueue.then(render);
    }, {once:true});
  }
  new MutationObserver(() => {
    for (const render of rendered) renderQueue = renderQueue.then(render);
  }).observe(document.documentElement, {attributes:true,attributeFilter:['data-theme']});
}
