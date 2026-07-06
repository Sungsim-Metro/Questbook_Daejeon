/* Questbook Daejeon 정적 페이지에서 공유하는 UI 헬퍼를 제공한다. */
(function attachQuestbookUi(window, document) {
  'use strict';

  // 변수 의미: 공유 목업 데이터 네임스페이스다.
  const data = window.QuestbookMockData;

  // 변수 의미: 헤더와 내비게이션에서 사용하는 페이지 메타데이터다.
  const pageMeta = {
    home: { title: '모험가 홈', eyebrow: 'QUESTBOOK', icon: '✦', href: 'index.html' },
    map: { title: '탐험 지도', eyebrow: 'MAP', icon: '⌖', href: 'map.html' },
    quests: { title: '퀘스트 목록', eyebrow: 'QUEST', icon: '✓', href: 'quests.html' },
    notes: { title: '탐험 노트', eyebrow: 'NOTE', icon: '▤', href: 'notes.html' },
    badges: { title: '뱃지 수첩', eyebrow: 'BADGE', icon: '●', href: 'badges.html' },
  };

  // 변수 의미: 하단 내비게이션 항목 목록이다.
  const navigationItems = [
    { id: 'home', label: '홈', icon: '⌂' },
    { id: 'map', label: '지도', icon: '⌖' },
    { id: 'quests', label: '퀘스트', icon: '✓' },
    { id: 'notes', label: '수첩', icon: '▤' },
    { id: 'badges', label: '뱃지', icon: '●' },
  ];

  /**
   * 입력: 텍스트처럼 처리할 수 있는 값.
   * 출력: HTML 템플릿에 안전하게 넣을 수 있는 문자열.
   * 역할: 템플릿 문자열을 렌더링하기 전에 내부 목업 값을 이스케이프한다.
   * 호출 예시: const safeTitle = escapeHtml(quest.title);
   */
  function escapeHtml(value) {
    // 변수 의미: 정규화된 문자열 값이다.
    const text = String(value ?? '');
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 입력: 루트 요소 또는 document, CSS 선택자, 표시할 값.
   * 출력: 없음.
   * 역할: 대상 요소가 있을 때만 텍스트 내용을 갱신한다.
   * 호출 예시: setText(document, '[data-user-name]', user.nickname);
   */
  function setText(root, selector, value) {
    // 변수 의미: 선택된 DOM 요소다.
    const element = root.querySelector(selector);
    if (element) element.textContent = value;
  }

  /**
   * 입력: 루트 요소 또는 document, CSS 선택자, 표시할 값.
   * 출력: 없음.
   * 역할: 선택자와 일치하는 모든 요소의 텍스트 내용을 갱신한다.
   * 호출 예시: setAllText(document, "[data-user-name]", user.nickname);
   */
  function setAllText(root, selector, value) {
    // 변수 의미: 선택된 모든 DOM 요소다.
    const elements = root.querySelectorAll(selector);
    elements.forEach((element) => {
      element.textContent = value;
    });
  }

  /**
   * 입력: 사용자 데이터 객체.
   * 출력: 간단한 사용자 요약 문자열.
   * 역할: 헤더와 카드에서 반복해서 쓰는 상태 문구를 만든다.
   * 호출 예시: const summary = formatUserSummary(data.currentUser);
   */
  function formatUserSummary(user) {
    return `퀘스트 ${user.completedQuestCount}개 · ${user.totalDistanceKm}km`;
  }

  /**
   * 입력: 배지 ID 문자열.
   * 출력: 배지 객체 또는 undefined.
   * 역할: ID로 배지 정의를 찾는다.
   * 호출 예시: const badge = findBadgeById('green');
   */
  function findBadgeById(badgeId) {
    return data.badges.find((badge) => badge.id === badgeId);
  }

  /**
   * 입력: 장소 ID 문자열.
   * 출력: 장소 객체 또는 undefined.
   * 역할: ID로 퀘스트 장소 정의를 찾는다.
   * 호출 예시: const place = findPlaceById('hanbat-arboretum');
   */
  function findPlaceById(placeId) {
    return data.questPlaces.find((place) => place.id === placeId);
  }

  /**
   * 입력: 페이지 ID 문자열.
   * 출력: 없음.
   * 역할: 공유 메타데이터를 바탕으로 활성 페이지 헤더를 렌더링한다.
   * 호출 예시: renderHeader('map');
   */
  function renderHeader(pageId) {
    // 변수 의미: 요청한 페이지의 메타데이터다.
    const meta = pageMeta[pageId] || pageMeta.home;
    setText(document, '[data-app-icon]', meta.icon);
    setText(document, '[data-app-eyebrow]', meta.eyebrow);
    setText(document, '[data-app-title]', meta.title);
    setText(document, '[data-user-level]', `Lv.${data.currentUser.level}`);
  }

  /**
   * 입력: 페이지 ID 문자열.
   * 출력: 없음.
   * 역할: 공유 하단 내비게이션과 활성 상태를 렌더링한다.
   * 호출 예시: renderNavigation('quests');
   */
  function renderNavigation(pageId) {
    // 변수 의미: 대상 내비게이션 컨테이너다.
    const navigation = document.querySelector('[data-bottom-nav]');
    if (!navigation) return;

    navigation.innerHTML = navigationItems.map((item) => {
      // 변수 의미: 현재 내비게이션 항목의 메타데이터다.
      const meta = pageMeta[item.id];
      // 변수 의미: 현재 항목이 페이지와 일치하는지 여부다.
      const isActive = item.id === pageId;
      return `
        <a class="nav-link${isActive ? ' is-active' : ''}" href="${meta.href}" aria-current="${isActive ? 'page' : 'false'}">
          <span>${escapeHtml(item.icon)}</span>
          <span>${escapeHtml(item.label)}</span>
        </a>
      `;
    }).join('');
  }

  /**
   * 입력: 루트 요소 또는 document.
   * 출력: 없음.
   * 역할: 루트 안의 모든 공유 사용자 요약 자리표시자를 렌더링한다.
   * 호출 예시: renderUserSummary(document);
   */
  function renderUserSummary(root) {
    // 변수 의미: 현재 목업 사용자 데이터다.
    const user = data.currentUser;
    // 변수 의미: 포맷된 퀘스트 및 이동 거리 요약 문구다.
    const summary = formatUserSummary(user);
    setAllText(root, "[data-user-avatar]", user.avatar);
    setAllText(root, "[data-user-name]", user.nickname);
    setAllText(root, "[data-user-summary]", summary);
    setAllText(root, "[data-user-xp]", `${user.xp}XP`);
    setAllText(root, "[data-user-progress]", `${user.progressPercent}%`);
    setAllText(root, "[data-next-level]", `Lv.${user.level + 1}까지`);

    // 변수 의미: 현재 루트 안의 모든 진행률 채움 요소다.
    const progressFills = root.querySelectorAll('[data-user-progress-fill]');
    progressFills.forEach((progressFill) => {
      progressFill.style.width = `${user.progressPercent}%`;
    });
  }

  /**
   * 입력: 퀘스트 객체.
   * 출력: 퀘스트 카드 HTML 문자열.
   * 역할: 홈과 퀘스트 목록 화면에서 퀘스트 데이터를 일관되게 렌더링한다.
   * 호출 예시: questList.innerHTML = quests.map(renderQuestCard).join('');
   */
  function renderQuestCard(quest) {
    // 변수 의미: 퀘스트에 연결된 장소다.
    const place = findPlaceById(quest.placeId);
    // 변수 의미: 퀘스트에 연결된 배지다.
    const badge = findBadgeById(quest.badgeId);
    // 변수 의미: 장소 이름이 없을 때 사용할 대체 문구다.
    const placeName = place ? place.name : '장소 미정';
    // 변수 의미: 배지 아이콘이 없을 때 사용할 대체 아이콘이다.
    const badgeIcon = badge ? badge.icon : '✦';
    return `
      <article class="quest-card" tabindex="0">
        <span class="quest-icon">${escapeHtml(badgeIcon)}</span>
        <div class="quest-copy">
          <div class="quest-title">${escapeHtml(quest.title)}</div>
          <div class="quest-sub">${escapeHtml(placeName)} · ${escapeHtml(quest.distance)} · +${quest.xp} XP</div>
          <div class="quest-meta">
            <span class="type-chip">${escapeHtml(quest.type)}</span>
            <span class="state-chip">${escapeHtml(quest.status)}</span>
          </div>
        </div>
      </article>
    `;
  }

  /**
   * 입력: 배지 객체.
   * 출력: 배지 카드 HTML 문자열.
   * 역할: 획득 및 잠금 배지 상태를 일관되게 렌더링한다.
   * 호출 예시: grid.innerHTML = badges.map(renderBadgeCard).join('');
   */
  function renderBadgeCard(badge) {
    // 변수 의미: 획득 여부에 따른 상태 클래스다.
    const stateClass = badge.earned ? '' : ' is-locked';
    // 변수 의미: 배지 상태 표시 문구다.
    const stateLabel = badge.earned ? badge.type : '미발견 배지';
    return `
      <article class="badge-card${stateClass}">
        <div class="badge-symbol" style="color:${escapeHtml(badge.color)}">${escapeHtml(badge.icon)}</div>
        <div class="badge-name">${escapeHtml(badge.name)}</div>
        <div class="badge-sub">${escapeHtml(stateLabel)}</div>
      </article>
    `;
  }

  /**
   * 입력: 페이지 ID 문자열.
   * 출력: 없음.
   * 역할: 공유 헤더, 내비게이션, 사용자 자리표시자를 초기화한다.
   * 호출 예시: initCommonPage('home');
   */
  function initCommonPage(pageId) {
    renderHeader(pageId);
    renderNavigation(pageId);
    renderUserSummary(document);
  }

  // 변수 의미: 페이지 스크립트에서 사용할 공유 UI 헬퍼를 공개한다.
  window.QuestbookUi = {
    escapeHtml,
    setText,
    setAllText,
    formatUserSummary,
    findBadgeById,
    findPlaceById,
    renderQuestCard,
    renderBadgeCard,
    initCommonPage,
  };
}(window, document));
