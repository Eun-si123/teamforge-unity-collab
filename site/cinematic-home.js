/* Decorative cinematic layer. Keep canonical homepage DOM and locale translations intact. */
(() => {
  'use strict';
  const hero = document.querySelector('header.hero .hero-grid')?.closest('header.hero');
  if (!hero || !document.getElementById('collabLab')) return;
  document.body.classList.add('tfc-home');
  const stage = document.createElement('div');
  stage.className = 'tfc-stage';
  stage.setAttribute('aria-hidden','true');
  stage.innerHTML = '<div class="tfc-reactor"><div class="tfc-ring"></div><div class="tfc-ring"></div><div class="tfc-ring"></div><div class="tfc-ring"></div><div class="tfc-ticks"></div><div class="tfc-core"><div class="tfc-cube"><i class="tfc-face front"></i><i class="tfc-face back"></i><i class="tfc-face left"></i><i class="tfc-face right"></i><i class="tfc-face top"></i><i class="tfc-face bottom"></i></div></div></div><div class="tfc-scene-label">EDITOR A / HOST &nbsp; • &nbsp; ONLINE</div><div class="tfc-scene-label">EDITOR B / GUEST &nbsp; ↗ &nbsp; IN SYNC</div><div class="tfc-scanline"></div>';
  hero.prepend(stage);
  const ticker = document.createElement('div');
  ticker.className = 'tfc-ticker';
  ticker.setAttribute('aria-hidden','true');
  const phrase = '<span>BUILD <b>✳</b> SYNC <b>✳</b> CREATE <b>✳</b> TOGETHER <b>✳</b></span>';
  ticker.innerHTML = '<div class="tfc-ticker-track">'+phrase.repeat(8)+'</div>';
  hero.after(ticker);
  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');
  if(!prefersReduced.matches && window.innerWidth>900) {
    const reactor = stage.querySelector('.tfc-reactor');
    let scheduled = false, nextX = 0, nextY = 0;
    document.addEventListener('pointermove',event=>{
      const rect=hero.getBoundingClientRect();
      if(rect.bottom<0||rect.top>window.innerHeight) return;
      nextX=(event.clientX-innerWidth*.65)/65;
      nextY=(event.clientY-innerHeight*.5)/90;
      if(!scheduled){scheduled=true;requestAnimationFrame(()=>{reactor.style.setProperty('--tfc-x',nextX+'px');reactor.style.setProperty('--tfc-y',nextY+'px');scheduled=false})}
    },{passive:true});
  }
  const targets = document.querySelectorAll('#demo .section-head,#proof .proof-layout,#features .scope-layout,#workflow .scope-layout,#contribute .contribution');
  if('IntersectionObserver' in window && !prefersReduced.matches) {
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('tfc-visible');observer.unobserve(entry.target)}
    }),{threshold:.08});
    targets.forEach(target=>{target.classList.add('tfc-reveal');observer.observe(target)});
  }
})();