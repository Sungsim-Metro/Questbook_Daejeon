/* 실제 로그인, 퀘스트, 배지, 지도 API가 준비되기 전 사용하는 Questbook Daejeon 목업 데이터 소스다. */
(function attachQuestbookMockData(window) {
  'use strict';

  // 변수 의미: 현재 로그인 상태를 대신하는 목업 사용자 데이터다.
  const currentUser = {
    nickname: '꼬마 탐험가',
    avatar: '😊',
    level: 3,
    xp: 320,
    progressPercent: 64,
    completedQuestCount: 7,
    totalDistanceKm: 8.3,
    rewardCount: 1,
  };

  // 변수 의미: GPS 연동 전 현재 위치를 대신하는 목업 데이터다.
  const currentLocation = {
    name: '대전 중앙로',
    latitude: 36.327,
    longitude: 127.427,
    source: 'mock',
  };

  // 변수 의미: 여러 화면에서 재사용하는 배지 정의 목록이다.
  const badges = [
    { id: 'green', icon: '🌳', name: '초록 탐험가', type: '자연 관찰', earned: true, xp: 50, color: '#0a8f48', description: '도심 속 녹지를 방문하고 관찰 기록을 남긴 탐험가 배지입니다.' },
    { id: 'science', icon: '🧪', name: '과학 탐험가', type: '과학 문화', earned: true, xp: 80, color: '#70bd88', description: '과학 전시와 체험형 관광지를 탐방한 기록입니다.' },
    { id: 'walker', icon: '🗼', name: '대전 워커', type: '원도심 걷기', earned: true, xp: 40, color: '#d39172', description: '원도심 골목과 명소를 걸어서 연결한 탐험 기록입니다.' },
    { id: 'bakery', icon: '🥐', name: '빵지순례자', type: '지역 상권', earned: false, xp: 60, color: '#c9943f', description: '대전 로컬 빵집과 상권 방문 인증 배지입니다.' },
    { id: 'rider', icon: '🚲', name: '타슈 라이더', type: '이동형', earned: false, xp: 70, color: '#4b9fb8', description: '타슈와 대중교통을 활용해 이동한 탐험 기록입니다.' },
    { id: 'view', icon: '💡', name: '전망 수집가', type: '야경 기록', earned: false, xp: 70, color: '#9d91bf', description: '전망 명소와 야간 관광지를 기록하는 배지입니다.' },
  ];

  // 변수 의미: 향후 OpenAPI 또는 내부 데이터셋에 매핑할 퀘스트 및 관광지 장소 목록이다.
  const questPlaces = [
    { id: 'hanbat-arboretum', badgeId: 'green', name: '한밭수목원', category: '퀘스트 장소', latitude: 36.3671, longitude: 127.3882, x: 18, y: 16, recommended: true, summary: '대전 대표 도심 수목원에서 자연 관찰 노트를 완성합니다.' },
    { id: 'science-museum', badgeId: 'science', name: '국립중앙과학관', category: '퀘스트 장소', latitude: 36.3762, longitude: 127.3745, x: 63, y: 26, recommended: true, summary: '과학 전시를 둘러보고 체험형 탐험 기록을 남깁니다.' },
    { id: 'eunhaeng-dong', badgeId: 'walker', name: '은행동 스카이로드', category: '추천 관광지', latitude: 36.3284, longitude: 127.4277, x: 45, y: 49, recommended: true, summary: '원도심 걷기 동선의 중심이 되는 야간 산책 포인트입니다.' },
    { id: 'sungsimdang', badgeId: 'bakery', name: '성심당 본점', category: '퀘스트 장소', latitude: 36.3275, longitude: 127.4273, x: 25, y: 58, recommended: false, summary: '지역 상권 소비형 퀘스트와 연결되는 빵지순례 장소입니다.' },
    { id: 'tashu-station', badgeId: 'rider', name: '타슈 중앙로 거점', category: '이동 추천', latitude: 36.3267, longitude: 127.4262, x: 59, y: 66, recommended: false, summary: '이동형 퀘스트 시작점으로 사용할 더미 자전거 거점입니다.' },
    { id: 'bomunsan-observatory', badgeId: 'view', name: '보문산 전망대', category: '추천 관광지', latitude: 36.3016, longitude: 127.4218, x: 74, y: 78, recommended: true, summary: '전망과 야경 기록을 위한 추천 관광지 후보입니다.' },
  ];

  // 변수 의미: 장소와 배지에 연결된 목업 퀘스트 목록이다.
  const quests = [
    { id: 'hanbat-forest', placeId: 'hanbat-arboretum', badgeId: 'green', title: '한밭수목원 체크인', type: '방문형', distance: '1.2km', xp: 50, status: '추천', verification: '반경 50m GPS 인증', description: '수목원 안에서 오늘의 식물 단서를 기록하고 자연 관찰 스탬프를 받습니다.' },
    { id: 'science-museum', placeId: 'science-museum', badgeId: 'science', title: '중앙과학관 탐방', type: '테마형', distance: '2.6km', xp: 80, status: '진행 가능', verification: '전시 관람 기록', description: '전시관을 둘러본 뒤 과학 키워드 단서를 탐험 노트에 남깁니다.' },
    { id: 'daejeon-walk', placeId: 'eunhaeng-dong', badgeId: 'walker', title: '원도심 걷기', type: '이동형', distance: '0.8km', xp: 40, status: '근처', verification: '도보 이동 거리 인증', description: '중앙로 주변의 원도심 장소를 걸어서 연결하고 이동 기록을 채웁니다.' },
    { id: 'bakery-tour', placeId: 'sungsimdang', badgeId: 'bakery', title: '대전 빵지순례', type: '소비형', distance: '1.5km', xp: 60, status: '쿠폰 후보', verification: '영수증 또는 사진 인증', description: '지역 빵집 방문을 인증하고 지역 상권 리워드 후보를 확인합니다.' },
    { id: 'tashu-route', placeId: 'tashu-station', badgeId: 'rider', title: '타슈 라이딩 루트', type: '이동형', distance: '2.1km', xp: 70, status: '대기', verification: '이동 경로 인증', description: '타슈 거점에서 출발해 가까운 관광지를 연결하는 이동형 퀘스트입니다.' },
    { id: 'night-view', placeId: 'bomunsan-observatory', badgeId: 'view', title: '야경 전망대', type: '활동형', distance: '4.4km', xp: 70, status: '잠금 해제 전', verification: '저녁 시간대 방문', description: '보문산 전망대에서 야경 기록을 남기는 추천 관광지 퀘스트입니다.' },
  ];

  // 변수 의미: 탐험 노트에 표시할 목업 기록 목록이다.
  const adventureNotes = [
    { id: 'note-hanbat', icon: '🌳', title: '한밭수목원 체크인', time: '오늘 09:41', badge: '완료', summary: '자연 관찰 노트에 초록 탐험가 스탬프가 붙었습니다.' },
    { id: 'note-walk', icon: '🗼', title: '시계탑의 비밀', time: '어제 14:20', badge: '완료', summary: '원도심 걷기 기록과 이동 거리가 추가되었습니다.' },
    { id: 'note-science', icon: '🧪', title: '중앙과학관 탐방', time: '어제 11:05', badge: '완료', summary: '과학 탐험가 배지를 획득했습니다.' },
    { id: 'note-bakery', icon: '🥐', title: '대전 빵지순례 준비', time: '다음 추천', badge: '대기', summary: '지역 상권 연계 리워드 후보로 저장되었습니다.' },
  ];

  // 변수 의미: 모든 정적 페이지에서 사용할 수 있도록 목업 데이터셋을 공개한다.
  window.QuestbookMockData = {
    currentUser,
    currentLocation,
    badges,
    questPlaces,
    quests,
    adventureNotes,
  };
}(window));
