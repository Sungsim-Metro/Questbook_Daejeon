/* Questbook Daejeon 정적 앱의 페이지 초기화 함수를 제공한다. */
(function attachQuestbookMain(window, document) {
  'use strict';

  // 변수 의미: 공유 목업 데이터 네임스페이스다.
  const data = window.QuestbookMockData;
  // 변수 의미: 공유 UI 헬퍼 모음이다.
  const ui = window.QuestbookUi;

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 공유 목업 데이터를 바탕으로 홈 화면을 렌더링한다.
   * 호출 예시: initHomePage();
   */
  function initHomePage() {
    // 변수 의미: 홈 지표에 사용할 획득 완료 배지 목록이다.
    const earnedBadges = data.badges.filter((badge) => badge.earned);
    // 변수 의미: 메인 추천 퀘스트다.
    const recommendedQuest = data.quests[0];
    // 변수 의미: 추천 퀘스트에 연결된 장소다.
    const recommendedPlace = ui.findPlaceById(recommendedQuest.placeId);
    // 변수 의미: 추천 퀘스트에 연결된 배지다.
    const recommendedBadge = ui.findBadgeById(recommendedQuest.badgeId);

    ui.setText(document, '[data-location-name]', data.currentLocation.name);
    ui.setText(document, '[data-earned-badge-count]', `${earnedBadges.length}개`);
    ui.setText(document, '[data-nearby-quest-count]', `${data.quests.length}개`);
    ui.setText(document, '[data-reward-count]', `${data.currentUser.rewardCount}개`);

    // 변수 의미: 추천 카드 DOM 요소다.
    const recommendElement = document.querySelector('[data-home-recommend]');
    if (recommendElement) {
      recommendElement.innerHTML = `
        <span class="card-icon" style="color:${ui.escapeHtml(recommendedBadge.color)}">${ui.escapeHtml(recommendedBadge.icon)}</span>
        <div class="card-copy">
          <div class="card-title">${ui.escapeHtml(recommendedQuest.title)}</div>
          <div class="card-sub">${ui.escapeHtml(recommendedPlace.name)} · ${ui.escapeHtml(recommendedQuest.type)} · +${recommendedQuest.xp} XP</div>
        </div>
        <a class="text-button" href="map.html">보기</a>
      `;
    }
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 퀘스트 필터와 현재 퀘스트 목록을 렌더링한다.
   * 호출 예시: initQuestsPage();
   */
  function initQuestsPage() {
    // 변수 의미: 퀘스트 필터 컨테이너다.
    const filterElement = document.querySelector('[data-quest-filters]');
    // 변수 의미: 퀘스트 목록 컨테이너다.
    const listElement = document.querySelector('[data-quest-list]');
    if (!filterElement || !listElement) return;

    /**
     * 입력: 퀘스트 유형 필터 문자열.
     * 출력: 없음.
     * 역할: 선택된 필터에 맞는 퀘스트 목록을 렌더링한다.
     * 호출 예시: renderFilteredQuests('방문형');
     */
    function renderFilteredQuests(filterValue) {
      // 변수 의미: 선택된 필터와 일치하는 퀘스트 목록이다.
      const filteredQuests = filterValue === '추천'
        ? data.quests
        : data.quests.filter((quest) => quest.type === filterValue);
      listElement.innerHTML = filteredQuests.length
        ? filteredQuests.map(ui.renderQuestCard).join('')
        : '<div class="empty-note">해당 유형의 더미 퀘스트가 아직 없습니다.</div>';
    }

    /**
     * 입력: 클릭 이벤트 객체.
     * 출력: 없음.
     * 역할: 활성 필터 상태를 갱신하고 퀘스트 목록을 다시 렌더링한다.
     * 호출 예시: filterElement.addEventListener('click', handleFilterClick);
     */
    function handleFilterClick(event) {
      // 변수 의미: 클릭된 필터 버튼이다.
      const filterButton = event.target.closest('[data-filter-value]');
      if (!filterButton) return;
      filterElement.querySelectorAll('[data-filter-value]').forEach((button) => {
        button.classList.toggle('is-active', button === filterButton);
      });
      renderFilteredQuests(filterButton.dataset.filterValue);
    }

    filterElement.addEventListener('click', handleFilterClick);
    renderFilteredQuests('추천');
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 탐험 노트 화면을 렌더링한다.
   * 호출 예시: initNotesPage();
   */
  function initNotesPage() {
    // 변수 의미: 노트 목록 컨테이너다.
    const noteListElement = document.querySelector('[data-note-list]');
    if (!noteListElement) return;

    noteListElement.innerHTML = data.adventureNotes.map((note) => `
      <article class="note-card">
        <span class="note-icon">${ui.escapeHtml(note.icon)}</span>
        <div class="note-copy">
          <div class="note-title">${ui.escapeHtml(note.title)}</div>
          <div class="note-sub">${ui.escapeHtml(note.time)} · ${ui.escapeHtml(note.summary)}</div>
        </div>
        <span class="state-chip">${ui.escapeHtml(note.badge)}</span>
      </article>
    `).join('');
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 뱃지 수첩 화면을 렌더링한다.
   * 호출 예시: initBadgesPage();
   */
  function initBadgesPage() {
    // 변수 의미: 획득 완료 배지 목록이다.
    const earnedBadges = data.badges.filter((badge) => badge.earned);
    // 변수 의미: 대표로 표시할 배지다.
    const featuredBadge = earnedBadges[0] || data.badges[0];
    // 변수 의미: 배지 그리드 컨테이너다.
    const badgeGridElement = document.querySelector('[data-badge-grid]');
    // 변수 의미: 스탬프 줄 컨테이너다.
    const stampRowElement = document.querySelector('[data-stamp-row]');

    ui.setText(document, '[data-featured-badge-icon]', featuredBadge.icon);
    ui.setText(document, '[data-featured-badge-name]', featuredBadge.name);
    ui.setText(document, '[data-featured-badge-type]', featuredBadge.type);
    ui.setText(document, '[data-featured-badge-xp]', `+${featuredBadge.xp} XP 적립`);

    if (badgeGridElement) {
      badgeGridElement.innerHTML = data.badges.map(ui.renderBadgeCard).join('');
    }

    if (stampRowElement) {
      stampRowElement.innerHTML = data.badges.map((badge) => {
        // 변수 의미: 스탬프 상태 클래스다.
        const stampClass = badge.earned ? 'is-done' : 'is-empty';
        // 변수 의미: 스탬프 표시 문구다.
        const stampLabel = badge.earned ? badge.icon : '';
        return `<div class="stamp ${stampClass}">${ui.escapeHtml(stampLabel)}</div>`;
      }).join('');
    }
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 공통 설정 뒤 페이지별 렌더링 함수를 실행한다.
   * 호출 예시: initPage();
   */
  function initPage() {
    // 변수 의미: body 데이터셋에서 읽은 현재 페이지 ID다.
    const pageId = document.body.dataset.page || 'home';
    ui.initCommonPage(pageId);

    if (pageId === 'home') initHomePage();
    if (pageId === 'map' && window.QuestbookMap) window.QuestbookMap.initMapPage();
    if (pageId === 'quests') initQuestsPage();
    if (pageId === 'notes') initNotesPage();
    if (pageId === 'badges') initBadgesPage();
  }

  document.addEventListener('DOMContentLoaded', initPage);
}(window, document));
