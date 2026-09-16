/* Field Map 사이드 메뉴.
   기존 .bottom-nav의 링크를 그대로 재사용해 우측 북마크 드로어로 옮긴다.
   app.js의 라우팅(data-view-target 등)을 건드리지 않으므로 클릭 동작이 유지된다. */
(function attachFieldMapMenu(window, document) {
  'use strict';

  function build() {
    // 변수 의미: 앱 셸(드로어의 기준 컨테이너)이다.
    const shell = document.querySelector('.app-shell');
    // 변수 의미: 원래 하단 탭바다 (CSS로 숨겨진 상태).
    const bottomNav = document.querySelector('.bottom-nav');
    if (!shell || !bottomNav || shell.querySelector('.fm-menu-panel')) return false;
    if (!bottomNav.children.length) return false;

    // 변수 의미: 배경 스크림 버튼이다.
    const scrim = document.createElement('button');
    scrim.type = 'button';
    scrim.className = 'fm-menu-scrim';
    scrim.setAttribute('aria-label', '메뉴 닫기');

    // 변수 의미: 드로어 패널이다.
    const panel = document.createElement('nav');
    panel.className = 'fm-menu-panel';
    panel.setAttribute('aria-label', '주요 화면 이동');
    panel.innerHTML =
      '<div class="fm-menu-head">' +
      '<span class="fm-menu-tag">MENU</span>' +
      '<strong class="fm-menu-title">모험가의 수첩</strong>' +
      '</div>';

    // 하단 탭바의 링크를 드로어로 이동한다 (복제가 아니라 이동 — 이벤트/상태 유지).
    Array.from(bottomNav.children).forEach((link) => panel.appendChild(link));
    // app.js가 .bottom-nav를 다시 렌더링해도 드로어가 우선하도록 참조를 남긴다.
    bottomNav.dataset.fmMoved = 'true';

    const foot = document.createElement('p');
    foot.className = 'fm-menu-foot';
    foot.textContent = '꿈돌이는 1993년 대전 엑스포 공식 마스코트입니다.';
    panel.appendChild(foot);

    // 변수 의미: 우측 북마크 토글 버튼이다.
    const bookmark = document.createElement('button');
    bookmark.type = 'button';
    bookmark.className = 'fm-bookmark';
    bookmark.setAttribute('aria-label', '메뉴 열기');
    bookmark.setAttribute('aria-expanded', 'false');
    bookmark.textContent = '메뉴';

    function setOpen(open) {
      shell.classList.toggle('fm-menu-open', open);
      bookmark.setAttribute('aria-expanded', String(open));
    }

    bookmark.addEventListener('click', () => {
      setOpen(!shell.classList.contains('fm-menu-open'));
    });
    scrim.addEventListener('click', () => setOpen(false));
    panel.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });

    shell.appendChild(bookmark);
    shell.appendChild(scrim);
    shell.appendChild(panel);
    return true;
  }

  function init() {
    if (build()) return;
    // app.js가 탭바를 비동기로 렌더링하는 경우를 대비해 잠시 재시도한다.
    // 변수 의미: 남은 재시도 횟수다.
    let tries = 20;
    const timer = setInterval(() => {
      if (build() || --tries <= 0) clearInterval(timer);
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(window, document));
