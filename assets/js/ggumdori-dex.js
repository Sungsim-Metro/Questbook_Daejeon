/* 꿈돌이 캐릭터 도감 + 장착 시스템 (3a 디자인).
   [data-gd-hero]와 [data-gd-dex]가 있는 페이지에서 동작한다.
   장착 상태는 localStorage('questbook.equippedCharacter')에 저장된다. */
(function attachGgumdoriDex(window, document) {
  'use strict';

  // 변수 의미: 캐릭터 정의 목록이다. unlocked는 추후 실제 유저 데이터와 연결한다.
  const characters = [
    { id: 'wave', img: 'assets/img/ggumdori-wave.png', name: '기본 꿈돌이', quote: '오늘은 어디로 갈까?', condition: '기본 지급', unlocked: true },
    { id: 'bread', img: 'assets/img/ggumdori-bread.png', name: '빵 꿈돌이', quote: '갓 구운 빵 냄새다!', condition: '빵지순례 1회', unlocked: true },
    { id: 'bike', img: 'assets/img/ggumdori-bike.png', name: '타슈 꿈돌이', quote: '바람이 시원해!', condition: 'Lv.4 달성', unlocked: false },
    { id: 'robe', img: 'assets/img/ggumdori-robe.png', name: '온천 꿈돌이', quote: '따끈따끈~', condition: '유성온천 방문', unlocked: false },
  ];

  // 변수 의미: 장착 캐릭터를 저장하는 localStorage 키다.
  const STORAGE_KEY = 'questbook.equippedCharacter';

  function getEquipped() {
    // 변수 의미: 저장된 캐릭터 ID다.
    const savedId = localStorage.getItem(STORAGE_KEY);
    return characters.find((c) => c.id === savedId && c.unlocked) || characters[0];
  }

  function renderHero() {
    // 변수 의미: 히어로 카드 루트 요소다.
    const hero = document.querySelector('[data-gd-hero]');
    if (!hero) return;
    // 변수 의미: 현재 장착 중인 캐릭터다.
    const equipped = getEquipped();
    const imgEl = hero.querySelector('[data-gd-hero-img]');
    if (imgEl) imgEl.style.backgroundImage = `url('${equipped.img}')`;
    const nameEl = hero.querySelector('[data-gd-hero-name]');
    if (nameEl) nameEl.textContent = equipped.name;
    const quoteEl = hero.querySelector('[data-gd-hero-quote]');
    if (quoteEl) quoteEl.textContent = equipped.quote;
  }

  function renderDex() {
    // 변수 의미: 도감 그리드 컨테이너다.
    const grid = document.querySelector('[data-gd-dex]');
    if (!grid) return;
    // 변수 의미: 현재 장착 중인 캐릭터 ID다.
    const equippedId = getEquipped().id;

    grid.innerHTML = characters.map((c) => {
      // 변수 의미: 타일 상태 클래스 문자열이다.
      const classes = [
        'gd-dex-tile',
        c.id === equippedId ? 'is-equipped' : '',
        c.unlocked ? '' : 'is-locked',
      ].filter(Boolean).join(' ');
      return `
        <button type="button" class="${classes}" data-gd-char="${c.id}" ${c.unlocked ? '' : 'disabled'}>
          <span class="gd-dex-thumb" style="background-image:url('${c.img}')">
            ${c.unlocked ? '' : '<span class="gd-dex-lock">🔒</span>'}
          </span>
          <span class="gd-dex-name">${c.name}</span>
          <span class="gd-dex-cond">${c.condition}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('[data-gd-char]').forEach((tile) => {
      tile.addEventListener('click', () => {
        localStorage.setItem(STORAGE_KEY, tile.getAttribute('data-gd-char'));
        renderHero();
        renderDex();
      });
    });
  }

  function init() {
    renderHero();
    renderDex();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 변수 의미: 다른 스크립트에서 재사용할 수 있는 공개 API다.
  window.QuestbookDex = { characters, getEquipped, renderHero, renderDex };
}(window, document));
