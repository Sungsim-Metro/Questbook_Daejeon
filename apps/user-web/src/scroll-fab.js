/* 스크롤 방향 기반 플로팅 버튼 (user-web SPA용).
   .app-main(스크롤 컨테이너)에 리스너를 직접 달아,
   아래로 스크롤 → ↓, 위로 스크롤 → ↑ 버튼을 즉시 표시한다.
   SPA 뷰 전환(data-view-target)과 무관하게 동작한다. */
(function attachScrollFab(window, document) {
  'use strict';

  // 변수 의미: 맨 위/맨 아래 근처에서 버튼을 숨길 여유 거리(px)다.
  const EDGE_HIDE = 60;
  // 변수 의미: 방향 판정에 필요한 최소 스크롤 변화량(px)이다.
  const MIN_DELTA = 2;

  function init() {
    // 변수 의미: 실제 스크롤이 일어나는 컨테이너다 (window가 아님!).
    const scroller = document.getElementById('main-content') || document.querySelector('.app-main');
    // 변수 의미: 버튼을 붙일 앱 셸이다.
    const shell = document.querySelector('.app-shell');
    if (!scroller || !shell) return;

    // 변수 의미: 플로팅 버튼 요소다.
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'scroll-fab';
    fab.setAttribute('aria-label', '화면 이동');
    fab.textContent = '↓';
    shell.appendChild(fab);

    // 변수 의미: 직전 scrollTop 값이다.
    let lastTop = scroller.scrollTop;
    // 변수 의미: 현재 표시 방향('down' | 'up' | null)이다.
    let direction = null;

    function apply() {
      fab.textContent = direction === 'up' ? '↑' : '↓';
      fab.setAttribute('aria-label', direction === 'up' ? '맨 위로' : '맨 아래로');
      fab.classList.toggle('is-visible', Boolean(direction));
    }

    function update() {
      const top = scroller.scrollTop;
      const nearTop = top < EDGE_HIDE;
      const nearBottom = top + scroller.clientHeight >= scroller.scrollHeight - EDGE_HIDE;

      if (top > lastTop + MIN_DELTA) direction = 'down';
      else if (top < lastTop - MIN_DELTA) direction = 'up';
      lastTop = top;

      // 이미 끝에 도달한 방향이면 숨긴다.
      if (direction === 'down' && nearBottom) direction = null;
      if (direction === 'up' && nearTop) direction = null;
      apply();
    }

    scroller.addEventListener('scroll', update, { passive: true });

    // SPA 뷰가 바뀌면(홈→지도 등) 버튼을 초기화한다.
    const observer = new MutationObserver(() => {
      direction = null;
      lastTop = scroller.scrollTop;
      apply();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-active-view'] });

    fab.addEventListener('click', () => {
      scroller.scrollTo({
        top: direction === 'up' ? 0 : scroller.scrollHeight,
        behavior: 'smooth',
      });
      direction = null;
      apply();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window, document));
