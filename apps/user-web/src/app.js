// 사용자 모바일 웹/PWA의 화면 상태, API 호출, 목업 fallback 렌더링을 담당하는 파일입니다.

// GPS 인증 성공 연출(지침서 T2-B)의 DOM 조립 함수입니다.
import { createRewardFx, playRewardFlash } from "./reward-fx.js";

// API 요청이 실패했을 때 화면을 채우는 기본 사용자 정보입니다.
const FALLBACK_USER = {
  nickname: "대전 탐험가",
  // demo | social. demo는 서버가 제공하는 공용 체험 계정입니다.
  accountType: "demo",
  // 소셜 사용자만 값이 있습니다. 마이페이지에서만 표시합니다. (명세 §9.4)
  email: "",
  provider: "",
  level: 3,
  xp: 1240,
  nextLevelXp: 1800,
  completedQuestCount: 8,
  badgeCount: 5,
  selectedGgumdoriName: "기본 꿈돌이",
};

// API 요청이 실패했을 때 사용할 기본 위치입니다.
const FALLBACK_LOCATION = {
  lat: 36.3504,
  lng: 127.3845,
  label: "대전광역시청 기준",
  // 실측 GPS 좌표인지 여부입니다. 계획 좌표로는 완료 인증을 할 수 없습니다. (명세 §19)
  measured: false,
};

// 화면 전체 표시 언어로 지원하는 값입니다. 국문+영문만 지원합니다.
const SUPPORTED_UI_LANGUAGES = ["kor", "eng"];
// 화면 언어 선택을 저장하는 localStorage 키입니다.
const UI_LANGUAGE_KEY = "questbook:user-web:ui-language";

// 화면에서 선택할 수 있는 관광 카테고리 이름입니다. (명세 §4.1 카테고리 8종)
const CATEGORY_LABELS = {
  all: "전체",
  default: "기본",
  science: "과학·우주",
  bread: "빵·미식",
  nature: "자연·산책",
  heritage: "원도심·역사",
  culture: "문화·예술",
  market: "시장·상권",
  tashu: "이동·타슈",
  festival: "축제·이벤트",
};

// 인증 5종의 표시 이름입니다. (명세 §4.3)
const QUEST_TYPE_LABELS = {
  visit: "방문형",
  move: "이동형",
  activity: "활동형",
  spend: "소비형",
  theme: "테마형",
};

// 난이도 3종의 표시 이름입니다. 보상 단계가 아닙니다. (명세 §4.2)
const DIFFICULTY_LABELS = {
  discover: "발견",
  explore: "탐험",
  conquer: "정복",
};

// S05 정렬 기준의 표시 이름입니다. (명세 §10 S05)
const QUEST_SORT_LABELS = {
  distance: "가까운 순",
  duration: "짧은 순",
  reward: "보상 높은 순",
};

// v1 콘텐츠의 카테고리 값을 v2 8종으로 옮기는 표입니다. (명세 §4.1)
const LEGACY_CATEGORY_MAP = {
  downtown: "heritage",
  mobility: "tashu",
  hotspring: "nature",
  nightview: "culture",
};

// 화면 카테고리를 현재 서버의 6개 카테고리 코드로 되돌리는 표입니다.
const SERVER_CATEGORY_MAP = {
  all: "all",
  science: "science",
  nature: "nature",
  heritage: "downtown",
  culture: "nightview",
  market: "market",
  tashu: "mobility",
};

// 현재 서버가 관심사로 저장하는 6개 카테고리입니다.
const INTEREST_CATEGORIES = ["nature", "science", "downtown", "market", "mobility", "nightview"];

// 계획 위치를 빠르게 정할 수 있는 대전 주요 지점입니다.
const PLAN_LOCATION_PRESETS = [
  { label: "대전역", lat: 36.3321, lng: 127.4344 },
  { label: "유성온천역", lat: 36.3538, lng: 127.3412 },
  { label: "국립중앙과학관", lat: 36.3752, lng: 127.3764 },
  { label: "한밭수목원", lat: 36.3664, lng: 127.3881 },
];


// 최상위 다섯 화면의 메타데이터입니다. (명세 §7.1)
// icon 값은 Material Symbols 리거처 이름이며 이모지를 쓰지 않습니다. (명세 §3.2)
const VIEW_META = {
  home: {
    title: "홈",
    eyebrow: "QUESTBOOK",
    icon: "home",
    label: "홈",
    description: "현위치·계획 지도와 주변 퀘스트",
    accent: "var(--cat-festival)",
  },
  adventure: {
    title: "모험 중",
    eyebrow: "ADVENTURE",
    icon: "swords",
    label: "모험 중",
    description: "진행 중인 퀘스트",
    accent: "var(--cat-bread)",
  },
  quests: {
    title: "퀘스트",
    eyebrow: "QUEST",
    icon: "explore",
    label: "퀘스트",
    description: "탐색 컨텍스트 기준 추천",
    accent: "var(--cat-science)",
  },
  collection: {
    title: "도감",
    eyebrow: "COLLECTION",
    icon: "auto_awesome_motion",
    label: "도감",
    description: "꿈돌이와 연결 뱃지",
    accent: "var(--cat-culture)",
  },
  me: {
    title: "마이페이지",
    eyebrow: "MY PAGE",
    icon: "person",
    label: "마이페이지",
    description: "계정·기록·설정·권한",
    accent: "var(--cat-tashu)",
  },
};

// 드로어 메뉴의 표시 순서입니다. (명세 §7.1)
const NAVIGATION_ITEMS = ["home", "adventure", "quests", "collection", "me"];

// v1 해시를 v2 라우트로 넘겨 주는 표입니다. 설치된 PWA의 북마크를 깨뜨리지 않습니다.
const LEGACY_VIEW_MAP = {
  map: "home",
  badges: "collection",
  customize: "collection",
  notes: "me",
};

// NAVER Maps JavaScript SDK URL입니다.
const NAVER_MAPS_SDK_URL = "https://oapi.map.naver.com/openapi/v3/maps.js";

// Dynamic Map 기본 줌 레벨입니다.
const NAVER_MAP_DEFAULT_ZOOM = 14;

// 장소 선택 시 사용할 줌 레벨입니다.
const NAVER_MAP_FOCUSED_ZOOM = 16;

// API 실패 시 추천 화면을 채우는 기본 퀘스트 목록입니다.
const FALLBACK_RECOMMENDATIONS = [
  {
    instanceId: "mock-science-001",
    questId: "quest-science-001",
    placeName: "국립중앙과학관",
    roadAddress: "대전광역시 유성구 대덕대로 481",
    category: "science",
    difficulty: "explore",
    questType: "visit",
    distanceMeters: 1800,
    estimatedMinutes: 45,
    questTitle: "과학 키워드 3개 수집",
    questDescription: "전시관을 둘러본 뒤 기억에 남는 과학 키워드 3개를 수첩에 남깁니다.",
    rewardXp: 160,
    badgeName: "과학 탐험가",
    rewardPair: {
      badgeName: "과학 탐험가",
      badgeImageRef: "/assets/badge/badge_science_lv1_64.png",
      ggumdoriId: "science-1",
      ggumdoriName: "연구원 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/science-1.png",
    },
    verificationType: "GPS 방문",
    score: 94,
    status: "recommended",
  },
  {
    instanceId: "mock-market-001",
    questId: "quest-bread-001",
    placeName: "성심당 본점 거리",
    roadAddress: "대전광역시 중구 대종로480번길 15",
    category: "bread",
    difficulty: "discover",
    questType: "spend",
    distanceMeters: 3200,
    estimatedMinutes: 30,
    questTitle: "원도심 빵지순례",
    questDescription: "중앙로 주변 상권을 걸으며 대표 메뉴나 간판을 사진으로 기록합니다.",
    rewardXp: 140,
    badgeName: "빵지순례자",
    rewardPair: {
      badgeName: "빵지순례자",
      badgeImageRef: "/assets/badge/badge_bread_lv1_64.png",
      ggumdoriId: "market-2",
      ggumdoriName: "빵집 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/market-2.png",
    },
    verificationType: "영수증 OCR",
    score: 88,
    status: "recommended",
  },
  {
    instanceId: "mock-nature-001",
    questId: "quest-nature-001",
    placeName: "한밭수목원",
    roadAddress: "대전광역시 서구 둔산대로 169",
    category: "nature",
    difficulty: "discover",
    questType: "visit",
    distanceMeters: 900,
    estimatedMinutes: 25,
    questTitle: "초록 탐험 루트",
    questDescription: "수목원 산책로에서 오늘 본 식물이나 풍경을 한 줄 메모로 남깁니다.",
    rewardXp: 120,
    badgeName: "초록 탐험가",
    rewardPair: {
      badgeName: "초록 탐험가",
      badgeImageRef: "/assets/badge/badge_nature_lv1_64.png",
      ggumdoriId: "nature-2",
      ggumdoriName: "산책 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/nature-2.png",
    },
    verificationType: "GPS 방문",
    score: 91,
    status: "accepted",
    startedAt: "2026-09-10T09:20:00+09:00",
  },
  {
    instanceId: "mock-night-001",
    questId: "quest-culture-001",
    placeName: "엑스포다리",
    roadAddress: "대전광역시 유성구 대덕대로 480",
    category: "culture",
    difficulty: "explore",
    questType: "activity",
    distanceMeters: 2400,
    estimatedMinutes: 40,
    questTitle: "대전 야경 수집",
    questDescription: "해가 진 뒤 엑스포다리 주변 야경을 감상하고 방문 기록을 남깁니다.",
    rewardXp: 150,
    badgeName: "전망 수집가",
    rewardPair: {
      badgeName: "전망 수집가",
      badgeImageRef: "/assets/badge/badge_culture_lv1_64.png",
      ggumdoriId: "culture-2",
      ggumdoriName: "야경 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/culture-2.png",
    },
    verificationType: "사진 인증",
    score: 83,
    status: "recommended",
  },
  {
    instanceId: "mock-festival-001",
    questId: "quest-festival-common",
    placeName: "대전 축제 현장",
    roadAddress: "대전광역시 유성구 온천북로 33",
    category: "festival",
    difficulty: "conquer",
    questType: "visit",
    distanceMeters: 2100,
    estimatedMinutes: 90,
    questTitle: "대전 축제에 참여하기",
    questDescription: "참여 가능한 행사 중 하나를 골라 현장에서 방문을 인증합니다.",
    rewardXp: 220,
    badgeName: "축제 참여자",
    rewardPair: {
      badgeName: "축제 참여자",
      badgeImageRef: "/assets/badge/badge_festival_lv1_64.png",
      ggumdoriId: "festival-1",
      ggumdoriName: "축제 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/nature-1.png",
    },
    verificationType: "GPS 방문",
    score: 96,
    status: "recommended",
    // 공통 축제 퀘스트는 목록에서 카드 하나로만 보여 줍니다. (명세 §11.1)
    isCommonFestival: true,
    festivalTargetCount: 3,
    availableFrom: "2026-09-01",
    availableUntil: "2026-10-31",
    // 신뢰 가능한 운영시간입니다. 이 범위 안일 때만 지금 참여 가능이 뜹니다. (명세 §6.5)
    startTime: "10:00",
    endTime: "21:00",
    // 실제 수행할 수 있는 행사 회차입니다. 사용자가 하나를 고릅니다. (명세 §11.1, §16.2)
    festivalTargets: [
      {
        eventId: "event-beer",
        editionId: "2026-01",
        title: "유성 맥주축제 2026",
        venueName: "유성온천공원",
        roadAddress: "대전광역시 유성구 온천북로 33",
        latitude: 36.3546,
        longitude: 127.3421,
        startDate: "2026-09-04",
        endDate: "2026-09-13",
        startTime: "16:00",
        endTime: "22:00",
        availabilityLabel: "오늘 개최 중",
        sourceContentId: "tour-1001",
      },
      {
        eventId: "event-bread",
        editionId: "2026-01",
        title: "대전 빵축제 2026",
        venueName: "옛 충남도청사",
        roadAddress: "대전광역시 중구 중앙로 101",
        latitude: 36.3283,
        longitude: 127.4275,
        startDate: "2026-10-17",
        endDate: "2026-10-19",
        startTime: "10:00",
        endTime: "18:00",
        availabilityLabel: "예정",
        sourceContentId: "tour-1002",
      },
      {
        eventId: "event-science",
        editionId: "2026-01",
        title: "대전 사이언스 페스티벌",
        venueName: "엑스포과학공원",
        roadAddress: "대전광역시 유성구 대덕대로 480",
        latitude: 36.3745,
        longitude: 127.3865,
        startDate: "2026-09-08",
        endDate: "2026-09-20",
        startTime: "10:00",
        endTime: "20:00",
        availabilityLabel: "오늘 개최 중",
        sourceContentId: "tour-1003",
      },
    ],
  },
  {
    instanceId: "mock-festival-002",
    questId: "quest-festival-hotspring",
    placeName: "유성온천 축제 거리",
    roadAddress: "대전광역시 유성구 봉명동 546",
    category: "festival",
    difficulty: "explore",
    questType: "visit",
    distanceMeters: 2600,
    estimatedMinutes: 60,
    questTitle: "유성온천 축제 즐기기",
    questDescription: "축제 기간 중 현장을 방문하고 방문 기록을 남깁니다.",
    rewardXp: 180,
    badgeName: "온천 축제 참가자",
    rewardPair: {
      badgeName: "온천 축제 참가자",
      badgeImageRef: "/assets/badge/badge_festival_lv2_64.png",
      ggumdoriId: "festival-2",
      ggumdoriName: "온천 꿈돌이",
      ggumdoriStillImageRef: "/assets/ggumdori/festival-2.png",
    },
    verificationType: "GPS 방문",
    score: 72,
    status: "recommended",
    // 이미 끝난 회차입니다. 목록에서 행사 종료로 구분됩니다. (명세 §10 S05)
    availableFrom: "2026-05-16",
    availableUntil: "2026-05-24",
  },
];

const FALLBACK_BADGES = [
  { name: "초록 탐험가", category: "nature", tier: 2, progressXp: 420, requiredXp: 500, earnedAt: "2026-06-24" },
  { name: "과학 탐험가", category: "science", tier: 1, progressXp: 260, requiredXp: 300, earnedAt: "2026-06-23" },
  { name: "대전 워커", category: "downtown", tier: 1, progressXp: 180, requiredXp: 300, earnedAt: null },
  { name: "빵지순례자", category: "market", tier: 2, progressXp: 540, requiredXp: 600, earnedAt: "2026-06-22" },
  { name: "타슈 라이더", category: "mobility", tier: 1, progressXp: 90, requiredXp: 250, earnedAt: null },
  { name: "전망 수집가", category: "nightview", tier: 1, progressXp: 210, requiredXp: 300, earnedAt: "2026-06-21" },
];

// API 실패 시 수첩 화면을 채우는 기본 기록 목록입니다.
const FALLBACK_NOTES = [
  {
    id: "mock-note-001",
    title: "한밭수목원 산책 완료",
    placeName: "한밭수목원",
    createdAt: "2026-06-24T10:40:00+09:00",
    earnedXp: 120,
    badges: ["초록 탐험가"],
    memo: "습지원 근처에서 오늘의 산책 기록을 남겼습니다.",
  },
  {
    id: "mock-note-002",
    title: "중앙로 상권 방문",
    placeName: "중앙로",
    createdAt: "2026-06-23T16:20:00+09:00",
    earnedXp: 140,
    badges: ["빵지순례자", "대전 워커"],
    memo: "원도심 골목과 지역 상점을 함께 둘러봤습니다.",
  },
  {
    id: "mock-note-003",
    title: "엑스포다리 야경 감상",
    placeName: "엑스포다리",
    createdAt: "2026-06-21T20:10:00+09:00",
    earnedXp: 150,
    badges: ["전망 수집가"],
    memo: "야간 시간대 퀘스트 완료 기록입니다.",
  },
];

// API 실패 시 꿈돌이 도감 화면을 채우는 기본 항목입니다.
const FALLBACK_GGUMDORI = [
  { id: "nature-1", name: "기본 꿈돌이", themeCategory: "nature", unlocked: true, condition: "기본 지급", imageRef: "/assets/ggumdori/nature-1.png" },
  { id: "science-1", name: "안경 꿈돌이", themeCategory: "science", unlocked: true, condition: "science Lv.1", imageRef: "/assets/ggumdori/science-1.png" },
  { id: "science-2", name: "플라스크 꿈돌이", themeCategory: "science", unlocked: false, condition: "science Lv.2", imageRef: "/assets/ggumdori/science-2.png" },
  { id: "market-2", name: "제빵 꿈돌이", themeCategory: "market", unlocked: true, condition: "market Lv.2", imageRef: "/assets/ggumdori/market-2.png" },
  { id: "nature-2", name: "숲 탐험 꿈돌이", themeCategory: "nature", unlocked: true, condition: "nature Lv.2", imageRef: "/assets/ggumdori/nature-2.png" },
  { id: "tashu-1", name: "타슈 꿈돌이", themeCategory: "tashu", unlocked: false, condition: "타슈 대여소 방문", imageRef: "/assets/ggumdori/tashu-1.png" },
  { id: "festival-2", name: "온천 꿈돌이", themeCategory: "festival", unlocked: false, condition: "유성온천 방문", imageRef: "/assets/ggumdori/festival-2.png" },
  { id: "culture-2", name: "야경 꿈돌이", themeCategory: "culture", unlocked: false, condition: "엑스포다리 야경 감상", imageRef: "/assets/ggumdori/culture-2.png" },
];

// 브라우저에 저장할 퀘스트 상태 키입니다.
const QUEST_STATUS_KEY = "questbook:user-web:quest-status";

// 브라우저에 저장할 선택 꿈돌이 키입니다.
const SELECTED_GGUMDORI_KEY = "questbook:user-web:selected-ggumdori";

// 마이페이지의 앱 설정 전체를 저장하는 키입니다. (명세 §10 S12)
const APP_SETTINGS_KEY = "questbook:user-web:app-settings";

// 마이페이지의 모션 줄이기 설정을 저장하는 키입니다.
const REDUCED_MOTION_KEY = "questbook:user-web:reduced-motion";

// 브라우저에 저장할 baseline access token 키입니다.
const ACCESS_TOKEN_KEY = "questbook:user-web:access-token";

// 브라우저 세션에 저장할 OAuth callback nonce 키입니다.
const OAUTH_NONCE_KEY = "questbook:user-web:oauth-nonce";

// 새 서비스워커로 넘어가며 이미 새로고침을 걸었는지 표시합니다. (명세 §14.1)
let swReloading = false;

// 촬영 중인 카메라 스트림입니다. 시트를 닫을 때 반드시 정리합니다. (명세 §10 S11)
let photoStream = null;

// 공통 축제에서 고른 행사 타깃을 기억하는 키입니다. (명세 §11.1)
const FESTIVAL_SELECTION_KEY = "questbook:user-web:festival-selection";

// 실제 방문한 행사 회차 기록 키입니다. 중복 기록을 막는 데 씁니다. (명세 §11.1)
const FESTIVAL_VISIT_KEY = "questbook:user-web:festival-visits";

// 마지막 계획 위치와 날짜를 복원하는 키입니다. (명세 §6.3)
const PLAN_CONTEXT_KEY = "questbook:user-web:plan-context";

// 소셜 연결 중 보관하는 게스트 토큰 키입니다. 연결이 성공해야만 버립니다. (명세 §9.3)
const GUEST_TOKEN_KEY = "questbook:user-web:guest-token";

// 이번 OAuth 왕복이 신규 로그인인지 게스트 승계인지 기억하는 세션 키입니다. (명세 §9.3)
const OAUTH_INTENT_KEY = "questbook:user-web:oauth-intent";

// 닉네임 자동 추천에 쓰는 조각입니다. 중복을 허용하므로 확인 API를 부르지 않습니다. (명세 §9.4)
const NICKNAME_PREFIXES = ["씩씩한", "느긋한", "호기심 많은", "부지런한", "용감한", "다정한", "엉뚱한", "꼼꼼한"];
const NICKNAME_NOUNS = ["꿈돌이", "탐험가", "기록가", "산책러", "미식가", "수집가", "여행자", "모험가"];
// NICKNAME_PREFIXES/NICKNAME_NOUNS와 같은 순서로 대응하는 영문 닉네임 조각입니다.
// 조합이 랜덤이라 applyUiLanguage()의 문자열 정확 일치로는 못 잡아, suggestNickname()이
// 뽑을 때 인덱스를 맞춰 직접 영문/국문 중 하나를 고른다.
const NICKNAME_PREFIXES_EN = ["Brave", "Easygoing", "Curious", "Diligent", "Bold", "Kind", "Quirky", "Meticulous"];
const NICKNAME_NOUNS_EN = ["Dreamdol", "Explorer", "Recorder", "Stroller", "Foodie", "Collector", "Traveler", "Adventurer"];

// 사진 증빙 기본 업로드 제한 바이트 값입니다.
const DEFAULT_EVIDENCE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 백엔드 없이 배포한 디자인 초안을 바로 확인할 때 사용하는 명시적 미리보기 모드입니다.
const IS_DESIGN_PREVIEW = new URLSearchParams(window.location.search).has("prototype");

// 정적 Sites 배포에서는 별도 앱 API 없이 로컬 체험 세션을 사용한다.
const IS_HOSTED_STATIC_PREVIEW = window.location.hostname.endsWith(".chatgpt.site");
// 수첩 기록 제목의 최대 글자 수입니다.
const NOTE_ENTRY_TITLE_MAX_LENGTH = 100;

// 수첩 기록 본문의 최대 글자 수입니다.
const NOTE_ENTRY_BODY_MAX_LENGTH = 2000;

// 화면 전체의 현재 상태입니다.
const state = {
  apiHealthy: false,
  activeView: readInitialView(),
  // 뒤로가기 버튼이 돌아갈 이전 화면 스택입니다. 최근 방문이 배열 끝입니다.
  viewHistory: [],
  // 시작 화면 로딩이 끝나 TAP TO START로 바뀌었는지 여부입니다.
  startScreenReady: false,
  dataSource: "fallback",
  recommendationMeta: {
    sourceStatus: "fallback:not_loaded",
    cacheHit: false,
    attribution: "관광정보 제공: 한국관광공사(TourAPI)",
    fetchedAt: "",
    expiresAt: "",
  },
  selectedCategory: "all",
  currentCategory: "all",
  plannedCategory: "all",
  location: { ...FALLBACK_LOCATION },
  user: { ...FALLBACK_USER },
  plannedLocation: { ...FALLBACK_LOCATION, label: "계획 위치를 설정해주세요" },
  recommendations: [...FALLBACK_RECOMMENDATIONS],
  preference: { categories: [], categoriesSetAt: "", isConfigured: false },
  interestDraft: [],
  interestMessage: "",
  attractions: [],
  // 관심 관광지를 한 번에 보여줄 개수입니다.
  attractionLimit: 5,
  attractionMessage: "",
  authProviders: { naver: false, google: false },
  sessionVersion: 0,
  // 닉네임 중복 저장을 막는 현재 세션의 처리 상태입니다.
  nicknamePending: false,
  requestVersions: {
    recommendation: 0, user: 0, preference: 0, attraction: 0, planSearch: 0, badges: 0, notes: 0, ggumdori: 0,
  },

  badges: [...FALLBACK_BADGES],
  notes: [...FALLBACK_NOTES],
  notesSource: "fallback",
  notePhotos: {},
  noteDrafts: {},
  ggumdori: [...FALLBACK_GGUMDORI],
  questStatuses: readStoredQuestStatuses(),
  pendingQuestActions: {},
  evidenceUploads: {},
  actionDialog: null,
  selectedGgumdoriId: readSelectedGgumdoriId(),
  // 드로어를 열기 직전에 포커스가 있던 요소입니다. 닫을 때 되돌립니다.
  drawerReturnFocus: null,
  // history.back() 을 이미 요청했는지 표시합니다. 중복 되감기를 막습니다.
  drawerClosing: false,
  // 마이페이지의 모션 줄이기 설정입니다. (명세 §12)
  reducedMotion: readAppSettings().reducedMotion,
  // 홈 3단 시트의 현재 스냅입니다. (명세 §10 S03)
  homeSheetSnap: "mid",
  // 모험 중 화면의 정렬 기준입니다. (명세 §10 S04)
  adventureSort: "distance",
  // 사용자가 정렬을 직접 고른 적이 있는지 여부입니다. 고르기 전에는 위치 권한에 따라 기본값이 정해집니다. (명세 §10 S04)
  adventureSortPinned: false,
  // 공용 퀘스트 상세 시트가 보여 주는 퀘스트입니다. "" 이면 닫힘입니다. (명세 §10 S06)
  questSheetId: "",
  // 시트 안에서 알릴 안내 문구입니다.
  questSheetMessage: "",
  // Clipboard API 실패 시 사용자가 직접 선택해 복사할 텍스트입니다.
  questSheetFallbackText: "",
  // 시트를 열기 직전에 포커스가 있던 요소입니다.
  questSheetReturnFocus: null,
  // 관광지 상세 모달 상태입니다. null이면 닫힘입니다.
  placeDetailSheet: null,
  // 상세 조회 경합을 막는 요청 토큰입니다.
  placeDetailRequestToken: 0,
  // 오디오 가이드(Web Speech API) 재생 여부입니다.
  audioGuidePlaying: false,
  // 관광지 상세 모달을 열기 직전에 포커스가 있던 요소입니다.
  placeDetailReturnFocus: null,
  // 화면 전체 표시 언어입니다. 국문/영문만 지원합니다. 드로어 상단 드롭다운에서 바꿉니다.
  uiLanguage: readStoredUiLanguage(),
  // S12 앱 설정입니다. 소리·진동·알림·모션. (명세 §10 S12)
  appSettings: readAppSettings(),
  // 설정 영역에 알릴 문구입니다.
  settingsMessage: "",
  // 위치·카메라·알림 권한 상태입니다. 표시만 하고 여기서 요청하지 않습니다. (명세 §10 S12)
  permissionStates: { location: "unknown", camera: "unknown", notification: "unknown" },
  // S13 모험 기록 화면 상태입니다. 마이페이지에서만 엽니다. (명세 §10 S13)
  recordSheetOpen: false,
  recordDetailId: "",
  recordMessage: "",
  recordReturnFocus: null,
  // S11 꿈돌이 2D 촬영 상태입니다. (명세 §10 S11)
  photo: {
    open: false,
    ggumdoriId: "",
    source: "idle",
    scale: 40,
    offsetX: 50,
    resultDataUrl: "",
    message: "",
    pickedImageUrl: "",
    returnFocus: null,
  },
  // 공통 축제에서 고른 행사 타깃입니다. instanceId -> targetKey. (명세 §11.1)
  selectedFestivalTargets: readFestivalSelections(),
  // 실제 방문한 행사 회차 기록입니다. (명세 §11.1, §11.2)
  festivalVisits: readFestivalVisits(),
  // 날씨 상태입니다. 값이 없으면 임의로 채우지 않습니다. (명세 §6.4)
  weather: {
    status: "idle",
    temperatureC: null,
    precipitationProbability: null,
    condition: "",
    hourly: [],
    outdoorNote: "",
    unavailable: false,
    cacheKey: "",
  },
  // S14 날씨 상세 시트가 열려 있는지 여부입니다. (명세 §10 S14)
  weatherSheetOpen: false,
  // S15 계획 위치·날짜 시트가 열려 있는지 여부입니다. (명세 §10 S15)
  planSheetOpen: false,
  // 계획 위치 검색어와 결과입니다. (명세 §6.3)
  planSearchQuery: "",
  planSearchResults: [],
  planMessage: "",
  // S02 계정 설정 단계입니다. consent | nickname. (명세 §10 S02)
  accountStep: "consent",
  // 닉네임 입력 칸의 현재 값입니다. (명세 §9.4)
  nicknameDraft: "",
  // 지금 nicknameDraft가 suggestNickname()이 뽑아 둔 제안값 그대로인지 추적하는 인덱스입니다.
  // 사용자가 직접 입력칸을 고치면 null로 지워, 언어 토글이 사용자가 입력한 커스텀 닉네임을
  // 건드리지 않게 합니다. 제안값 그대로일 때만 언어 토글 시 같은 조합을 다른 언어로 다시 조립합니다.
  nicknameSuggestionIndices: null,
  // 소셜 연결(승계) 진행 상태입니다. idle | pending | failed. (명세 §9.3)
  accountLinkState: "idle",
  // 마이페이지 계정 영역에 알릴 문구입니다.
  accountMessage: "",
  // S09 도감 페이지입니다. 전체 수는 서버값을 그대로 씁니다. (명세 §5.2, §16.3)
  catalog: { earnedCount: 0, totalCount: 0, entries: [], nextCursor: "" },
  // S09 도감 검색어입니다. 꿈돌이와 퀘스트를 함께 찾습니다. (명세 §10 S09)
  catalogSearch: "",
  // S09 획득 상태 필터입니다. all | earned | locked. (명세 §10 S09)
  catalogStatusFilter: "all",
  // S09 카테고리 필터입니다. (명세 §10 S09)
  catalogCategory: "all",
  // S10 도감 상세 시트가 보여 주는 꿈돌이입니다. "" 이면 닫힘입니다. (명세 §10 S10)
  catalogSheetId: "",
  // 도감 상세에서 알릴 안내 문구입니다.
  catalogMessage: "",
  // 도감 시트를 열기 직전에 포커스가 있던 요소입니다.
  catalogSheetReturnFocus: null,
  // S05 퀘스트 목록의 보기 방식입니다. 목록형과 카드형이 같은 데이터를 씁니다. (명세 §10 S05)
  questsViewMode: "card",
  // S05 난이도 필터입니다. "all" 이면 전체입니다. (명세 §4.2, §10 S05)
  questsDifficulty: "all",
  // S05 정렬 기준입니다. (명세 §10 S05)
  questsSort: "distance",
  // 네트워크 연결 상태입니다. 오프라인이면 목록 위에 알립니다. (명세 §10 S05, §13.2)
  isOnline: typeof navigator === "undefined" || navigator.onLine !== false,
  // 탐색 컨텍스트입니다. 현위치와 계획 모드를 명시적으로 구분합니다. (명세 §6.1)
  explorationMode: "current",
  plannedDate: "",
  selectedMapInstanceId: FALLBACK_RECOMMENDATIONS[0]?.instanceId || "",
  accessToken: readStorageValue(ACCESS_TOKEN_KEY) || (IS_DESIGN_PREVIEW ? "design-preview" : ""),
  naverMapConfigured: false,
  naverMapConfig: {
    keyId: "",
    dynamicMapConfigured: false,
    restApiConfigured: false,
  },
  naverMapLoadState: "idle",
  naverMapSdkPromise: null,
  naverMapInstance: null,
  naverMapMarkers: [],
  naverPositionMarker: null,
  // 지도를 마지막으로 센터링한 기준 좌표입니다. 모달 열고 닫기 등 위치 변경과 무관한
  // 재렌더링에서는 이 값이 그대로라 사용자가 손으로 옮겨 둔 지도 위치를 건드리지 않습니다.
  naverMapCenteredLocation: null,
};

/**
 * 입력: CSS 선택자 문자열.
 * 출력: 일치하는 HTMLElement 또는 null.
 * 역할: DOM 요소 조회를 한 곳에서 처리한다.
 * 호출 예시: select("#profile-panel")
 */
function select(selector) {
  return document.querySelector(selector);
}

/**
 * 입력: HTML 태그명, 클래스명, 텍스트.
 * 출력: 생성된 HTMLElement.
 * 역할: API 문자열을 textContent로 넣어 안전하게 DOM을 만든다.
 * 호출 예시: createElement("p", "empty-message", "표시할 내용이 없습니다.")
 */
function createElement(tagName, className = "", text = "") {
  // 화면에 추가할 새 DOM 요소입니다.
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (text) {
    element.textContent = text;
  }

  return element;
}

/**
 * 입력: HTML 문자열처럼 쓰일 수 있는 값.
 * 출력: 이스케이프된 안전한 문자열.
 * 역할: NAVER Maps HTML 마커에 API 문자열을 넣기 전에 안전하게 변환한다.
 * 호출 예시: const safeName = escapeHtml(place.placeName)
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 입력: ID 접두사 문자열.
 * 출력: 클라이언트에서만 쓰는 임시 ID.
 * 역할: 비보안 컨텍스트에서도 화면 렌더링용 식별자를 안전하게 만든다.
 * 호출 예시: createClientId("note")
 */
function createClientId(prefix = "generated") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  // 임시 ID에 사용할 시간 기반 값입니다.
  const timestamp = Date.now().toString(36);

  // 임시 ID 충돌 가능성을 낮추기 위한 난수 값입니다.
  const randomPart = Math.random().toString(36).slice(2, 10);

  return `${prefix}-${timestamp}-${randomPart}`;
}

/**
 * 입력: localStorage 키.
 * 출력: 저장된 문자열 또는 null.
 * 역할: 저장소 접근이 막힌 브라우저에서도 앱 초기화를 유지한다.
 * 호출 예시: readStorageValue(QUEST_STATUS_KEY)
 */
function readStorageValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

/**
 * 입력: 없음.
 * 출력: 저장된 화면 언어. 없거나 지원하지 않으면 "kor".
 * 역할: 새로고침 후에도 사용자가 고른 화면 언어를 유지한다.
 * 호출 예시: const language = readStoredUiLanguage()
 */
function readStoredUiLanguage() {
  const storedLanguage = readStorageValue(UI_LANGUAGE_KEY);
  return SUPPORTED_UI_LANGUAGES.includes(storedLanguage) ? storedLanguage : "kor";
}

/**
 * 입력: 국문 문구, 영문 문구.
 * 출력: 현재 화면 언어에 맞는 문구.
 * 역할: 정확도 "87m"처럼 동적 숫자가 끼워져 있어 UI_STRINGS_EN의 텍스트 노드 정확 일치
 *       방식(applyUiLanguage)으로는 못 잡는 조합 문구를, 만들어지는 순간 언어에 맞게 고른다.
 *       이 앱은 매 렌더마다 새로 만들기 때문에 언어를 토글하면 다음 렌더에서 바로 반영된다.
 * 호출 예시: localize(`정확도 ${n}m`, `Accuracy ${n}m`)
 */
function localize(korean, english) {
  return state.uiLanguage === "eng" ? english : korean;
}

// 화면 전체 영문화용 고정 UI 텍스트 사전입니다. 값의 가짓수가 정해진 텍스트(버튼, 헤딩,
// 카테고리명 등)만 여기서 다루고, 장소명·퀘스트 제목/설명처럼 장소명이 문장에 끼워져
// 조합이 무한한 텍스트는 백엔드 Papago 번역(lang=eng 파라미터)이 담당합니다.
// 값이 없는 문자열은 안전하게 국문 그대로 남습니다.
const UI_STRINGS_EN = {
  // 공용
  "확인 중": "Checking",
  "닫기": "Close",
  "더 보기": "Show more",
  "접기": "Show less",
  "전체": "All",
  "새로고침": "Refresh",
  "저장": "Save",
  "취소": "Cancel",
  "확인": "Confirm",
  "관광정보 제공: 한국관광공사(TourAPI)": "Tourism data provided by Korea Tourism Organization (TourAPI)",

  // 앱 헤더 / 상단바
  "모험가 홈": "Adventurer Home",
  "본문으로 이동": "Skip to content",

  // 로그인/동의 화면
  "시작 전 확인": "Before you start",
  "모험가 등록": "Adventurer sign-up",
  "추천과 퀘스트 인증을 위해 닉네임, 활동 기록, 현재 위치를 필요한 순간에만 사용합니다.":
    "We only use your nickname, activity history, and current location when needed, for recommendations and quest verification.",
  "만 14세 이상입니다. (필수)": "I am 14 years or older. (Required)",
  "서비스 이용약관에 동의합니다. (필수)": "I agree to the Terms of Service. (Required)",
  "개인정보 수집·이용에 동의합니다. (필수)": "I agree to the collection and use of personal information. (Required)",
  "위치기반서비스 이용약관에 동의합니다. (필수)": "I agree to the Location-Based Service Terms. (Required)",
  "공용 체험 계정으로 시작": "Start with a shared demo account",
  "네이버로 시작": "Continue with Naver",
  "구글로 시작": "Continue with Google",
  "체험 계정은 공용 데이터로 동작합니다. 개인 기록이 필요한 경우 네이버 또는 구글 계정으로 로그인해주세요.":
    "The demo account uses shared data. Sign in with Naver or Google if you need personal records.",
  "닉네임을 정해주세요": "Choose a nickname",
  "닉네임": "Nickname",
  "같은 닉네임을 여러 명이 써도 괜찮아요. 홈에는 닉네임만 표시됩니다.":
    "It's fine if several people share the same nickname. Only the nickname is shown on the home screen.",
  "다시 추천": "Suggest another",
  "이 이름으로 시작": "Start with this name",

  // 드로어 네비 부제 (VIEW_META.description)
  "현위치·계획 지도와 주변 퀘스트": "Current/planned location map and nearby quests",
  "진행 중인 퀘스트": "Ongoing quests",
  "탐색 컨텍스트 기준 추천": "Recommendations based on your exploration context",
  "꿈돌이와 연결 뱃지": "Ggumdori and linked badges",
  "계정·기록·설정·권한": "Account, log, settings, permissions",

  // 서비스워커 업데이트 배너
  "새 버전이 준비됐어요.": "A new version is ready.",
  "나중에": "Later",

  // 홈 화면
  "현위치": "Current location",
  "계획 모드": "Plan mode",
  "계획 중": "Planning",
  "날씨 연동 준비 중": "Weather integration coming soon",
  "대전광역시청": "Daejeon City Hall",
  "대전광역시청 기준": "Based on Daejeon City Hall",
  "GPS 확인 중": "Checking GPS",
  "GPS ON": "GPS ON",
  "기본 좌표": "Default coordinates",
  "위치 확인 불가, 대전광역시청 기준": "Location unavailable, using Daejeon City Hall",
  "계획 날짜": "Plan date",
  "위치 검색": "Search location",
  "대전광역시청 기준 좌표로 추천을 준비합니다.": "Preparing recommendations based on Daejeon City Hall coordinates.",
  "연결 확인 중": "Checking connection",
  "현재 위치": "Current location",
  "대표 꿈돌이": "Featured Ggumdori",
  "내 위치로 추천": "Recommend near me",
  "도감에서 대표 바꾸기 →": "Change featured one in the collection →",
  "탐험 상태": "Exploration status",
  "주변 퀘스트": "Nearby quests",
  "지도 장소": "Map places",
  "최근 획득 뱃지": "Recently earned badges",
  "선택한 장소 정보": "Selected place info",
  "시트 높이 변경": "Change sheet height",
  "이 위치에는 추천 퀘스트가 없습니다.": "There are no recommended quests at this location.",
  "퀘스트 보기": "View quest",
  "지도만 연결": "Map only",
  "NAVER 지도": "NAVER Map",
  "NAVER Dynamic Map 연결 준비": "NAVER Dynamic Map ready to connect",
  "목업 지도 표시": "Showing mock map",
  "목업": "Mock data",
  "기본 꿈돌이 선택 중": "Default Ggumdori selected",
  "계획 위치": "Planned location",
  "현재 위치 후보": "Current location candidate",
  "획득 뱃지": "Badges earned",
  "뱃지": "Badges",
  "추천 데이터": "Recommendation data",
  "아직 획득한 뱃지가 없습니다.": "No badges earned yet.",
  "맨 아래로": "To bottom",
  "맨 위로": "To top",
  "화면 이동": "Scroll",

  // 퀘스트 상태/가용성 라벨
  "완료": "Completed",
  "완료됨": "Completed",
  "진행 중": "In progress",
  "행사 종료": "Event ended",
  "선택일 수행 불가": "Not available on selected date",
  "추천 가능": "Recommended",
  "추천됨": "Recommended",
  "진행 중인 퀘스트가 없습니다.": "No quests in progress.",
  "퀘스트 찾아보기": "Browse quests",
  "표시할 퀘스트가 없습니다.": "No quests to show.",
  "지금 참여 가능": "Available now",
  "주소 복사": "Copy address",

  // 모험 중 화면
  "진행 중인 모험": "Ongoing adventures",
  "수락한 퀘스트를 가까운 순 또는 시작한 순으로 정렬해 봅니다.": "Sort accepted quests by distance or by when you started them.",
  "가까운 순": "Nearest first",
  "시작 순": "Started first",
  "보드 요약": "Board summary",

  // 퀘스트 화면
  "퀘스트 탐색": "Explore quests",
  "현위치 · 대전광역시청 · 오늘 기준": "Current location · Daejeon City Hall · as of today",
  "오늘 기준": "as of today",
  "소요시간 미정": "Duration TBD",
  "탐험 뱃지": "Explore Badge",
  "추후 제공 예정": "Coming soon",
  "현 단계에서는 야경 카테고리로 조회합니다": "Currently queried under the Night View category",
  "현 단계에서는 야경 카테고리입니다": "Currently the Night View category",
  "거리는 계획 위치 기준입니다.": "Distance is based on the planned location.",
  "카드형": "Card view",
  "목록형": "List view",
  "정렬 기준": "Sort by",
  "짧은 순": "Shortest first",
  "보상 높은 순": "Highest reward first",
  "카테고리": "Category",
  "과학·우주": "Science & Space",
  "빵·미식 · 준비 중": "Bakery & Food · Coming soon",
  "자연·산책": "Nature & Walks",
  "원도심·역사": "Old Town & History",
  "문화·예술(현 단계 야경)": "Culture & Arts (currently Night View)",
  "시장·상권": "Markets & Shops",
  "이동·타슈": "Mobility & Tashu",
  "축제·이벤트 · 준비 중": "Festivals & Events · Coming soon",
  "난이도": "Difficulty",
  "발견": "Discover",
  "탐험": "Explore",
  "정복": "Conquer",
  "퀘스트": "Quests",

  // 도감 화면
  "꿈돌이 도감": "Ggumdori Collection",
  "카테고리 XP를 쌓아 꿈돌이와 뱃지를 해금하세요.": "Earn category XP to unlock Ggumdori characters and badges.",
  "대표 미설정": "No featured character set",
  "사진 찍기": "Take a photo",
  "꿈돌이": "Ggumdori",
  "대전 탐험가": "Daejeon Explorer",
  "모험가": "Adventurer",
  "대표": "Featured",
  "꿈돌이 또는 퀘스트 이름": "Ggumdori or quest name",
  "획득": "Earned",
  "미획득": "Not earned",

  // 마이페이지
  "마이페이지": "My Page",
  "계정": "Account",
  "변경": "Change",
  "같은 닉네임을 여러 명이 써도 괜찮아요.": "It's fine if several people share the same nickname.",
  "공용 체험 계정": "Shared demo account",
  "여러 사용자가 같은 체험 데이터를 사용합니다. 소셜 로그인 시 해당 계정의 기록을 불러옵니다.":
    "Multiple users share the same demo data. Signing in with a social account loads that account's own records.",
  "공용 체험 계정의 기록은 소셜 계정으로 이전되지 않습니다.": "Shared demo account records are not transferred to a social account.",
  "네이버 계정으로 로그인": "Sign in with Naver",
  "구글 계정으로 로그인": "Sign in with Google",
  "네이버 로그인 · 준비 중": "Naver login · Coming soon",
  "구글 로그인 · 준비 중": "Google login · Coming soon",
  "서버 OAuth 설정이 완료된 뒤 사용할 수 있습니다.": "This will be available once server OAuth setup is complete.",
  "관심사": "Interests",
  "관심사는 주변 추천과 대전 전체 관광지 탐색에 사용합니다.": "Interests are used for nearby recommendations and browsing all Daejeon attractions.",
  "관심사 저장": "Save interests",
  "대전 전체 관광지": "All Daejeon attractions",
  "로그아웃": "Log out",
  "회원 탈퇴 · 준비 중": "Delete account · Coming soon",
  "계정 삭제 기능은 현재 제공하지 않습니다.": "Account deletion is not available yet.",

  // 설정
  "소리와 진동": "Sound & vibration",
  "앱에서 나는 소리만 조절해요. 기기 전체 음량은 바뀌지 않습니다.": "This only adjusts sounds within the app; your device's overall volume is unaffected.",
  "전체 음량": "Overall volume",
  "배경음": "Background music",
  "배경음 켜기": "Turn on background music",
  "배경음 끄기": "Turn off background music",
  "효과음 켜기": "Turn on sound effects",
  "효과음 끄기": "Turn off sound effects",
  "화면을 눌러 시작하기": "Tap the screen to start",
  "효과음": "Sound effects",
  "진동": "Vibration",
  "알림": "Notifications",
  "알림을 켜는 순간에만 브라우저 권한을 요청해요.": "Browser permission is requested only when you turn a notification on.",
  "퀘스트 알림": "Quest notifications",
  "행사·축제 알림": "Event & festival notifications",
  "보상 알림": "Reward notifications",
  "화면": "Display",
  "모션 줄이기": "Reduce motion",
  "허용됨": "Granted",
  "거부됨": "Denied",
  "요청 전": "Not requested",
  "확인 불가": "Unavailable",
  "위치": "Location",
  "카메라": "Camera",
  "퀘스트 추천과 완료 인증에 씁니다.": "Used for quest recommendations and completion verification.",
  "사진 인증과 꿈돌이 촬영에 씁니다.": "Used for photo verification and taking Ggumdori photos.",
  "퀘스트·행사·보상 알림에 씁니다.": "Used for quest, event, and reward notifications.",
  "권한은 해당 기능을 실제로 쓸 때 요청해요. 브라우저 설정에서 언제든 바꿀 수 있습니다.":
    "Permission is requested only when you actually use that feature. You can change it anytime in your browser settings.",
  "나의 모험 기록": "My adventure log",
  "완료한 퀘스트를 월별로 모아 봅니다.": "See completed quests grouped by month.",
  "기록 보기": "View log",
  "설정": "Settings",
  "권한": "Permissions",
  "약관과 정책": "Terms & Policies",
  "서비스 이용약관": "Terms of Service",
  "개인정보 처리방침": "Privacy Policy",
  "위치기반서비스 이용약관": "Location-Based Service Terms",
  "오픈소스 라이선스": "Open Source Licenses",
  "정보": "Information",
  "지도: NAVER Maps · 계획 날짜는 일정 메모이며 날씨·행사 연동은 준비 중입니다.":
    "Map: NAVER Maps · The plan date is a schedule note; weather and event integration are coming soon.",
  "영수증 사진은 상호명 확인에만 사용하고 인증 후 원본을 보관하지 않습니다.":
    "Receipt photos are used only to verify the store name and are not kept after verification.",

  // 드로어 메뉴
  "모험 수첩 목차": "Adventure Notebook menu",
  "메뉴 열기": "Open menu",
  "홈": "Home",
  "모험 중": "Adventure",
  "도감": "Collection",

  // 관광지 상세 모달 (신규 이식 기능)
  "추가 정보": "Additional info",
  "이용 시간": "Hours",
  "이용 요금": "Admission fee",
  "영업시간": "Business hours",
  "체크인": "Check-in",
  "체크아웃": "Check-out",
  "공연 시간": "Show time",
  "휴무일": "Closed on",
  "주차": "Parking",
  "문의처": "Contact",
  "예약": "Reservation",
  "유모차 대여": "Stroller rental",
  "반려동물 동반": "Pets allowed",
  "행사 장소": "Event venue",
  "행사 시작일": "Event start date",
  "행사 종료일": "Event end date",
  // 편의 정보 값(TourAPI 원문에 자주 나오는 짧고 고정된 단어). 이용시간처럼 자유 문장인 값은
  // 백엔드가 번역해서 내려주지만(server.py _handle_place_detail), 이런 짧은 고정 단어는
  // 프런트 사전으로 바로 잡는 게 더 빠르고 API 호출도 없다.
  "가능": "Available",
  "불가": "Not available",
  "불가능": "Not available",
  "무료": "Free",
  "유료": "Paid",
  "연중무휴": "Open year-round",
  "년중무휴": "Open year-round",
  "매일": "Daily",
  "없음": "None",
  "있음": "Available",
  "월요일": "Monday",
  "화요일": "Tuesday",
  "수요일": "Wednesday",
  "목요일": "Thursday",
  "금요일": "Friday",
  "토요일": "Saturday",
  "일요일": "Sunday",
  "API 연결됨": "API Connected",
  "목업 모드": "Mock Mode",
  // 브랜드명은 직역이 아니라 원래 영문 서비스명으로 대응한다.
  "모험가의 수첩": "Travel-Qbook",
  "기간": "Period",
  "등록된 편의 정보가 아직 없습니다.": "No amenity information registered yet.",
  "🔊 이 장소는 아직 오디오 가이드가 없습니다.": "🔊 There is no audio guide for this place yet.",
  "▶ 오디오 가이드 재생": "▶ Play audio guide",
  "⏸ 오디오 가이드 정지": "⏸ Stop audio guide",
  "설명을 불러오는 중입니다.": "Loading description...",
  "설명을 준비 중입니다.": "Description coming soon.",
  "상세 정보를 불러오지 못했습니다.": "Failed to load details.",
  "실시간 정보 연결 전 장소입니다 · 기본 설명을 보여드려요.": "This place isn't connected to live data yet · showing a basic description.",
  "실시간 정보 준비 중 · 기본 설명을 보여드려요.": "Live info is not ready yet · showing a basic description.",
  "이 장소는 아직 영문 관광 정보가 없어 자동 번역으로 보여드려요.": "There is no English tourism info for this place yet, so we're showing an automatic translation.",
  "이 장소는 아직 영문 관광 정보가 없어 국문 설명을 보여드려요.": "There is no English tourism info for this place yet, so we're showing the Korean description.",
  "상세 닫기": "Close details",
  "이전 화면으로": "Back",
  "날씨 상세 보기": "View weather details",
  "불러오는 중...": "Loading...",
  // 꿈돌이 이름(백엔드 seed, infrastructure/repository.py GGUMDORI_SEEDS 8종)
  "기본 꿈돌이": "Default Ggumdori",
  "제빵 꿈돌이": "Baker Ggumdori",
  "안경 꿈돌이": "Glasses Ggumdori",
  "플라스크 꿈돌이": "Flask Ggumdori",
  "숲 탐험 꿈돌이": "Forest Explorer Ggumdori",
  "타슈 꿈돌이": "Tashu Ggumdori",
  "야경 꿈돌이": "Night View Ggumdori",
  "온천 꿈돌이": "Hot Spring Ggumdori",
  // 꿈돌이 이름(프런트 fallback 목업 데이터 전용, API 실패 시에만 노출)
  "연구원 꿈돌이": "Researcher Ggumdori",
  "빵집 꿈돌이": "Bakery Ggumdori",
  "산책 꿈돌이": "Stroll Ggumdori",
  "축제 꿈돌이": "Festival Ggumdori",
  // 뱃지 이름(백엔드 seed, infrastructure/repository.py BADGE_SEEDS 12종)
  "초록 탐험가": "Green Explorer",
  "숲 탐험 꿈나무": "Forest Explorer Sprout",
  "과학 탐험가": "Science Explorer",
  "실험실 탐험가": "Lab Explorer",
  "대전 워커": "Daejeon Walker",
  "원도심 산책가": "Old Downtown Stroller",
  "빵지순례자": "Bakery Pilgrim",
  "상권 탐험가": "Market Explorer",
  "타슈 라이더": "Tashu Rider",
  "도시 연결자": "City Connector",
  "전망 수집가": "View Collector",
  "야경 기록가": "Night View Recorder",
  // 계획 위치 프리셋(PLAN_LOCATION_PRESETS)
  "대전역": "Daejeon Station",
  "유성온천역": "Yuseong Spa Station",
  "국립중앙과학관": "National Science Museum",
  "한밭수목원": "Hanbat Arboretum",
  // 위치 라벨 고정 문구(동적 숫자가 끼워지는 정확도 라벨은 localize()로 별도 처리)
  "대전광역시청 기준": "Based on Daejeon City Hall",
  "위치 확인 불가, 대전광역시청 기준": "Unable to determine location, using Daejeon City Hall",
  "계획 위치를 설정해주세요": "Please set a planned location",
  "지도에서 선택한 위치": "Location selected on the map",
};

// UI_STRINGS_EN의 역방향 사전이다. 영문에서 국문으로 되돌아갈 때 쓴다.
// 여러 국문 키가 같은 영문 값으로 매핑된 경우(예: "완료"/"완료됨" 모두 "Completed") 마지막
// 항목이 우선한다 — 되돌아갈 때 원문과 정확히 같은 국문 문구가 아닐 수 있지만 의미는 같다.
const UI_STRINGS_KOR = Object.fromEntries(
  Object.entries(UI_STRINGS_EN).map(([korean, english]) => [english, korean]),
);

/**
 * 입력: 번역을 적용할 루트 노드. 기본값은 document.body.
 * 출력: 없음.
 * 역할: 텍스트 노드와 일부 속성을 사전에 있는 값으로 치환한다. 이 앱은 매 렌더마다
 *       DOM을 국문 리터럴로 새로 만들기 때문에, 되돌리는 로직 없이 다시 렌더하면
 *       자연스럽게 국문으로 복원된다.
 * 호출 예시: applyUiLanguage(document.body)
 */
function applyUiLanguage(root = document.body) {
  // 변수 의미: 지금 방향에 맞는 사전이다. 국문 리터럴을 새로 만드는 render*() 함수들과
  // 달리, 정적 index.html 텍스트나 별도 스크립트(scroll-fab 등)가 건드리는 속성은
  // 국문으로 돌아갈 때 아무도 되돌려주지 않으므로, kor 방향에서도 역방향 사전으로
  // 명시적으로 되돌려야 한다.
  const dictionary = state.uiLanguage === "eng" ? UI_STRINGS_EN : state.uiLanguage === "kor" ? UI_STRINGS_KOR : null;
  if (!dictionary || !root) {
    return;
  }

  // 텍스트 노드를 순회하며 정확히 일치하는 항목만 치환합니다.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // 변수 의미: 순회 중 즉시 수정하면 TreeWalker가 불안정해질 수 있어 먼저 모아둡니다.
  const textNodes = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode);
    currentNode = walker.nextNode();
  }
  textNodes.forEach((node) => {
    // 변수 의미: 앞뒤 공백을 포함한 원본 텍스트입니다.
    const original = node.nodeValue;
    const trimmed = original.trim();
    if (!trimmed) {
      return;
    }
    if (dictionary[trimmed]) {
      node.nodeValue = original.replace(trimmed, dictionary[trimmed]);
      return;
    }
    // 변수 의미: "대전광역시청 기준 · 36.3504, 127.3845 · NAVER Dynamic Map 연결 준비"처럼
    // " · "로 이어붙인 상태 문구는 조각 단위로 사전을 찾아본다.
    if (trimmed.includes(" · ")) {
      const segments = trimmed.split(" · ");
      const translatedSegments = segments.map((segment) => dictionary[segment] || segment);
      if (translatedSegments.some((segment, index) => segment !== segments[index])) {
        node.nodeValue = original.replace(trimmed, translatedSegments.join(" · "));
      }
    }
  });

  // 스크린리더 전용 라벨과 툴팁도 함께 치환합니다.
  const attributeSelector = "[aria-label], [title], [placeholder]";
  root.querySelectorAll(attributeSelector).forEach((element) => {
    ["aria-label", "title", "placeholder"].forEach((attributeName) => {
      const value = element.getAttribute(attributeName);
      if (value && dictionary[value]) {
        element.setAttribute(attributeName, dictionary[value]);
      }
    });
  });
  if (root.hasAttribute?.("aria-label") && dictionary[root.getAttribute("aria-label")]) {
    root.setAttribute("aria-label", dictionary[root.getAttribute("aria-label")]);
  }
}

// 언어 번역 재적용이 겹치지 않도록 다음 애니메이션 프레임까지 미루는 예약 플래그입니다.
let uiLanguageApplyScheduled = false;

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: document.body에 MutationObserver를 한 번 걸어, 화면이 다시 그려질 때마다
 *       영문 모드면 자동으로 번역을 재적용한다. 기존 렌더 함수들을 일일이 고치지 않기 위한 장치다.
 * 호출 예시: setupUiLanguageObserver()
 */
function setupUiLanguageObserver() {
  const observer = new MutationObserver(() => {
    // 변수 의미: 탭이 백그라운드에 있으면 requestAnimationFrame 콜백이 아예 실행되지
    // 않아 예약 플래그가 영영 풀리지 않을 수 있다. setTimeout은 백그라운드 탭에서도
    // (지연될 뿐) 반드시 실행되므로 이걸 대신 쓴다.
    if (state.uiLanguage !== "eng" || uiLanguageApplyScheduled) {
      return;
    }
    uiLanguageApplyScheduled = true;
    window.setTimeout(() => {
      uiLanguageApplyScheduled = false;
      applyUiLanguage(document.body);
    }, 0);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder"],
  });
}

/**
 * 입력: 사용자가 드로어에서 고른 다음 화면 언어.
 * 출력: 없음.
 * 역할: 화면 언어를 바꾸고, 정적 UI·동적 추천 텍스트·열려 있는 상세 모달을 모두 새 언어로 갱신한다.
 * 호출 예시: handleUiLanguageChange("eng")
 */
function handleUiLanguageChange(nextLanguage) {
  const normalizedLanguage = SUPPORTED_UI_LANGUAGES.includes(nextLanguage) ? nextLanguage : "kor";
  if (normalizedLanguage === state.uiLanguage) {
    return;
  }
  state.uiLanguage = normalizedLanguage;
  writeStorageValue(UI_LANGUAGE_KEY, normalizedLanguage);

  // 닉네임 입력칸이 아직 사용자가 손대지 않은 제안값 그대로면(nicknameSuggestionIndices가
  // 남아 있으면), 같은 조합을 새 언어 단어로 다시 조립한다. <input>의 value는 텍스트 노드가
  // 아니라 applyUiLanguage()의 DOM 스윕으로는 못 잡기 때문에 여기서 직접 갱신해야 한다.
  // 사용자가 직접 입력칸을 고친 경우에는 이미 null이라 건드리지 않는다.
  if (state.nicknameSuggestionIndices) {
    state.nicknameDraft = formatNicknameSuggestion(
      state.nicknameSuggestionIndices.prefixIndex,
      state.nicknameSuggestionIndices.nounIndex,
    );
  }

  renderAll();
  // renderAll()에는 온보딩 닉네임 단계가 없다(진입 액션에서만 그려짐). <input>의 value는
  // applyUiLanguage()의 DOM 스윕으로도 못 잡으니, 지금 그 단계가 보이는 중이면 직접 다시 그린다.
  renderAccountStep();
  applyUiLanguage(document.body);

  // 온보딩 화면과 드로어 메뉴, 두 드롭다운이 같은 값을 보여주도록 맞춥니다.
  // 둘 다 정적 HTML 요소라 renderAll()이 값을 다시 맞춰주지 않습니다.
  ["#onboarding-language-select", "#ui-language-select"].forEach((selector) => {
    const languageSelect = select(selector);
    if (languageSelect) {
      languageSelect.value = normalizedLanguage;
    }
  });

  // 장소명/퀘스트 제목·설명(Papago 번역)을 새 언어로 다시 받아옵니다.
  // TourAPI 캐시까지 강제로 무시하면(refresh=1) 매번 느린 실시간 조회가 걸리니,
  // 캐시는 그대로 쓰고 번역만 새로 받도록 강제 새로고침 없이 호출한다.
  // ensureSessionReady()는 미로그인 시 동의 화면으로 강제 전환하는 부작용이 있어
  // 언어 전환 같은 무관한 동작에서는 쓰지 않고 토큰 존재 여부만 직접 확인한다.
  if (state.accessToken) {
    loadRecommendations(false);
  }

  // 열려 있는 관광지 상세 모달도 새 언어로 다시 불러옵니다.
  if (state.placeDetailSheet?.place) {
    loadPlaceDetail(state.placeDetailSheet.place);
  }
}

/**
 * 입력: 없음.
 * 출력: URL 해시에서 읽은 초기 화면 ID.
 * 역할: 새로고침해도 사용자가 보던 하단 탭을 최대한 유지한다.
 * 호출 예시: const view = readInitialView()
 */
function readInitialView() {
  // URL 해시에서 #view- 접두사를 제거한 화면 ID입니다.
  const viewFromHash = window.location.hash.replace(/^#view-/, "");

  return resolveViewId(viewFromHash);
}

/**
 * 입력: 라우트 후보 문자열.
 * 출력: 다섯 최상위 화면 중 하나의 ID.
 * 역할: v1 해시(#view-map 등)를 통합된 v2 라우트로 옮긴다.
 * 호출 예시: resolveViewId("map")
 */
function resolveViewId(candidate) {
  if (VIEW_META[candidate]) {
    return candidate;
  }

  return LEGACY_VIEW_MAP[candidate] || "home";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 로그아웃 상태에서 내부 화면 해시를 제거하고 앱 화면 상태를 홈으로 되돌린다.
 * 호출 예시: resetLoggedOutNavigation()
 */
function resetLoggedOutNavigation() {
  // 로그인 화면에서 노출하지 않을 내부 화면 해시를 제거한 URL입니다.
  const cleanUrl = `${window.location.pathname}${window.location.search}`;

  state.activeView = "home";
  if (window.location.hash) {
    window.history.replaceState(null, "", cleanUrl);
  }
  setActiveView("home", false);
}

/**
 * 입력: localStorage 키와 저장할 문자열.
 * 출력: 없음.
 * 역할: 저장소 오류가 있어도 화면 흐름을 중단하지 않는다.
 * 호출 예시: writeStorageValue(QUEST_STATUS_KEY, "{}")
 */
function writeStorageValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // 저장소 사용이 불가능한 환경에서는 현재 메모리 상태만 유지합니다.
  }
}

/**
 * 입력: localStorage 키.
 * 출력: 없음.
 * 역할: 저장된 세션 값이 만료됐을 때 브라우저 저장소에서 제거한다.
 * 호출 예시: removeStorageValue(ACCESS_TOKEN_KEY)
 */
function removeStorageValue(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    // 저장소 사용이 불가능한 환경에서는 현재 메모리 상태만 정리합니다.
  }
}

/**
 * 입력: sessionStorage 키와 저장할 문자열.
 * 출력: 저장 성공 여부.
 * 역할: OAuth callback을 같은 브라우저 세션에 바인딩할 nonce를 보관한다.
 * 호출 예시: writeSessionValue(OAUTH_NONCE_KEY, nonce)
 */
function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 입력: sessionStorage 키.
 * 출력: 저장된 문자열 또는 null.
 * 역할: OAuth callback 이후 token 교환에 사용할 nonce를 읽는다.
 * 호출 예시: const nonce = readSessionValue(OAUTH_NONCE_KEY)
 */
function readSessionValue(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

/**
 * 입력: sessionStorage 키.
 * 출력: 없음.
 * 역할: OAuth nonce를 더 이상 쓰지 않을 때 제거한다.
 * 호출 예시: removeSessionValue(OAUTH_NONCE_KEY)
 */
function removeSessionValue(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (error) {
    // 세션 저장소 사용이 불가능한 환경에서는 제거할 값도 없습니다.
  }
}

/**
 * 입력: URL fragment에서 잘라낸 인코딩 문자열.
 * 출력: 디코딩한 문자열 또는 빈 문자열.
 * 역할: 잘못 인코딩된 fragment가 앱 초기화를 중단하지 않게 한다.
 * 호출 예시: const token = decodeFragmentValue(rawToken)
 */
function decodeFragmentValue(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return "";
  }
}

/**
 * 입력: 없음.
 * 출력: URL 안전 OAuth nonce 문자열.
 * 역할: 로그인 시작 브라우저와 callback 브라우저를 묶을 난수를 만든다.
 * 호출 예시: const nonce = createOAuthNonce()
 */
function createOAuthNonce() {
  if (globalThis.crypto?.randomUUID) {
    return `${globalThis.crypto.randomUUID()}-${globalThis.crypto.randomUUID()}`;
  }

  if (globalThis.crypto?.getRandomValues) {
    // nonce 생성에 사용할 난수 바이트입니다.
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return "";
}

/**
 * 입력: 숫자 후보 값, 기본값.
 * 출력: 유효한 숫자.
 * 역할: API 응답의 숫자 필드를 안전하게 보정한다.
 * 호출 예시: toNumber(item.rewardXp, 100)
 */
function toNumber(value, fallback = 0) {
  // 숫자로 변환한 API 값입니다.
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : fallback;
}

/**
 * 입력: 진행 값과 최대 값.
 * 출력: 0부터 100 사이의 퍼센트.
 * 역할: 레벨과 뱃지 진행률을 화면용 비율로 계산한다.
 * 호출 예시: getProgressPercent(120, 300)
 */
function getProgressPercent(value, maxValue) {
  // 진행률 계산에 사용할 안전한 최대 값입니다.
  const safeMaxValue = Math.max(toNumber(maxValue, 1), 1);

  return Math.min(Math.max((toNumber(value) / safeMaxValue) * 100, 0), 100);
}

/**
 * 입력: 거리 미터 값.
 * 출력: 사람이 읽기 쉬운 거리 문자열.
 * 역할: 추천 카드의 거리 표시를 만든다.
 * 호출 예시: formatDistance(1500)
 */
function formatDistance(distanceMeters) {
  // 화면에 표시할 거리 숫자입니다.
  const safeDistance = toNumber(distanceMeters);

  if (safeDistance >= 1000) {
    return `${(safeDistance / 1000).toFixed(1)}km`;
  }

  return `${Math.round(safeDistance)}m`;
}

/**
 * 입력: ISO 날짜 문자열.
 * 출력: 한국어 날짜 문자열.
 * 역할: 수첩 기록 시간을 모바일 화면에 맞게 표시한다.
 * 호출 예시: formatDate("2026-06-24T10:40:00+09:00")
 */
function formatDate(value) {
  // 날짜 포맷에 사용할 Date 객체입니다.
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "날짜 미정";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 입력: 없음.
 * 출력: 저장된 퀘스트 상태 객체.
 * 역할: 오프라인 또는 API 실패 시에도 사용자의 버튼 상태를 유지한다.
 * 호출 예시: readStoredQuestStatuses()
 */
function readStoredQuestStatuses() {
  try {
    // localStorage에서 읽은 원본 문자열입니다.
    const storedValue = readStorageValue(QUEST_STATUS_KEY);

    return storedValue ? JSON.parse(storedValue) : {};
  } catch (error) {
    return {};
  }
}

/**
 * 입력: 없음.
 * 출력: 저장된 표시 꿈돌이 식별자.
 * 역할: 사용자가 선택한 꿈돌이를 앱 재방문 시 복원한다.
 * 호출 예시: readSelectedGgumdoriId()
 */
function readSelectedGgumdoriId() {
  return readStorageValue(SELECTED_GGUMDORI_KEY) || "default-1";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 현재 퀘스트 상태를 브라우저에 저장한다.
 * 호출 예시: persistQuestStatuses()
 */
function persistQuestStatuses() {
  writeStorageValue(QUEST_STATUS_KEY, JSON.stringify(state.questStatuses));
}

/**
 * 입력: 실패한 fetch Response.
 * 출력: HTTP 상태와 응답 본문을 포함한 Error Promise.
 * 역할: 401 같은 실패 상태를 호출부에서 구분할 수 있게 만든다.
 * 호출 예시: const error = await createApiError(response)
 */
async function createApiError(response) {
  // 호출부에 전달할 API 오류 객체입니다.
  const error = new Error(`API 요청 실패: ${response.status}`);
  error.name = "ApiError";
  error.status = response.status;

  try {
    // 서버가 내려준 오류 JSON 본문입니다.
    error.payload = await response.clone().json();
  } catch (parseError) {
    error.payload = null;
  }

  return error;
}

/**
 * 입력: 오류 객체.
 * 출력: 인증 만료 오류 여부.
 * 역할: API 호출 실패 중 401만 세션 만료 처리 대상으로 구분한다.
 * 호출 예시: if (isUnauthorizedError(error)) resetExpiredSession()
 */
function isUnauthorizedError(error) {
  return Number(error?.status) === 401;
}

/**
 * 입력: 사용자에게 보여줄 세션 만료 문구.
 * 출력: 없음.
 * 역할: 만료된 access token을 폐기하고 동의·로그인 화면으로 되돌린다.
 * 호출 예시: resetExpiredSession("세션이 만료되었습니다.")
 */
function resetExpiredSession(message = "세션이 만료되었습니다. 다시 동의 후 시작하세요.") {
  state.accessToken = "";
  state.sessionVersion += 1;
  state.notes = [];
  state.notesSource = "api";
  state.notePhotos = {};
  state.noteDrafts = {};
  state.badges = [];
  state.ggumdori = [];
  state.catalog = { earnedCount: 0, totalCount: 0, entries: [], nextCursor: "" };
  state.preference = { categories: [], categoriesSetAt: "", isConfigured: false };
  state.interestDraft = [];
  state.attractions = [];
  clearAccountActions();
  removeStorageValue(ACCESS_TOKEN_KEY);
  removeSessionValue(OAUTH_NONCE_KEY);
  resetLoggedOutNavigation();
  renderNotes();
  setConsentPanelVisible(true);
  setConsentMessage(message);
  updateSystemStatus(false, "다시 로그인 필요");
}

/**
 * 입력: API 경로와 fetch 옵션.
 * 출력: JSON 응답 Promise.
 * 역할: 같은 origin API를 호출하고 실패 응답을 예외로 처리한다.
 * 호출 예시: fetchJson("/api/me")
 */
async function fetchJson(path, options = {}) {
  // 요청을 시작한 로그인 세션의 버전입니다.
  const requestSessionVersion = state.sessionVersion;
  // 이 요청의 인증 토큰입니다.
  const requestAccessToken = state.accessToken;
  // API 요청에 보낼 헤더입니다.
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (requestAccessToken) {
    headers.Authorization = `Bearer ${requestAccessToken}`;
  }

  // fetch에 전달할 기본 옵션입니다.
  const requestOptions = {
    ...options,
    headers,
  };

  // 같은 origin API에서 받은 응답입니다.
  const response = await fetch(path, requestOptions);

  if (!response.ok) {
    // 호출부에서 상태별로 처리할 수 있는 API 오류입니다.
    const error = await createApiError(response);
    if (isUnauthorizedError(error) && requestAccessToken && requestAccessToken === state.accessToken && requestSessionVersion === state.sessionVersion) {
      resetExpiredSession();
    }
    throw error;
  }

  return response.json();
}

/**
 * 입력: 없음.
 * 출력: 요청을 시작한 로그인 세션이 현재도 유효한지 검사하는 함수.
 * 역할: 비동기 작업이 계정 전환 뒤 상태를 변경하거나 후속 요청을 보내는 것을 막습니다.
 * 호출 예시: const isCurrentSession = captureSession();
 */
function captureSession() {
  // 작업을 시작한 계정의 토큰과 세션 버전입니다.
  const accessToken = state.accessToken;
  const sessionVersion = state.sessionVersion;
  return () => Boolean(accessToken) && accessToken === state.accessToken && sessionVersion === state.sessionVersion;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 로그아웃과 만료 시 계정에 속한 처리 상태와 열린 기록을 정리합니다.
 * 호출 예시: clearAccountActions();
 */
function clearAccountActions() {
  state.pendingQuestActions = {};
  state.evidenceUploads = {};
  state.questStatuses = {};
  state.recommendations = [];
  state.nicknamePending = false;
  state.selectedGgumdoriId = "";
  state.interestDraft = [];
  state.interestMessage = "";
  state.attractionMessage = "";
  state.recordMessage = "";
  state.actionDialog = null;
  state.recordSheetOpen = false;
  state.recordDetailId = "";
  state.catalogSheetId = "";
  state.questSheetId = "";
  state.planSheetOpen = false;
  state.weatherSheetOpen = false;
  stopPhotoCamera();
  if (state.photo.pickedImageUrl) {
    URL.revokeObjectURL(state.photo.pickedImageUrl);
  }
  state.photo = createEmptyPhotoState();
  renderPhotoSheet();
  renderRecordSheet();
}

/**
 * 입력: 표시 여부.
 * 출력: 없음.
 * 역할: 필수 동의 패널 표시 상태를 바꾼다.
 * 호출 예시: setConsentPanelVisible(true)
 */
function setConsentPanelVisible(isVisible) {
  // 필수 동의 패널 요소입니다.
  const panel = select("#consent-panel");
  // 로그인 이후 화면 묶음입니다.
  const appViews = select("#app-views");
  // 우측 책갈피 손잡이입니다. 동의 전에는 이동할 화면이 없어 감춥니다.
  const handle = select("#bookmark-handle");

  if (panel) {
    panel.hidden = !isVisible;
  }
  if (appViews) {
    appViews.hidden = isVisible;
  }
  if (handle) {
    handle.hidden = isVisible;
  }
  if (isVisible) {
    closeDrawer();
  }
}

/**
 * 입력: 사용자에게 보여줄 메시지.
 * 출력: 없음.
 * 역할: 동의 및 로그인 처리 결과를 화면에 표시한다.
 * 호출 예시: setConsentMessage("동의가 필요합니다.")
 */
function setConsentMessage(message) {
  // 동의 처리 메시지 요소입니다.
  const messageElement = select("#consent-message");

  if (messageElement) {
    messageElement.textContent = message;
  }
}

/**
 * 입력: 진행 중인 provider 이름과 진행 여부.
 * 출력: 없음.
 * 역할: OAuth 시작 중 버튼 중복 클릭을 막고 진행 상태를 표시한다.
 * 호출 예시: setOAuthLoginPending("naver", true)
 */
function setOAuthLoginPending(provider, isPending) {
  ["naver", "google"].forEach((item) => {
    // OAuth 로그인 버튼입니다.
    const button = select(`#${item}-login-button`);
    if (!button) {
      return;
    }
    button.disabled = isPending;
    button.setAttribute("aria-busy", isPending && item === provider ? "true" : "false");
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 정적 디자인 초안에서 백엔드 호출 없이 로컬 체험 세션을 시작한다.
 * 호출 예시: startLocalDemoSession()
 */
function startLocalDemoSession() {
  state.accessToken = "design-preview";
  writeStorageValue(ACCESS_TOKEN_KEY, state.accessToken);
  setConsentPanelVisible(false);
  state.sessionVersion += 1;
  setConsentMessage("");
  updateSystemStatus(false, "체험 모드");
  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 정적 배포에서 서버가 필요한 OAuth 버튼의 현재 상태를 명확히 표시한다.
 * 호출 예시: configureHostedPreviewLogin()
 */
function configureHostedPreviewLogin() {
  if (!IS_HOSTED_STATIC_PREVIEW) {
    return;
  }

  [
    ["#naver-login-button", "네이버 로그인 · 연동 준비 중"],
    ["#google-login-button", "구글 로그인 · 연동 준비 중"],
  ].forEach(([selector, label]) => {
    const button = select(selector);
    if (!button) {
      return;
    }
    button.textContent = label;
    button.disabled = true;
    button.title = "앱 서버와 OAuth 키를 연결한 뒤 사용할 수 있습니다.";
  });
}

/**
 * 입력: 없음.
 * 출력: demo-social 로그인 처리 Promise.
 * 역할: 만 14세 이상 확인과 개인정보·위치정보 동의를 서버에 기록하고 access token을 받는다.
 * 호출 예시: await handleDemoLogin()
 */
async function handleDemoLogin() {
  // 만 14세 이상 확인 체크박스입니다.
  const ageInput = select("#age-confirmed");

  // 개인정보 동의 체크박스입니다.
  const privacyInput = select("#privacy-consent");

  // 위치정보 동의 체크박스입니다.
  const locationInput = select("#location-consent");

  // 서비스 이용약관 동의 체크박스입니다. (명세 §9.5)
  const termsInput = select("#terms-consent");

  if (!ageInput?.checked || !termsInput?.checked || !privacyInput?.checked || !locationInput?.checked) {
    setConsentMessage("네 항목을 모두 확인해야 시작할 수 있습니다.");
    return;
  }

  if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
    startLocalDemoSession();
    // 체험 모드에서도 공통 닉네임 단계를 거칩니다. (명세 §9.1)
    setConsentPanelVisible(true);
    enterNicknameStep();
    return;
  }

  try {
    // demo-social 로그인 API 응답입니다.
    const payload = await fetchJson("/api/auth/demo-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerUserId: "demo-user",
        displayName: "꼬마 탐험가",
        ageConfirmed: true,
        privacyConsent: true,
        locationConsent: true,
      }),
    });
    state.sessionVersion += 1;
    state.accessToken = payload.accessToken;
    writeStorageValue(ACCESS_TOKEN_KEY, payload.accessToken);
    setConsentMessage("");
    await loadInitialData();
    // 계정 방식을 고른 뒤 모든 사용자가 닉네임을 설정합니다. (명세 §9.4)
    enterNicknameStep();
  } catch (error) {
    setConsentMessage("로그인 처리에 실패했습니다. 잠시 뒤 다시 시도하세요.");
  }
}

/**
 * 입력: 없음.
 * 출력: OAuth provider 설정 조회 Promise.
 * 역할: 서버에 설정된 로그인 방식만 활성화하고 준비되지 않은 버튼은 정확히 표시합니다.
 * 호출 예시: await loadAuthProviders()
 */
async function loadAuthProviders() {
  try {
    const payload = await fetchJson("/api/auth/providers");
    const providers = Array.isArray(payload?.providers) ? payload.providers : [];
    state.authProviders = {
      naver: Boolean(providers.find((item) => item.id === "naver")?.configured),
      google: Boolean(providers.find((item) => item.id === "google")?.configured),
    };
  } catch (error) {
    state.authProviders = { naver: false, google: false };
  }

  [
    ["naver", "#naver-login-button", "네이버"],
    ["google", "#google-login-button", "구글"],
  ].forEach(([provider, selector, label]) => {
    const button = select(selector);
    if (!button || IS_HOSTED_STATIC_PREVIEW) {
      return;
    }
    const configured = state.authProviders[provider];
    button.disabled = !configured;
    button.textContent = configured ? `${label}로 시작` : `${label} 로그인 · 준비 중`;
    button.title = configured ? "" : "서버 OAuth 설정이 완료된 뒤 사용할 수 있습니다.";
  });
}

/**
 * 입력: provider 이름("naver" 또는 "google").
 * 출력: OAuth 로그인 시작 Promise.
 * 역할: 동의 3항목 검증 후 인가 URL을 받아 provider 로그인 페이지로 이동한다.
 * 호출 예시: await handleOAuthLogin("naver")
 */
async function handleOAuthLogin(provider) {
  // 만 14세 이상 확인 체크박스입니다.
  const ageInput = select("#age-confirmed");

  // 개인정보 동의 체크박스입니다.
  const privacyInput = select("#privacy-consent");

  // 위치정보 동의 체크박스입니다.
  const locationInput = select("#location-consent");

  // 서비스 이용약관 동의 체크박스입니다. (명세 §9.5)
  const termsInput = select("#terms-consent");

  if (!ageInput?.checked || !termsInput?.checked || !privacyInput?.checked || !locationInput?.checked) {
    setConsentMessage("네 항목을 모두 확인해야 로그인할 수 있습니다.");
    return;
  }

  // OAuth callback 검증에 사용할 브라우저 세션 nonce입니다.
  const oauthNonce = createOAuthNonce();
  if (!oauthNonce || !writeSessionValue(OAUTH_NONCE_KEY, oauthNonce)) {
    setConsentMessage("현재 브라우저에서는 보안 로그인 상태를 저장할 수 없습니다.");
    return;
  }

  setOAuthLoginPending(provider, true);
  setConsentMessage("로그인 페이지로 이동합니다.");

  try {
    // provider 로그인 시작 API 응답입니다.
    const payload = await fetchJson(`/api/auth/${provider}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ageConfirmed: true,
        privacyConsent: true,
        locationConsent: true,
        oauthNonce,
      }),
    });

    if (payload.authorizeUrl) {
      window.location.href = payload.authorizeUrl;
      return;
    }

    removeSessionValue(OAUTH_NONCE_KEY);
    setOAuthLoginPending(provider, false);
    setConsentMessage("로그인 시작에 필요한 이동 주소를 받지 못했습니다.");
  } catch (error) {
    removeSessionValue(OAUTH_NONCE_KEY);
    setOAuthLoginPending(provider, false);
    setConsentMessage("로그인 시작에 실패했습니다. 잠시 뒤 다시 시도하세요.");
  }
}

/**
 * 입력: callback fragment에서 받은 단회 OAuth code.
 * 출력: token 교환 Promise.
 * 역할: sessionStorage nonce와 단회 code를 서버에 보내 access token을 받는다.
 * 호출 예시: await redeemOAuthCode("code")
 */
async function redeemOAuthCode(oauthCode) {
  // 브라우저 세션에 저장된 OAuth nonce입니다.
  const oauthNonce = readSessionValue(OAUTH_NONCE_KEY) || "";
  if (!oauthCode || !oauthNonce) {
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(true);
    setConsentMessage("로그인 검증 정보가 만료되었습니다. 다시 시도하세요.");
    return;
  }

  try {
    // OAuth code 교환 API 응답입니다.
    const payload = await fetchJson("/api/auth/oauth-code/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oauthCode, oauthNonce }),
    });
    state.accessToken = payload.accessToken || "";
    if (!state.accessToken) {
      throw new Error("missing access token");
    }
    writeStorageValue(ACCESS_TOKEN_KEY, state.accessToken);
    state.sessionVersion += 1;
    removeSessionValue(OAUTH_NONCE_KEY);

    state.accountLinkState = "idle";
    state.accountMessage = "소셜 계정으로 로그인했습니다.";

    setConsentPanelVisible(false);
    setConsentMessage("");
    await loadInitialData();
  } catch (error) {
    removeSessionValue(OAUTH_NONCE_KEY);
    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    setConsentPanelVisible(true);
    setConsentMessage("로그인 검증에 실패했습니다. 다시 시도하세요.");
  }
}

/**
 * 입력: 없음.
 * 출력: 게스트 세션을 되살렸는지 여부.
 * 역할: 소셜 연결이 실패해도 게스트 토큰과 데이터를 유지한다. (명세 §9.3)
 * 호출 예시: if (restoreGuestSession()) { ... }
 */
function restoreGuestSession() {
  // 연결 시도 전에 보관해 둔 게스트 토큰입니다.
  const guestToken = readStorageValue(GUEST_TOKEN_KEY) || "";

  if (!guestToken) {
    return false;
  }

  state.accessToken = guestToken;
  writeStorageValue(ACCESS_TOKEN_KEY, guestToken);
  removeStorageValue(GUEST_TOKEN_KEY);
  removeSessionValue(OAUTH_INTENT_KEY);
  return true;
}

/**
 * 입력: 없음.
 * 출력: 비동기 token 교환을 시작했는지 여부.
 * 역할: 콜백이 심은 URL fragment에서 단회 code 또는 오류를 읽어 처리하고 주소창을 정리한다.
 * 호출 예시: const pending = consumeOAuthRedirect()
 */
function consumeOAuthRedirect() {
  // 현재 주소의 fragment 문자열입니다.
  const hash = window.location.hash || "";

  if (hash.startsWith("#oauth_code=")) {
    // fragment에서 꺼낸 단회 OAuth code입니다.
    const oauthCode = decodeFragmentValue(hash.slice("#oauth_code=".length));
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setConsentPanelVisible(true);
    setConsentMessage("로그인을 검증하는 중입니다.");
    redeemOAuthCode(oauthCode);
    return true;
  }

  if (hash.startsWith("#oauth_error=")) {
    // fragment에서 꺼낸 오류 코드입니다.
    const reason = decodeFragmentValue(hash.slice("#oauth_error=".length)) || "login_failed";
    removeSessionValue(OAUTH_NONCE_KEY);
    history.replaceState(null, "", window.location.pathname + window.location.search);

    // 승계 시도였다면 게스트 세션을 그대로 되살립니다. (명세 §9.3)
    if (restoreGuestSession()) {
      state.accountLinkState = "failed";
      state.accountMessage = `계정 연결에 실패했어요 (${reason}). 기록은 그대로 있으니 다시 시도해주세요.`;
      setConsentPanelVisible(false);
      return false;
    }

    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    setConsentPanelVisible(true);
    setConsentMessage(`로그인에 실패했습니다 (${reason}). 다시 시도하세요.`);
  }
  return false;
}

/**
 * 입력: 없음.
 * 출력: 인증 준비 여부.
 * 역할: 저장된 access token이 없으면 동의 패널을 표시한다.
 * 호출 예시: if (ensureSessionReady()) await loadInitialData()
 */
function ensureSessionReady() {
  if (state.accessToken) {
    setConsentPanelVisible(false);
    return true;
  }

  resetLoggedOutNavigation();
  setConsentPanelVisible(true);
  updateSystemStatus(false, "동의 대기");
  return false;
}

/**
 * 입력: API 원본 응답.
 * 출력: 배열 데이터.
 * 역할: 서로 다른 응답 래핑 형태에서 목록을 꺼낸다.
 * 호출 예시: unwrapList(apiResponse)
 */
function unwrapList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  return (
    payload.items ||
    payload.data ||
    payload.results ||
    payload.recommendations ||
    payload.badges ||
    payload.notes ||
    payload.ggumdori ||
    payload.variants ||
    []
  );
}

/**
 * 입력: 추천 API 전체 응답.
 * 출력: 추천 데이터 원천과 캐시 메타데이터.
 * 역할: TourAPI live/fallback 상태를 화면에 표시할 수 있게 보존한다.
 * 호출 예시: state.recommendationMeta = normalizeRecommendationMeta(payload)
 */
function normalizeRecommendationMeta(payload) {
  // 추천 API 전체 응답 객체입니다.
  const response = payload || {};

  // 추천 API의 캐시 메타데이터입니다.
  const cache = response.cache || {};

  return {
    sourceStatus: String(cache.sourceStatus || response.sourceStatus || "fallback:unknown"),
    cacheHit: Boolean(cache.hit),
    attribution: String(response.attribution || "관광정보 제공: 한국관광공사(TourAPI)"),
    fetchedAt: String(cache.fetchedAt || ""),
    expiresAt: String(cache.expiresAt || ""),
  };
}

/**
 * 입력: 없음.
 * 출력: 홈 지표에 표시할 추천 데이터 원천 이름.
 * 역할: 앱 API 연결 여부와 TourAPI live 여부를 짧은 라벨로 구분한다.
 * 호출 예시: const label = getRecommendationDataLabel()
 */
function getRecommendationDataLabel() {
  // 추천 API가 보고한 데이터 원천 상태입니다.
  const sourceStatus = state.recommendationMeta.sourceStatus;

  if (state.dataSource !== "api") {
    return "목업";
  }
  if (sourceStatus === "live") {
    return "TourAPI";
  }
  return "Fallback";
}

/**
 * 입력: 없음.
 * 출력: 사용자에게 표시할 TourAPI 상태 문구.
 * 역할: live, 키 미설정, 상위 오류, 클라이언트 fallback을 구분해 안내한다.
 * 호출 예시: homeDataNote.textContent = getTourApiStatusText()
 */
function getTourApiStatusText() {
  // 현재 추천 API 메타데이터입니다.
  const meta = state.recommendationMeta;

  // 캐시 사용 여부 표시 문구입니다.
  const cacheText = meta.cacheHit ? "30분 캐시 사용" : "새 조회";

  if (state.dataSource !== "api") {
    return "앱 API 연결 실패로 브라우저 목업 데이터를 표시합니다.";
  }

  if (meta.sourceStatus === "live") {
    return `${meta.attribution}. 실제 TourAPI 응답 · ${cacheText}.`;
  }

  if (meta.sourceStatus.startsWith("fallback:result_code_")) {
    return `TourAPI가 오류 resultCode를 반환해 대전 fallback 장소 데이터로 표시합니다. ${cacheText}.`;
  }

  // fallback 상태별 사용자 안내 문구입니다.
  const fallbackMessages = {
    "fallback:not_configured": "현재 기본 대전 장소 정보를 표시합니다.",
    "fallback:circuit_open": "TourAPI 연속 실패로 잠시 대전 fallback 장소 데이터로 표시합니다.",
    "fallback:empty": "TourAPI 주변 장소 결과가 비어 있어 대전 fallback 장소 데이터로 표시합니다.",
    "fallback:upstream_4xx": "TourAPI 요청이 인증 또는 요청 오류를 반환해 대전 fallback 장소 데이터로 표시합니다.",
    "fallback:upstream_error": "TourAPI 호출 오류로 대전 fallback 장소 데이터로 표시합니다.",
    "fallback:client_error": "추천 API 응답을 사용할 수 없어 브라우저 목업 데이터를 표시합니다.",
  };

  return `${fallbackMessages[meta.sourceStatus] || "TourAPI 응답을 사용할 수 없어 대전 fallback 장소 데이터로 표시합니다."} ${cacheText}.`;
}

/**
 * 입력: 추천 API 원본 항목.
 * 출력: 화면에서 사용하는 추천 항목.
 * 역할: 서버 응답 필드명이 조금 달라도 동일한 카드 구조로 보정한다.
 * 호출 예시: normalizeRecommendation(rawItem)
 */
function normalizeRecommendation(rawItem) {
  // 추천 관광지 또는 퀘스트 원본입니다.
  const item = rawItem || {};

  // 추천 항목의 퀘스트 객체입니다.
  const quest = item.quest || {};

  // 추천 항목의 장소 객체입니다.
  const place = item.place || {};

  // 추천 항목의 인스턴스 식별자입니다.
  const instanceId = String(
    item.instanceId || quest.instanceId || item.id || item.questInstanceId || item.userQuestInstanceId || "",
  );

  // 퀘스트에 1:1:1 로 연결된 보상 쌍입니다. (명세 §5.1)
  const rewardPair = item.rewardPair || quest.rewardPair || {};

  return {
    instanceId: instanceId || createClientId("recommendation"),
    questId: String(item.questId || quest.questId || quest.id || ""),
    placeName: item.placeName || item.title || place.name || place.title || quest.placeReference?.placeName || "추천 장소",
    // 주소 복사에 쓰는 도로명주소입니다. 없으면 사용 가능한 주소로 대체합니다. (명세 §10 S06)
    roadAddress: String(
      item.roadAddress || place.roadAddress || item.address || place.address || quest.roadAddress || "",
    ),
    placeLatitude: toNumber(item.latitude || place.latitude, getRecommendationLocation().lat),
    placeLongitude: toNumber(item.longitude || place.longitude, getRecommendationLocation().lng),
    // 관광지 상세 모달 조회에 쓰는 TourAPI 식별자입니다.
    placeContentId: String(item.placeContentId || place.contentId || item.contentId || ""),
    placeContentTypeId: String(item.placeContentTypeId || place.contentTypeId || item.contentTypeId || ""),
    category: normalizeCategory(
      item.category || item.categoryCode || quest.categoryCode || place.categoryCode || "all",
    ),
    // 난이도는 보상 단계가 아니라 예상 복잡도 메타데이터입니다. (명세 §4.2)
    difficulty: String(item.difficulty || quest.difficulty || "discover"),
    // 인증 5종 중 하나입니다. (명세 §4.3)
    questType: normalizeQuestType(item.questType || quest.questType || item.verificationType),
    distanceMeters: toNumber(item.distanceMeters || item.distance || place.distanceMeters, 0),
    estimatedMinutes: toNumber(item.estimatedMinutes || quest.estimatedMinutes, 0),
    questTitle: item.questTitle || quest.title || item.title || "방문 퀘스트",
    questDescription: item.questDescription || item.description || quest.description || "장소를 방문하고 수첩에 기록을 남깁니다.",
    rewardXp: toNumber(item.rewardXp || quest.rewardXp, 100),
    badgeName: rewardPair.badgeName || item.badgeName || item.badge?.name || "탐험 뱃지",
    rewardPair: {
      badgeName: rewardPair.badgeName || item.badgeName || item.badge?.name || "탐험 뱃지",
      badgeImageRef: String(rewardPair.badgeImageRef || ""),
      ggumdoriId: String(rewardPair.ggumdoriId || ""),
      ggumdoriName: String(rewardPair.ggumdoriName || ""),
      ggumdoriStillImageRef: String(rewardPair.ggumdoriStillImageRef || ""),
    },
    verificationType: item.verificationType || quest.verificationType || "GPS 방문",
    score: toNumber(item.score || item.recommendationScore, 0),
    status: item.status || quest.status || "recommended",
    startedAt: String(item.startedAt || quest.startedAt || ""),
    // 수행 가능 기간입니다. YYYY-MM-DD 형식이며 없으면 상시 수행으로 봅니다. (명세 §16.1)
    availableFrom: normalizeDateKey(item.availableFrom || quest.availableFrom),
    availableUntil: normalizeDateKey(item.availableUntil || quest.availableUntil),
    // 신뢰 가능한 운영시간입니다. 둘 다 있어야 지금 참여 가능을 판정합니다. (명세 §6.5)
    openTime: String(item.startTime || quest.startTime || ""),
    closeTime: String(item.endTime || quest.endTime || ""),
    // 공통 축제 퀘스트는 목록에서 카드 하나로만 보여 줍니다. (명세 §11.1, §10 S05)
    isCommonFestival: Boolean(item.isCommonFestival || quest.isCommonFestival),
    // 지금 참여할 수 있는 행사 타깃 수입니다. 보조 문구로 씁니다. (명세 §10 S05)
    festivalTargetCount: toNumber(item.festivalTargetCount || quest.festivalTargetCount, 0),
    // 실제 수행할 수 있는 행사 회차 목록입니다. (명세 §11.1, §16.2)
    festivalTargets: unwrapList(item.festivalTargets || quest.festivalTargets).map(normalizeFestivalTarget),
  };
}

/**
 * 입력: 날짜처럼 쓰일 수 있는 값.
 * 출력: YYYY-MM-DD 문자열 또는 "".
 * 역할: 서버가 준 날짜를 비교 가능한 한 가지 형식으로 맞춘다. (명세 §16.1)
 * 호출 예시: normalizeDateKey("2026-10-03T00:00:00+09:00")
 */
function normalizeDateKey(rawDate) {
  if (!rawDate) {
    return "";
  }

  // 이미 YYYY-MM-DD 형식이면 그대로 씁니다.
  const text = String(rawDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  // 그 밖의 표기는 Date로 해석한 뒤 KST 기준 날짜로 바꿉니다.
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : toKstDateKey(parsed);
}

/**
 * 입력: Date 객체.
 * 출력: KST 기준 YYYY-MM-DD 문자열.
 * 역할: 날짜 비교를 항상 한국 시간 기준으로 한다. (명세 §6.4)
 * 호출 예시: toKstDateKey(new Date())
 */
function toKstDateKey(date) {
  // KST 로 옮긴 시각입니다. UTC+9 를 더한 뒤 UTC 기준 날짜를 읽습니다.
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  return kst.toISOString().slice(0, 10);
}

/**
 * 입력: 없음.
 * 출력: 퀘스트 수행 가능 여부를 판단할 기준 날짜.
 * 역할: 계획 모드면 선택일을, 현위치 모드면 오늘을 기준으로 쓴다. (명세 §6.2, §6.3)
 * 호출 예시: const refDate = getQuestReferenceDate()
 */
function getQuestReferenceDate() {
  if (state.explorationMode === "planned" && state.plannedDate) {
    return state.plannedDate;
  }

  return toKstDateKey(new Date());
}

/**
 * 입력: 정규화된 추천 항목.
 * 출력: { code, label } 형태의 수행 가능 상태.
 * 역할: 추천 가능·진행 중·완료·선택일 수행 불가·행사 종료를 한 곳에서 판정한다. (명세 §10 S05)
 * 호출 예시: const availability = getQuestAvailability(quest)
 */
function getQuestAvailability(quest) {
  // 로컬 저장소까지 반영한 진행 상태입니다. 사용자의 진행이 기간 판정보다 앞섭니다.
  const questStatus = getQuestStatus(quest.instanceId, quest.status);

  if (questStatus === "completed" || questStatus === "done") {
    return { code: "completed", label: "완료" };
  }
  if (questStatus === "accepted" || questStatus === "in_progress") {
    return { code: "in_progress", label: "진행 중" };
  }

  // 오늘 날짜입니다. 행사가 아주 끝났는지 판단합니다.
  const todayKey = toKstDateKey(new Date());

  if (quest.availableUntil && quest.availableUntil < todayKey) {
    return { code: "event_ended", label: "행사 종료" };
  }

  // 계획 모드면 선택일, 아니면 오늘을 기준으로 봅니다.
  const referenceDate = getQuestReferenceDate();

  if (
    (quest.availableFrom && referenceDate < quest.availableFrom) ||
    (quest.availableUntil && referenceDate > quest.availableUntil)
  ) {
    return { code: "unavailable_on_date", label: "선택일 수행 불가" };
  }

  return { code: "recommended", label: "추천 가능" };
}

/**
 * 입력: 서버 또는 목업의 카테고리 코드.
 * 출력: v2 카테고리 8종 중 하나 또는 "all".
 * 역할: v1 카테고리 값을 v2 값으로 옮긴다. (명세 §4.1)
 * 호출 예시: normalizeCategory("downtown")
 */
function normalizeCategory(rawCategory) {
  // 소문자로 맞춘 카테고리 코드입니다.
  const category = String(rawCategory || "").toLowerCase();

  if (CATEGORY_LABELS[category]) {
    return category;
  }

  return LEGACY_CATEGORY_MAP[category] || "all";
}

/**
 * 입력: 화면 카테고리 코드.
 * 출력: 현재 서버 카테고리 코드 또는 null.
 * 역할: 지원하지 않는 새 분류를 전체 조회로 바꾸지 않고 명시적으로 막습니다.
 * 호출 예시: toServerCategory("heritage")
 */
function toServerCategory(category) {
  return SERVER_CATEGORY_MAP[String(category || "").toLowerCase()] || null;
}

/**
 * 입력: 없음.
 * 출력: 현재 탐색 모드의 추천 기준 위치.
 * 역할: 현위치와 계획 위치를 서로 덮어쓰지 않고 분리합니다.
 * 호출 예시: const location = getRecommendationLocation()
 */
function getRecommendationLocation() {
  // 변수 의미: 현재 탐색 모드가 가리키는 원본 위치 객체입니다.
  const location = state.explorationMode === "planned" ? state.plannedLocation : state.location;
  if (!location.measured) {
    return location;
  }
  // 실측 GPS 위치의 라벨은 정확도(m)가 끼워진 동적 문구라 UI_STRINGS_EN 사전(정확 일치)으로
  // 못 잡는다. normalizeMeasuredLocation()이 만들 때 고정해 둔 국문 라벨 대신, 조회 시점의
  // 화면 언어로 매번 새로 만들어 돌려준다.
  return {
    ...location,
    label: localize(
      `현재 위치 기준, 정확도 ${Math.round(toNumber(location.accuracyMeters, 0))}m`,
      `Current location, accuracy ${Math.round(toNumber(location.accuracyMeters, 0))}m`,
    ),
  };
}

/**
 * 입력: 없음.
 * 출력: recommendation API가 받는 모드 값.
 * 역할: 화면의 planned/current 값을 서버의 planning/nearby 계약으로 변환합니다.
 * 호출 예시: query.set("mode", getApiRecommendationMode())
 */
function getApiRecommendationMode() {
  return state.explorationMode === "planned" ? "planning" : "nearby";
}

/**
 * 입력: preference API 원본 응답.
 * 출력: 화면에서 사용하는 관심사 상태.
 * 역할: 기존 6개 서버 카테고리만 보존하고 설정 여부를 함께 정규화합니다.
 * 호출 예시: state.preference = normalizePreference(payload)
 */
function normalizePreference(payload) {
  const preference = payload?.preference || payload?.data?.preference || payload?.data || payload || {};
  const categories = Array.isArray(preference.categories)
    ? preference.categories.filter((category) => INTEREST_CATEGORIES.includes(category))
    : [];

  return {
    categories,
    categoriesSetAt: String(preference.categoriesSetAt || preference.categories_set_at || ""),
    isConfigured: Boolean(preference.isConfigured ?? preference.is_configured ?? categories.length > 0),
  };
}

/**
 * 입력: 요청 종류, 요청 번호, 시작 세션과 선택적 모드.
 * 출력: 응답이 아직 최신인지 여부.
 * 역할: 계정이나 탐색 모드가 바뀐 뒤 도착한 이전 응답을 무시합니다.
 * 호출 예시: if (!isCurrentRequest("user", id, session)) return
 */
function isCurrentRequest(kind, requestId, sessionVersion, mode = null) {
  if (state.requestVersions[kind] !== requestId || state.sessionVersion !== sessionVersion) {
    return false;
  }
  return mode === null || state.explorationMode === mode;
}

/**
 * 입력: 서버의 questType 또는 v1 verificationType 문구.
 * 출력: 인증 5종 키.
 * 역할: 인증 방식이 없거나 한국어 문구로만 온 데이터를 v2 키로 맞춘다. (명세 §4.3)
 * 호출 예시: normalizeQuestType("사진 인증")
 */
function normalizeQuestType(rawType) {
  // 소문자로 맞춘 인증 방식 값입니다.
  const questType = String(rawType || "").toLowerCase();

  if (QUEST_TYPE_LABELS[questType]) {
    return questType;
  }

  // v1 데이터는 인증 방식을 한국어 문구로만 갖고 있습니다.
  const text = String(rawType || "");
  if (text.includes("영수증") || text.includes("OCR")) {
    return "spend";
  }
  if (text.includes("사진")) {
    return "activity";
  }
  if (text.includes("이동") || text.includes("타슈")) {
    return "move";
  }
  if (text.includes("체크리스트") || text.includes("테마")) {
    return "theme";
  }

  return "visit";
}

/**
 * 입력: 뱃지 API 원본 항목.
 * 출력: 화면에서 사용하는 뱃지 항목.
 * 역할: 뱃지 진행도 필드를 표시 가능한 구조로 보정한다.
 * 호출 예시: normalizeBadge(rawBadge)
 */
function normalizeBadge(rawBadge) {
  // 뱃지 원본 응답입니다.
  const badge = rawBadge || {};

  return {
    name: badge.name || badge.badgeName || badge.definition?.name || "탐험 뱃지",
    category: badge.category || badge.categoryCode || badge.definition?.categoryCode || "all",
    tier: toNumber(badge.tier || badge.definition?.tier, 1),
    progressXp: toNumber(badge.progressXp || badge.xp, 0),
    requiredXp: toNumber(badge.requiredXp || badge.definition?.requiredXp, 300),
    earnedAt: badge.earnedAt || null,
    earned: Boolean(badge.earned ?? badge.earnedAt),
    imageRef: String(badge.imageRef || badge.image_ref || ""),
  };
}

/**
 * 입력: 수첩 API 원본 항목.
 * 출력: 화면에서 사용하는 수첩 항목.
 * 역할: 완료 기록과 수첩 기록을 동일한 타임라인 구조로 보정한다.
 * 호출 예시: normalizeNote(rawNote)
 */
function normalizeNote(rawNote) {
  // 수첩 원본 응답입니다.
  const note = rawNote || {};
  // 사용자가 작성한 일기 또는 리뷰 원본입니다.
  const entry = note.entry && typeof note.entry === "object" ? note.entry : {};
  // 리뷰일 때만 사용할 별점입니다.
  const rating = toNumber(entry.rating, 0);

  return {
    id: String(note.id || note.noteId || createClientId("note")),
    title: note.questTitle || note.title || "퀘스트 완료 기록",
    placeName: note.placeName || note.placeReference?.placeName || "대전 관광지",
    createdAt: note.createdAt || note.completedAt || new Date().toISOString(),
    earnedXp: toNumber(note.earnedXp, 0),
    badges: Array.isArray(note.badges) ? note.badges.map((badge) => badge.name || badge) : [],
    memo: note.memo || note.summary || "완료한 퀘스트가 수첩에 기록되었습니다.",
    photoRef: String(note.photoRef || note.objectKey || ""),
    entry: {
      type: entry.type === "review" ? "review" : "diary",
      title: String(entry.title || ""),
      body: String(entry.body || ""),
      rating: entry.type === "review" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
      updatedAt: entry.updatedAt || "",
    },
  };
}

/**
 * 입력: 꿈돌이 API 원본 항목.
 * 출력: 화면에서 사용하는 꿈돌이 항목.
 * 역할: 해금 상태와 조건을 도감 카드 구조로 보정한다.
 * 호출 예시: normalizeGgumdori(rawGgumdori)
 */
function normalizeGgumdori(rawGgumdori) {
  // 꿈돌이 원본 응답입니다.
  const ggumdori = rawGgumdori || {};

  return {
    id: String(ggumdori.id || ggumdori.variantId || createClientId("ggumdori")),
    name: ggumdori.name || ggumdori.variantName || "꿈돌이",
    themeCategory: ggumdori.themeCategory || ggumdori.category || "all",
    unlocked: Boolean(ggumdori.unlocked ?? ggumdori.earnedAt),
    tier: toNumber(ggumdori.tier, 1),
    unlockedAt: String(ggumdori.unlockedAt || ggumdori.unlocked_at || ""),
    condition: ggumdori.condition || ggumdori.unlockCondition || "뱃지 조건 달성",
    imageRef: ggumdori.imageRef || ggumdori.imageUrl || "",
  };
}

/**
 * 입력: 퀘스트 인스턴스 식별자와 기본 상태.
 * 출력: 현재 표시할 퀘스트 상태.
 * 역할: 서버 응답 상태보다 사용자의 로컬 상호작용을 우선 반영한다.
 * 호출 예시: getQuestStatus("mock-nature-001", "recommended")
 */
function getQuestStatus(instanceId, fallbackStatus) {
  return state.questStatuses[instanceId] || fallbackStatus || "recommended";
}

/**
 * 입력: 퀘스트 상태 문자열.
 * 출력: 한국어 상태 라벨.
 * 역할: 서버 상태 코드를 사용자가 읽을 수 있는 문구로 바꾼다.
 * 호출 예시: getQuestStatusLabel("accepted")
 */
function getQuestStatusLabel(status) {
  // 퀘스트 상태별 한국어 라벨입니다.
  const labels = {
    recommended: "추천 가능",
    accepted: "진행 중",
    in_progress: "진행 중",
    completed: "완료",
    done: "완료",
  };

  return labels[status] || "추천 가능";
}

/**
 * 입력: 퀘스트 상태 문자열.
 * 출력: 상태 태그 CSS 클래스.
 * 역할: 상태별 색상 표현을 통일한다.
 * 호출 예시: getQuestStatusClass("completed")
 */
function getQuestStatusClass(status) {
  if (status === "completed" || status === "done") {
    return "status-badge status-badge--done";
  }

  if (status === "accepted" || status === "in_progress") {
    return "status-badge status-badge--active";
  }

  if (status === "review" || status === "in_review") {
    return "status-badge status-badge--locked";
  }

  return "status-badge status-badge--available";
}

/**
 * 입력: 없음.
 * 출력: NAVER Maps SDK 사용 가능 여부.
 * 역할: 동적으로 로드한 SDK가 지도 네임스페이스를 제공하는지 확인한다.
 * 호출 예시: if (hasNaverMaps()) syncNaverMapMarkers()
 */
function hasNaverMaps() {
  return Boolean(window.naver && window.naver.maps);
}

/**
 * 입력: NAVER Maps 설정 응답.
 * 출력: 정규화된 지도 설정 객체.
 * 역할: 기존 정적 서버와 baseline 앱 API의 서로 다른 필드명을 같은 구조로 맞춘다.
 * 호출 예시: state.naverMapConfig = normalizeNaverMapConfig(payload)
 */
function normalizeNaverMapConfig(payload) {
  // 설정 응답 원본입니다.
  const config = payload || {};
  // Dynamic Map Key ID입니다.
  const keyId = String(config.keyId || config.clientId || config.naverMapClientId || "");
  // Dynamic Map 사용 가능 여부입니다.
  const dynamicMapConfigured = Boolean(config.dynamicMapConfigured ?? config.configured ?? keyId);
  // REST 프록시 사용 가능 여부입니다.
  const restApiConfigured = Boolean(config.restApiConfigured ?? config.restProxyEnabled ?? config.restProxyConfigured);

  return { keyId, dynamicMapConfigured, restApiConfigured };
}

/**
 * 입력: NAVER Maps API Key ID.
 * 출력: SDK 로딩 Promise.
 * 역할: 브라우저에서 NAVER Dynamic Map SDK를 한 번만 동적으로 불러온다.
 * 호출 예시: await loadNaverMapsSdk(keyId)
 */
function loadNaverMapsSdk(keyId) {
  if (hasNaverMaps()) {
    state.naverMapLoadState = "ready";
    return Promise.resolve();
  }

  if (state.naverMapSdkPromise) {
    return state.naverMapSdkPromise;
  }

  state.naverMapLoadState = "loading";
  state.naverMapSdkPromise = new Promise((resolve, reject) => {
    // 이미 삽입된 NAVER SDK 스크립트입니다.
    const existingScript = document.querySelector("script[data-naver-maps-sdk]");
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (hasNaverMaps()) {
          resolve();
        } else {
          reject(new Error("NAVER Maps SDK namespace is missing."));
        }
      });
      existingScript.addEventListener("error", () => reject(new Error("NAVER Maps SDK loading failed.")));
      return;
    }

    // 새로 삽입할 NAVER SDK 스크립트입니다.
    const script = document.createElement("script");
    // 변수 의미: 지도 도로명/POI 라벨 언어입니다. SDK 로딩 시점에 고정되므로 이후 언어를
    // 바꾸면 다음 새로고침부터 반영됩니다.
    const mapLanguage = state.uiLanguage === "eng" ? "en" : "ko";
    script.src = `${NAVER_MAPS_SDK_URL}?ncpKeyId=${encodeURIComponent(keyId)}&language=${mapLanguage}`;
    script.async = true;
    script.dataset.naverMapsSdk = "true";
    script.onload = () => {
      if (hasNaverMaps()) {
        state.naverMapLoadState = "ready";
        resolve();
        return;
      }
      state.naverMapLoadState = "failed";
      reject(new Error("NAVER Maps SDK namespace is missing."));
    };
    script.onerror = () => {
      state.naverMapLoadState = "failed";
      state.naverMapSdkPromise = null;
      reject(new Error("NAVER Maps SDK loading failed."));
    };
    document.head.append(script);
  });

  return state.naverMapSdkPromise;
}

/**
 * 입력: 추천 항목.
 * 출력: NAVER Maps 좌표 객체.
 * 역할: 추천 장소를 NAVER 지도 마커 좌표로 변환한다.
 * 호출 예시: const position = toNaverLatLng(recommendation)
 */
function toNaverLatLng(recommendation) {
  return new window.naver.maps.LatLng(recommendation.placeLatitude, recommendation.placeLongitude);
}

/**
 * 입력: 추천 항목과 선택 여부.
 * 출력: NAVER Maps HTML 마커 아이콘.
 * 역할: 기존 목업 지도와 같은 배지형 마커를 실제 NAVER 지도 위에 올린다.
 * 호출 예시: const icon = buildNaverPlaceMarkerIcon(place, true)
 */
function buildNaverPlaceMarkerIcon(place, isSelected) {
  // 선택 상태 클래스입니다.
  const selectedClass = isSelected ? " is-selected" : "";
  // HTML 마커에 넣을 안전한 장소명입니다.
  const safePlaceName = escapeHtml(place.placeName);
  // NAVER Maps가 렌더링할 HTML 마커입니다.
  const content = `
    <button class="naver-marker${selectedClass}" type="button" aria-label="${safePlaceName}">
      <span class="map-badge">${getCategoryIcon(place.category)}</span>
      <span class="naver-marker-label">${safePlaceName}</span>
    </button>
  `;

  return {
    content,
    anchor: new window.naver.maps.Point(24, 58),
  };
}

/**
 * 입력: 없음.
 * 출력: NAVER Maps 현재 위치 마커 아이콘.
 * 역할: 지도 위에 사용자 기준 위치를 별도 점으로 표시한다.
 * 호출 예시: marker.setIcon(buildNaverPositionMarkerIcon())
 */
function buildNaverPositionMarkerIcon() {
  return {
    content: '<div class="naver-position-marker" aria-label="현재 위치"><span></span></div>',
    anchor: new window.naver.maps.Point(13, 13),
  };
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 서비스워커를 등록해 PWA 캐시를 활성화한다.
 * 호출 예시: registerServiceWorker()
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker
    .register("./service-worker.js?v=20260910-2", { updateViaCache: "none" })
    .then((registration) => {
      // 이미 대기 중인 새 버전이 있으면 바로 알립니다.
      if (registration.waiting) {
        showUpdateNotice(registration.waiting);
      }

      // 새 버전을 발견하면 설치가 끝난 뒤 알립니다. (명세 §14.1)
      registration.addEventListener("updatefound", () => {
        // 지금 설치되고 있는 서비스워커입니다.
        const installing = registration.installing;
        if (!installing) {
          return;
        }
        installing.addEventListener("statechange", () => {
          // 기존 워커가 있는 상태에서 설치가 끝나면 새 버전이 대기 중입니다.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateNotice(installing);
          }
        });
      });

      registration.update();
    })
    .catch(() => {
      updateSystemStatus(false, "서비스워커 등록 실패");
    });

  // 새 워커가 제어를 넘겨받으면 화면을 한 번 새로 불러옵니다.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloading) {
      return;
    }
    swReloading = true;
    window.location.reload();
  });
}

/**
 * 입력: 대기 중인 서비스워커.
 * 출력: 없음.
 * 역할: 새 버전이 준비됐음을 알리고 사용자가 수락하면 적용한다. (명세 §14.1)
 * 호출 예시: showUpdateNotice(registration.waiting)
 */
function showUpdateNotice(waitingWorker) {
  // 안내 막대입니다. 이미 떠 있으면 다시 만들지 않습니다.
  if (select("#update-notice")) {
    return;
  }

  const bar = createElement("div", "update-notice");
  bar.id = "update-notice";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.append(createElement("span", "", "새 버전이 준비됐어요."));

  const applyButton = createElement("button", "px-button px-button--primary", "새로고침");
  applyButton.type = "button";
  applyButton.addEventListener("click", () => {
    // 대기 중인 워커에게 즉시 활성화를 요청합니다. controllerchange 가 새로고침을 맡습니다.
    waitingWorker.postMessage("SKIP_WAITING");
  });

  const laterButton = createElement("button", "px-button px-button--ghost", "나중에");
  laterButton.type = "button";
  laterButton.addEventListener("click", () => bar.remove());

  bar.append(applyButton, laterButton);
  document.body.append(bar);
}

/**
 * 입력: 정상 연결 여부와 선택 문구.
 * 출력: 없음.
 * 역할: 상단 API 연결 상태를 갱신한다.
 * 호출 예시: updateSystemStatus(true, "API 연결됨")
 */
function updateSystemStatus(isHealthy, message = "") {
  // 연결 상태를 표시하는 요소입니다.
  const statusElement = select("#system-status");

  if (!statusElement) {
    return;
  }

  statusElement.replaceChildren();

  // 상태 점 표시 요소입니다.
  const dotElement = createElement("span", `status-dot ${isHealthy ? "status-dot--ok" : "status-dot--fallback"}`);
  dotElement.setAttribute("aria-hidden", "true");

  // 상태 문구 표시 요소입니다.
  const textElement = createElement("span", "", message || (isHealthy ? "API 연결됨" : "목업 모드"));

  statusElement.append(dotElement, textElement);
}

/**
 * 입력: 없음.
 * 출력: 현재 선택된 꿈돌이 항목 또는 첫 해금 항목.
 * 역할: 홈 상단에서 대표 꿈돌이를 안정적으로 표시한다.
 * 호출 예시: const selected = getSelectedGgumdori()
 */
function getSelectedGgumdori() {
  // 저장된 선택 ID와 일치하는 꿈돌이입니다.
  const selected = state.ggumdori.find((item) => item.id === state.selectedGgumdoriId);

  if (selected) {
    return selected;
  }

  return state.ggumdori.find((item) => item.unlocked) || state.ggumdori[0] || null;
}

/**
 * 입력: 꿈돌이 항목과 작은 화면 여부.
 * 출력: 꿈돌이 표시 HTMLElement.
 * 역할: 선택된 꿈돌이 이미지 또는 대체 문자를 카드 안에 표시한다.
 * 호출 예시: createGgumdoriFigure(selectedGgumdori)
 */
function createGgumdoriFigure(item, isSmall = false) {
  // 꿈돌이를 감싸는 표시 요소입니다.
  const figure = createElement("div", "ggumdori-figure");
  if (!isSmall) {
    figure.classList.add("avatar-mark");
  }

  if (item?.imageRef) {
    // 꿈돌이 SVG 이미지를 표시하는 요소입니다.
    const image = document.createElement("img");
    image.src = item.imageRef;
    image.alt = item.unlocked ? item.name : `${item.name} 잠김`;
    image.loading = "lazy";
    figure.append(image);
  } else {
    figure.textContent = item?.unlocked ? item.name.slice(0, 1) : "?";
  }

  return figure;
}

/**
 * 입력: 없음.
 * 출력: 획득한 뱃지 목록.
 * 역할: 홈의 최근 뱃지와 뱃지 히어로에 쓸 데이터를 추린다.
 * 호출 예시: const earnedBadges = getEarnedBadges()
 */
function getEarnedBadges() {
  return state.badges.filter((badge) => badge.earnedAt);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 현재 화면에 맞는 헤더 제목과 레벨 표시를 갱신한다.
 * 호출 예시: renderAppHeader()
 */
function renderAppHeader() {
  // 현재 화면의 메타데이터입니다.
  const meta = VIEW_META[state.activeView] || VIEW_META.home;

  // 뒤로가기 버튼입니다. 돌아갈 화면이 있을 때만 보여줍니다.
  const backButton = select("#app-back-button");
  if (backButton) {
    backButton.hidden = state.viewHistory.length === 0;
  }

  // 헤더 아이콘 요소입니다.
  const iconElement = select("[data-app-icon]");
  // 헤더 상단 라벨 요소입니다.
  const eyebrowElement = select("[data-app-eyebrow]");
  // 헤더 제목 요소입니다.
  const titleElement = select("[data-app-title]");
  // 사용자 레벨 표시 요소입니다.
  const levelElement = select("#header-level");

  if (iconElement) {
    iconElement.classList.add("px-icon");
    iconElement.textContent = meta.icon;
  }
  if (eyebrowElement) {
    eyebrowElement.textContent = meta.eyebrow;
  }
  if (titleElement) {
    titleElement.textContent = meta.title;
  }
  if (levelElement) {
    levelElement.textContent = `Lv.${toNumber(state.user.level, 1)}`;
  }

  document.body.dataset.activeView = state.activeView;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 우측 드로어의 다섯 최상위 메뉴를 렌더링하고 현재 화면을 강조한다.
 * 호출 예시: renderDrawerNavigation()
 */
function renderDrawerNavigation() {
  // 드로어 메뉴 컨테이너입니다.
  const navigation = select("#drawer-nav");

  if (!navigation) {
    return;
  }

  navigation.replaceChildren();

  NAVIGATION_ITEMS.forEach((viewId, index) => {
    // 메뉴 하나의 메타데이터입니다.
    const meta = VIEW_META[viewId];
    // 현재 메뉴가 활성 상태인지 여부입니다.
    const isActive = state.activeView === viewId;
    // 카트리지형 메뉴 버튼입니다.
    const button = createElement("button", `nav-link${isActive ? " is-active" : ""}`.trim());
    button.type = "button";
    button.dataset.viewTarget = viewId;
    // 현재 메뉴는 aria-current 와 시각 표시를 함께 제공합니다. (명세 §7.2)
    if (isActive) {
      button.setAttribute("aria-current", "page");
    }

    // 메뉴를 구분하는 사각 아이콘입니다.
    const icon = createElement("span", "px-icon-box");
    icon.style.setProperty("--cat-color", meta.accent);
    icon.append(createElement("span", "px-icon px-icon--sm", meta.icon));

    // 메뉴 이름과 설명을 담는 영역입니다.
    const text = createElement("div", "nav-link__text");
    // 활성 메뉴는 색 외에 텍스트로도 현재 위치를 알립니다.
    const label = createElement("span", "nav-link__label", meta.label);
    if (isActive) {
      label.append(createElement("span", "px-sr-only", " (현재 화면)"));
    }
    text.append(label, createElement("span", "nav-link__desc", meta.description));

    button.append(icon, text, createElement("span", "nav-link__index px-counter", String(index + 1)));
    navigation.append(button);
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 드로어 상단의 사용자 요약을 채운다.
 * 호출 예시: renderDrawerProfile()
 */
function renderDrawerProfile() {
  // 드로어와 마이페이지가 같은 형태의 계정 요약을 공유합니다.
  const targets = [select("#drawer-profile"), select("#me-account-panel")].filter(Boolean);

  if (targets.length === 0) {
    return;
  }

  // 홈 대표로 지정한 꿈돌이입니다.
  const selected = getSelectedGgumdori();

  targets.forEach((target) => {
    target.replaceChildren();

    // 대표 꿈돌이 썸네일입니다.
    const art = createElement("div", "drawer-profile__art");
    if (selected?.imageRef) {
      const image = document.createElement("img");
      image.src = selected.imageRef;
      image.alt = `${selected.name} 대표 꿈돌이`;
      art.append(image);
    }

    // 닉네임과 레벨을 담는 영역입니다.
    const meta = createElement("div", "drawer-profile__meta");
    const nameRow = createElement("div", "context-row");
    nameRow.append(
      createElement("span", "nav-link__label", displayNickname(state.user.nickname) || localize("모험가", "Adventurer")),
      createElement("span", "level-pill px-counter", `Lv.${toNumber(state.user.level, 1)}`),
    );
    meta.append(nameRow, createElement("span", "nav-link__desc", state.user.title || "대전 탐험가"));

    target.append(art, meta);
  });
}

/**
 * 입력: 없음.
 * 출력: 드로어가 열려 있는지 여부.
 * 역할: 뒤로가기·Esc 처리에서 드로어 상태를 한 곳에서 판단한다.
 * 호출 예시: if (isDrawerOpen()) closeDrawer()
 */
function isDrawerOpen() {
  return Boolean(select("#app-drawer")?.classList.contains("is-open"));
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 우측 책갈피 드로어를 열고 포커스를 드로어 안에 가둔다. (명세 §7.2)
 * 호출 예시: openDrawer()
 */
function openDrawer() {
  // 드로어 패널입니다.
  const drawer = select("#app-drawer");
  // 배경을 덮는 딤 레이어입니다.
  const scrim = select("#drawer-scrim");
  // 드로어를 연 책갈피 손잡이입니다.
  const handle = select("#bookmark-handle");

  if (!drawer || drawer.classList.contains("is-open")) {
    return;
  }

  // 닫을 때 포커스를 되돌릴 요소를 기억합니다.
  state.drawerReturnFocus = document.activeElement;
  state.drawerClosing = false;

  drawer.hidden = false;
  if (scrim) {
    scrim.hidden = false;
  }
  handle?.setAttribute("aria-expanded", "true");
  // hidden 을 푼 직후 레이아웃을 한 번 읽어야 슬라이드가 시작 위치부터 보입니다.
  // requestAnimationFrame 은 탭이 백그라운드일 때 멈추므로 쓰지 않습니다.
  void drawer.offsetWidth;
  drawer.classList.add("is-open");

  document.body.dataset.drawerOpen = "true";
  select("#drawer-close")?.focus({ preventScroll: true });

  // 브라우저 뒤로가기로도 닫히도록 히스토리 항목을 하나 쌓습니다. (명세 §7.2)
  window.history.pushState({ drawerOpen: true }, "", `#view-${state.activeView}`);
}

/**
 * 입력: 히스토리 이동으로 닫히는지 여부.
 * 출력: 없음.
 * 역할: 드로어를 닫고 포커스를 열기 전 요소로 되돌린다.
 * 호출 예시: closeDrawer()
 */
function closeDrawer(fromHistory = false) {
  // 드로어 패널입니다.
  const drawer = select("#app-drawer");
  // 배경을 덮는 딤 레이어입니다.
  const scrim = select("#drawer-scrim");
  // 책갈피 손잡이입니다.
  const handle = select("#bookmark-handle");

  // 이미 닫혀 있으면 아무것도 하지 않습니다.
  // 이 검사를 history.back() 보다 먼저 해야 중복 호출이 앱 밖으로 나가지 않습니다.
  if (!drawer || !drawer.classList.contains("is-open")) {
    return;
  }

  // 뒤로가기가 아닌 경로로 닫을 때는 쌓아 둔 히스토리 항목을 먼저 되감습니다.
  // popstate 가 다시 이 함수를 fromHistory 로 호출해 실제 닫기를 수행합니다.
  if (!fromHistory && window.history.state?.drawerOpen) {
    // history.back() 은 비동기라 popstate 전에 다시 불릴 수 있습니다.
    // 표시를 남겨 두 번 되감아 앱 밖으로 나가는 일을 막습니다.
    if (state.drawerClosing) {
      return;
    }
    state.drawerClosing = true;
    window.history.back();
    return;
  }

  state.drawerClosing = false;

  drawer.classList.remove("is-open");
  if (scrim) {
    scrim.hidden = true;
  }
  handle?.setAttribute("aria-expanded", "false");
  delete document.body.dataset.drawerOpen;

  // 슬라이드가 끝난 뒤에 hidden 을 돌려놓아 보조기기에서 감춥니다.
  window.setTimeout(() => {
    if (!drawer.classList.contains("is-open")) {
      drawer.hidden = true;
    }
  }, 200);

  // 포커스는 드로어를 열었던 요소로 되돌립니다.
  const target =
    state.drawerReturnFocus instanceof HTMLElement && state.drawerReturnFocus.isConnected
      ? state.drawerReturnFocus
      : handle;
  target?.focus({ preventScroll: true });
  state.drawerReturnFocus = null;
}

/**
 * 입력: Tab 키 이벤트.
 * 출력: 없음.
 * 역할: 드로어가 열린 동안 포커스가 드로어 밖으로 나가지 않게 한다. (명세 §7.2)
 * 호출 예시: trapDrawerFocus(event)
 */
function trapDrawerFocus(event) {
  // 드로어 패널입니다.
  const drawer = select("#app-drawer");

  if (!drawer || !drawer.classList.contains("is-open")) {
    return;
  }

  // 드로어 안에서 포커스를 받을 수 있는 요소들입니다.
  const focusable = Array.from(
    drawer.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
  ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);

  if (focusable.length === 0) {
    return;
  }

  // 순환의 양 끝 요소입니다.
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

/**
 * 입력: 없음.
 * 출력: 모션을 줄여야 하면 true.
 * 역할: OS 설정과 앱 설정 중 하나라도 켜지면 전환 연출을 생략한다. (명세 §7.3)
 * 호출 예시: if (prefersReducedMotion()) { ... }
 */
function prefersReducedMotion() {
  return (
    state.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 입력: 전환할 화면 ID, URL 해시 갱신 여부, 뒤로가기 버튼이 호출한 것인지 여부.
 * 출력: 없음.
 * 역할: 단일 PWA 안에서 다섯 최상위 메뉴를 책장 넘김으로 전환한다. (명세 §7.3)
 *       뒤로가기가 아닌 일반 이동일 때만 이전 화면을 뒤로가기 스택에 쌓는다.
 * 호출 예시: setActiveView("quests")
 */
function setActiveView(viewId, shouldUpdateHash = true, isBackNavigation = false) {
  if (!VIEW_META[viewId]) {
    return;
  }

  // 같은 화면을 다시 고른 경우인지 여부입니다. 연출을 반복하지 않습니다.
  const isSameView = state.activeView === viewId;

  // 초기 로드·로그아웃 복원(shouldUpdateHash=false)과 뒤로가기 자체는 스택에 쌓지 않습니다.
  // 그 외의 명시적 화면 이동만 "돌아갈 곳"으로 기록합니다.
  if (!isSameView && shouldUpdateHash && !isBackNavigation && VIEW_META[state.activeView]) {
    state.viewHistory.push(state.activeView);
  }

  state.activeView = viewId;

  // 모든 화면 패널입니다.
  const panels = document.querySelectorAll("[data-view-panel]");
  panels.forEach((panel) => {
    // 현재 패널이 활성 화면인지 여부입니다.
    const isActive = panel.dataset.viewPanel === viewId;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
    panel.classList.remove("is-turning");
  });

  // 활성 패널입니다. 책장 넘김과 포커스 이동의 대상입니다.
  const activePanel = select(`[data-view-panel="${viewId}"]`);

  // 메뉴 이동에만 짧은 종이 전환을 씁니다. 모션 줄이기에서는 즉시 전환합니다.
  if (activePanel && !isSameView && !prefersReducedMotion()) {
    activePanel.classList.add("is-turning");
    activePanel.addEventListener(
      "animationend",
      () => activePanel.classList.remove("is-turning"),
      { once: true },
    );
  }

  renderAppHeader();
  renderDrawerNavigation();

  if (shouldUpdateHash) {
    window.history.replaceState(null, "", `#view-${viewId}`);
  }

  // 모바일 화면 전환 시 스크롤을 상단으로 돌린다.
  const main = select("#main-content");
  if (main) {
    main.scrollTop = 0;
  }
  window.scrollTo({ top: 0 });

  // 새 화면 도착 후 화면 제목으로 포커스를 옮깁니다. (명세 §7.3)
  if (!isSameView) {
    // 화면 제목 요소입니다. 시각적으로 감춘 제목도 포커스 대상이 됩니다.
    const heading = activePanel?.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 뒤로가기 스택에서 바로 이전 화면을 꺼내 그 화면으로 돌아간다.
 * 호출 예시: goToPreviousView()
 */
function goToPreviousView() {
  // 스택에서 꺼낸 이전 화면입니다. 없으면 아무 것도 하지 않습니다.
  const previousView = state.viewHistory.pop();
  if (!previousView) {
    return;
  }
  setActiveView(previousView, true, true);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 프로필, 레벨, 요약 통계를 홈 화면에 표시한다.
 * 호출 예시: renderProfile()
 */
function renderProfile() {
  // 프로필 카드 컨테이너입니다.
  const panel = select("#profile-panel");

  if (!panel) {
    return;
  }

  // 사용자의 다음 레벨까지 진행률입니다.
  const progressPercent = getProgressPercent(state.user.xp, state.user.nextLevelXp);

  // 홈에 표시할 선택 꿈돌이입니다.
  const selectedGgumdori = getSelectedGgumdori();

  panel.replaceChildren();

  // 프로필 상단 영역입니다.
  const main = createElement("div", "profile-main");
  const avatar = createGgumdoriFigure(selectedGgumdori);
  const profileText = createElement("div");
  const name = createElement("p", "profile-name", displayNickname(state.user.nickname) || displayNickname(FALLBACK_USER.nickname));
  const meta = createElement(
    "p",
    "profile-meta",
    `Lv.${toNumber(state.user.level, 1)} · ${toNumber(state.user.xp).toLocaleString("ko-KR")} XP`,
  );
  // 변수 의미: 대표로 선택된 꿈돌이 이름입니다(고정된 이름 집합이라 UI_STRINGS_EN에도 등록돼 있음).
  const selectedGgumdoriName = selectedGgumdori?.name || state.user.selectedGgumdoriName || "기본 꿈돌이";
  const selectedName = createElement(
    "span",
    "selected-ggumdori-name",
    localize(
      `${selectedGgumdoriName} 선택 중`,
      `${UI_STRINGS_EN[selectedGgumdoriName] || selectedGgumdoriName} selected`,
    ),
  );
  const customizeLink = createElement("button", "profile-customize-link", "도감에서 대표 바꾸기 →");
  customizeLink.type = "button";
  customizeLink.dataset.viewTarget = "collection";

  profileText.append(name, meta, selectedName, customizeLink);
  main.append(avatar, profileText);

  // 레벨 진행률 설명입니다.
  const progressCaption = createElement("div", "progress-caption");
  progressCaption.append(
    createElement(
      "span",
      "",
      localize(`Lv.${toNumber(state.user.level, 1) + 1}까지`, `Until Lv.${toNumber(state.user.level, 1) + 1}`),
    ),
    createElement("span", "", `${Math.round(progressPercent)}%`),
  );

  // 레벨 진행 막대입니다.
  const progressTrack = createElement("div", "progress-bar");
  // 보조기술이 진행률을 읽을 수 있게 실제 의미와 값을 줍니다. (명세 §13.3-10)
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", "100");
  progressTrack.setAttribute("aria-valuenow", String(Math.round(progressPercent)));
  progressTrack.setAttribute(
    "aria-label",
    `다음 레벨까지 ${Math.round(progressPercent)}퍼센트`,
  );
  const progressFill = createElement("span", "progress-fill");
  progressFill.style.width = `${progressPercent}%`;
  progressTrack.append(progressFill);

  // 사용자 활동 통계 행입니다.
  const statRow = createElement("div", "stat-row");
  [
    ["XP", `${toNumber(state.user.xp).toLocaleString("ko-KR")}`],
    ["완료", localize(`${toNumber(state.user.completedQuestCount)}개`, `${toNumber(state.user.completedQuestCount)}`)],
    ["뱃지", localize(`${toNumber(state.user.badgeCount)}개`, `${toNumber(state.user.badgeCount)}`)],
  ].forEach(([label, value]) => {
    // 통계 한 칸을 표시하는 요소입니다.
    const statItem = createElement("div", "stat-item");
    statItem.append(createElement("span", "stat-value", value), createElement("span", "stat-label", label));
    statRow.append(statItem);
  });

  panel.append(main, progressCaption, progressTrack, statRow);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 화면의 주요 지표 네 칸을 렌더링한다.
 * 호출 예시: renderHomeMetrics()
 */
function renderHomeMetrics() {
  // 홈 지표 그리드입니다.
  const grid = select("#home-metric-grid");

  if (!grid) {
    return;
  }

  // 획득한 뱃지 목록입니다.
  const earnedBadges = getEarnedBadges();

  // 표시할 지표 목록입니다.
  const metrics = [
    ["📍", getRecommendationLocation().label.replace(" 기준", ""), state.explorationMode === "planned" ? "계획 위치" : "현재 위치 후보"],
    ["🏷️", localize(`${earnedBadges.length}개`, `${earnedBadges.length}`), "획득 뱃지"],
    ["🗺️", localize(`${state.recommendations.length}개`, `${state.recommendations.length}`), "주변 퀘스트"],
    ["🎁", getRecommendationDataLabel(), "추천 데이터"],
  ];

  grid.replaceChildren();
  metrics.forEach(([icon, value, label]) => {
    // 지표 카드 요소입니다.
    const card = createElement("article", "metric-card");
    card.append(createElement("span", "metric-icon", icon), createElement("strong", "", value), createElement("span", "", label));
    grid.append(card);
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 화면에 최근 획득 뱃지를 작은 스탬프 카드로 표시한다.
 * 호출 예시: renderRecentBadges()
 */
function renderRecentBadges() {
  // 최근 뱃지 목록 컨테이너입니다.
  const list = select("#recent-badge-list");

  if (!list) {
    return;
  }

  // 최근 획득 뱃지 목록입니다.
  const recentBadges = getEarnedBadges().slice(0, 3);

  list.replaceChildren();

  if (recentBadges.length === 0) {
    list.append(createElement("p", "empty-message", "아직 획득한 뱃지가 없습니다."));
    return;
  }

  recentBadges.forEach((badge) => {
    // 최근 뱃지 카드입니다.
    const card = createElement("article", "recent-badge-card");
    card.append(
      createElement("span", "badge-symbol", getCategoryIcon(badge.category)),
      createElement("strong", "", badge.name),
      createElement("span", "", `Lv.${badge.tier}`),
    );
    list.append(card);
  });
}

/**
 * 입력: 카테고리 코드.
 * 출력: 카테고리에 맞는 표시 아이콘.
 * 역할: 뱃지와 지도 마커를 기존 정적 MVP와 비슷한 스탬프 느낌으로 표시한다.
 * 호출 예시: const icon = getCategoryIcon("science")
 */
function getCategoryIcon(category) {
  // 카테고리별 아이콘입니다.
  const icons = {
    all: "✦",
    nature: "🌿",
    science: "🔭",
    downtown: "🏙️",
    market: "🥐",
    mobility: "🚲",
    nightview: "🌉",
  };

  return icons[category] || "✦";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 화면 하단의 오늘 추천 카드 목록을 렌더링한다.
 * 호출 예시: renderHomeRecommendations()
 */
function renderHomeRecommendations() {
  // 홈 추천 목록 컨테이너입니다.
  const list = select("#home-recommendation-list");

  if (!list) {
    return;
  }

  list.replaceChildren();
  state.recommendations.slice(0, 2).forEach((recommendation) => {
    list.append(createRecommendationCard(recommendation));
  });

  if (state.recommendations.length === 0) {
    list.append(createElement("p", "empty-message", "표시할 추천 퀘스트가 없습니다."));
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 추천 데이터 출처와 지도 설정 상태를 표시한다.
 * 호출 예시: renderRecommendationMeta()
 */
function renderRecommendationMeta() {
  // 지도 요약 문구 요소입니다.
  const mapCopy = select("#map-copy");

  if (mapCopy) {
    const mapStatus = state.naverMapConfigured ? "NAVER Dynamic Map 연결 준비" : "목업 지도 표시";
    mapCopy.textContent = `${getRecommendationLocation().label} · ${getRecommendationLocation().lat.toFixed(4)}, ${getRecommendationLocation().lng.toFixed(4)} · ${mapStatus}`;
  }

  // 지도 제공자 상태 요소입니다.
  const mapProviderStatus = select("#map-provider-status");

  if (mapProviderStatus) {
    if (state.naverMapLoadState === "ready") {
      mapProviderStatus.textContent = state.naverMapConfig.restApiConfigured ? "NAVER 지도" : "지도만 연결";
      mapProviderStatus.classList.add("is-ready");
      mapProviderStatus.classList.remove("is-error");
    } else {
      mapProviderStatus.textContent = state.naverMapConfigured ? "NAVER 로딩" : "목업 지도";
      mapProviderStatus.classList.toggle("is-ready", state.naverMapConfigured);
      mapProviderStatus.classList.toggle("is-error", !state.naverMapConfigured);
    }
  }

  // 홈 데이터 출처 안내 요소입니다.
  const homeDataNote = select("#home-data-note");

  if (homeDataNote) {
    homeDataNote.textContent = getTourApiStatusText();
  }
}

/**
 * 입력: 추천 항목.
 * 출력: Object Storage 업로드 목적.
 * 역할: 퀘스트 인증 방식에 맞춰 영수증 또는 일반 사진 업로드 경로를 고른다.
 * 호출 예시: const purpose = getEvidencePurpose(recommendation)
 */
function getEvidencePurpose(recommendation) {
  // 퀘스트 인증 방식 표시 문자열입니다.
  const verificationType = String(recommendation?.verificationType || "").toLowerCase();
  if (verificationType.includes("receipt") || verificationType.includes("영수증") || recommendation?.category === "market") {
    return "quest_receipt";
  }
  return "quest_photo";
}

/**
 * 입력: 업로드 목적.
 * 출력: 사용자에게 보여줄 증빙 이름.
 * 역할: 카드 안 사진 제출 컨트롤의 문구를 정한다.
 * 호출 예시: const label = getEvidenceLabel("quest_receipt")
 */
function getEvidenceLabel(purpose) {
  return purpose === "quest_receipt" ? "영수증 사진" : "인증 사진";
}

/**
 * 입력: OCR 요구사항 대조 결과.
 * 출력: 카드에 표시할 OCR 요약 문구.
 * 역할: 영수증 상호명, 품목, 시간 대조 결과를 짧게 보여준다.
 * 호출 예시: const text = getReceiptRequirementText(check)
 */
function getReceiptRequirementText(requirementCheck) {
  if (!requirementCheck) {
    return "";
  }

  if (requirementCheck.passed) {
    return "OCR 확인: 상호명·품목·시간 일치";
  }

  // 변수 의미: 누락된 구매 품목 목록입니다.
  const missingItems = requirementCheck.missingItems || [];
  if (missingItems.length > 0) {
    return `OCR 확인: 누락 품목 ${missingItems.join(", ")}`;
  }

  return "OCR 확인: 일부 요구사항 불일치";
}

/**
 * 입력: 증빙 업로드 상태.
 * 출력: 카드에 표시할 상태 문구.
 * 역할: 업로드, OCR, 실패 상태를 한 줄로 정리한다.
 * 호출 예시: const text = getEvidenceStatusText(evidence)
 */
function getEvidenceStatusText(evidence) {
  if (!evidence) {
    return "사진을 제출하면 완료 요청에 함께 첨부됩니다.";
  }
  if (evidence.status === "uploading") {
    return "사진 업로드 중";
  }
  if (evidence.status === "failed") {
    return evidence.message || "사진 업로드 실패";
  }
  if (evidence.ocrStatus === "running") {
    return "업로드 완료, OCR 확인 중";
  }
  if (evidence.ocrStatus === "failed") {
    return "업로드 완료, OCR 확인은 실패했습니다.";
  }
  if (evidence.ocrStatus === "done") {
    return getReceiptRequirementText(evidence.requirementCheck) || "업로드 완료";
  }
  return `${evidence.fileName || "사진"} 업로드 완료`;
}

/**
 * 입력: 추천 항목, 액션 진행 여부.
 * 출력: 증빙 업로드 패널 HTMLElement.
 * 역할: 퀘스트 카드에서 사진 또는 영수증 사진을 선택하고 업로드하게 한다.
 * 호출 예시: panel = createEvidencePanel(recommendation, false)
 */
function createEvidencePanel(recommendation, isActionPending) {
  // 현재 추천 항목의 증빙 업로드 목적입니다.
  const purpose = getEvidencePurpose(recommendation);
  // 현재 추천 항목의 증빙 업로드 상태입니다.
  const evidence = state.evidenceUploads[recommendation.instanceId];
  // 증빙 패널 요소입니다.
  const panel = createElement("div", "evidence-panel");
  // 파일 선택 라벨 요소입니다.
  const label = createElement("label", "evidence-upload-button");
  // 파일 선택 input 요소입니다.
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.disabled = isActionPending || evidence?.status === "uploading" || evidence?.ocrStatus === "running";
  input.addEventListener("change", () => {
    // 변수 의미: 사용자가 선택한 첫 번째 이미지 파일입니다.
    const file = input.files?.[0];
    if (file) {
      handleQuestEvidenceUpload(recommendation, file);
    }
    input.value = "";
  });

  label.append(createElement("span", "", getEvidenceLabel(purpose)), input);
  panel.append(label, createElement("p", "evidence-status", getEvidenceStatusText(evidence)));
  return panel;
}

/**
 * 입력: 추천 항목과 표시 옵션.
 * 출력: 추천 카드 HTMLElement.
 * 역할: 퀘스트 목록 카드를 만든다. 모험 중 카드는 시작시각과 행동 버튼을 더 붙인다. (명세 §10 S04·S05)
 * 호출 예시: createRecommendationCard(recommendation, { variant: "adventure" })
 */
function createRecommendationCard(recommendation, options = {}) {
  // 현재 추천 항목의 진행 상태입니다.
  const questStatus = getQuestStatus(recommendation.instanceId, recommendation.status);

  // 모험 중 화면의 카드인지 여부입니다. 주소 복사·완료 인증을 함께 답니다. (명세 §10 S04)
  const isAdventure = options.variant === "adventure";

  // 카드 본문입니다. 눌러서 상세 시트를 엽니다. (명세 §10 S04·S05)
  const body = createElement("button", isAdventure ? "recommendation-card__body" : "px-card recommendation-card");
  body.type = "button";
  body.dataset.questTarget = recommendation.instanceId;

  if (!isAdventure) {
    body.dataset.category = recommendation.category;
  }

  // 카드에 표시할 상태입니다. 목록에서 넘겨 주면 목록형과 같은 판정을 씁니다. (명세 §10 S05)
  const availability = options.availability || null;

  // 카드 상단 메타 영역입니다. 카테고리와 상태를 텍스트로 함께 보여 줍니다.
  const topline = createElement("div", "card-topline");
  topline.append(
    createElement("span", "px-tag", CATEGORY_LABELS[recommendation.category] || "추천"),
    availability
      ? createElement("span", getAvailabilityClass(availability.code), availability.label)
      : createElement("span", getQuestStatusClass(questStatus), getQuestStatusLabel(questStatus)),
  );

  // 퀘스트명과 실제 수행 장소입니다.
  const title = createElement("h3", "card-title", recommendation.questTitle);
  const place = createElement("p", "card-place", recommendation.placeName);

  // 거리·소요시간·미니 뱃지를 담는 요약 행입니다. 수행법과 긴 설명은 상세에만 둡니다.
  const summary = createElement("div", "card-summary");
  summary.append(
    createElement("span", "px-counter", formatDistance(recommendation.distanceMeters)),
    createElement("span", "px-counter", formatDuration(recommendation.estimatedMinutes)),
    createMiniBadge(recommendation),
  );

  body.append(topline, title, place, summary);

  // 행사 개최 상태를 함께 알립니다. (명세 §6.5)
  const cardEventStatus = getEventStatusLabel(recommendation);
  if (cardEventStatus) {
    body.append(createElement("p", "card-festival-note event-note", cardEventStatus));
  }

  if (recommendation.isCommonFestival) {
    body.append(createElement("p", "card-festival-note", formatFestivalTargetNote(recommendation)));
  }

  if (!isAdventure) {
    return body;
  }

  // 모험 중 카드는 시작시각을 함께 보여 줍니다. (명세 §10 S04)
  body.append(createElement("p", "card-started", formatStartTime(recommendation.startedAt)));

  // 본문 버튼과 행동 버튼을 함께 담는 카드입니다. 버튼 중첩을 피하려고 감싸는 요소를 둡니다.
  const card = createElement("article", "px-card recommendation-card recommendation-card--adventure");
  card.dataset.category = recommendation.category;
  card.append(body, createAdventureCardActions(recommendation, questStatus));

  return card;
}

/**
 * 입력: 추천 항목과 진행 상태.
 * 출력: 모험 중 카드의 행동 버튼 영역.
 * 역할: 상세로 들어가지 않아도 주소 복사와 완료 인증을 할 수 있게 한다. (명세 §10 S04)
 * 호출 예시: createAdventureCardActions(recommendation, "accepted")
 */
function createAdventureCardActions(recommendation, questStatus) {
  // 처리 중인 액션입니다. 있으면 버튼을 잠급니다.
  const pendingAction = state.pendingQuestActions[recommendation.instanceId] || "";

  // 행동 버튼을 담는 영역입니다.
  const actions = createElement("div", "card-actions");

  // 주소 복사 버튼입니다. 주소가 없으면 비활성화합니다. (명세 §10 S06 주소 복사)
  const copyButton = createElement("button", "px-button px-button--ghost");
  copyButton.type = "button";
  const copyIcon = createElement("span", "px-icon px-icon--sm", "content_copy");
  copyIcon.setAttribute("aria-hidden", "true");
  copyButton.append(copyIcon, createElement("span", "", "주소 복사"));
  copyButton.disabled = !recommendation.roadAddress;
  copyButton.addEventListener("click", () => copyQuestAddress(recommendation));

  // 완료 인증 버튼입니다. 상태별 CTA 표를 상세와 공유합니다. (명세 §10 S06)
  const cta = getQuestCta(questStatus, getQuestAvailability(recommendation), recommendation);
  const completeButton = createElement("button", "px-button px-button--primary");
  completeButton.type = "button";
  completeButton.textContent = pendingAction ? "처리 중" : cta.label;
  completeButton.disabled = Boolean(pendingAction) || !cta.action;
  completeButton.setAttribute("aria-busy", pendingAction ? "true" : "false");

  if (cta.action) {
    completeButton.addEventListener("click", () => handleQuestAction(recommendation.instanceId, cta.action));
  }

  actions.append(copyButton, completeButton);
  return actions;
}

/**
 * 입력: ISO 8601 시작 시각 문자열.
 * 출력: 화면 표시용 시작시각 문구.
 * 역할: 모험 중 카드에 언제 시작한 퀘스트인지 보여 준다. (명세 §10 S04)
 * 호출 예시: formatStartTime("2026-09-10T09:20:00+09:00")
 */
function formatStartTime(startedAt) {
  if (!startedAt) {
    return "시작시각 기록 없음";
  }

  // 시작 시각입니다. 파싱에 실패하면 원문 대신 안내 문구를 씁니다.
  const started = new Date(startedAt);

  if (Number.isNaN(started.getTime())) {
    return "시작시각 기록 없음";
  }

  return `${started.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 시작`;
}

/**
 * 입력: 퀘스트 인스턴스 식별자.
 * 출력: 없음.
 * 역할: 홈·모험 중·퀘스트가 공유하는 상세 시트를 연다. (명세 §10 S06)
 * 호출 예시: openQuestSheet("mock-nature-001")
 */
function openQuestSheet(instanceId) {
  if (!instanceId) {
    return;
  }

  // 시트를 열기 전 포커스가 있던 요소입니다. 닫을 때 되돌립니다.
  state.questSheetReturnFocus = document.activeElement;
  state.questSheetId = instanceId;
  state.questSheetMessage = "";
  renderQuestSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 공용 퀘스트 상세 시트를 닫고 포커스를 되돌린다.
 * 호출 예시: closeQuestSheet()
 */
function closeQuestSheet() {
  if (!state.questSheetId) {
    return;
  }

  state.questSheetId = "";
  state.questSheetMessage = "";
  renderQuestSheet();

  // 포커스는 시트를 열었던 카드로 되돌립니다.
  const target = state.questSheetReturnFocus;
  if (target instanceof HTMLElement && target.isConnected) {
    target.focus({ preventScroll: true });
  }
  state.questSheetReturnFocus = null;
}

/**
 * 입력: 없음.
 * 출력: 현재 시트가 보여 주는 추천 항목 또는 null.
 * 역할: 시트와 CTA 처리가 같은 항목을 보게 한다.
 * 호출 예시: const quest = getQuestSheetTarget()
 */
function getQuestSheetTarget() {
  return state.recommendations.find((item) => item.instanceId === state.questSheetId) || null;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 상단 제목 고정, 가운데 스크롤, 하단 CTA 고정 구조로 퀘스트 상세를 그린다. (명세 §10 S06)
 * 호출 예시: renderQuestSheet()
 */
function renderQuestSheet() {
  // 시트 컨테이너입니다.
  const sheet = select("#quest-sheet");

  if (!sheet) {
    return;
  }

  // 현재 시트가 보여 줄 퀘스트입니다.
  const quest = getQuestSheetTarget();

  if (!quest) {
    sheet.hidden = true;
    sheet.replaceChildren();
    delete document.body.dataset.questSheetOpen;
    return;
  }

  // 이 퀘스트의 현재 진행 상태입니다.
  const questStatus = getQuestStatus(quest.instanceId, quest.status);
  // 처리 중인 액션입니다. 있으면 CTA를 잠급니다.
  const pendingAction = state.pendingQuestActions[quest.instanceId] || "";

  sheet.hidden = false;
  document.body.dataset.questSheetOpen = "true";
  sheet.replaceChildren();

  // 배경을 덮는 딤 레이어입니다. 눌러서 닫습니다.
  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closeQuestSheet);

  // 시트 본체입니다.
  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "quest-sheet-title");

  panel.append(
    createQuestSheetHead(quest, questStatus),
    createQuestSheetBody(quest, questStatus),
    createQuestSheetCta(quest, questStatus, pendingAction),
  );

  sheet.append(scrim, panel);

  // 열자마자 제목으로 포커스를 옮겨 스크린리더가 시트를 읽게 합니다.
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#quest-sheet-title")?.focus({ preventScroll: true });
}

// 관광지 상세 모달 설명을 미리 보기/전체 보기로 나눌 때 미리 보여줄 문장 수입니다.
const DESCRIPTION_PREVIEW_SENTENCE_COUNT = 3;
// 상세 모달 상태 문구에 쓰는 언어 이름입니다. 국문+영문만 지원합니다.
const UI_LANGUAGE_LABELS = { kor: "국문", eng: "영문" };

/**
 * 입력: 지도에서 선택한 추천 항목.
 * 출력: 없음.
 * 역할: 관광지 상세 모달을 열고 상세 정보를 비동기로 불러온다.
 * 호출 예시: openPlaceDetailSheet(selectedPlace)
 */
function openPlaceDetailSheet(place) {
  if (!place) {
    return;
  }
  stopAudioGuidePlayback();
  state.placeDetailReturnFocus = document.activeElement;
  state.placeDetailSheet = {
    place,
    status: "loading",
    description: place.questDescription || "",
    amenities: [],
    source: "",
    language: state.uiLanguage,
    translationAvailable: true,
    machineTranslated: false,
    descriptionExpanded: false,
    audioGuide: null,
  };
  renderPlaceDetailSheet();
  loadPlaceDetail(place);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 관광지 상세 모달을 닫고 포커스를 되돌린다.
 * 호출 예시: closePlaceDetailSheet()
 */
function closePlaceDetailSheet() {
  if (!state.placeDetailSheet) {
    return;
  }
  stopAudioGuidePlayback();
  state.placeDetailSheet = null;
  renderPlaceDetailSheet();

  const target = state.placeDetailReturnFocus;
  if (target instanceof HTMLElement && target.isConnected) {
    target.focus({ preventScroll: true });
  }
  state.placeDetailReturnFocus = null;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 설명 더 보기/접기 상태를 토글한다.
 * 호출 예시: togglePlaceDetailDescription()
 */
function togglePlaceDetailDescription() {
  if (!state.placeDetailSheet) {
    return;
  }
  state.placeDetailSheet.descriptionExpanded = !state.placeDetailSheet.descriptionExpanded;
  renderPlaceDetailSheet();
}

/**
 * 입력: 설명 문단.
 * 출력: 문장 단위로 나눈 목록.
 * 역할: 마침표/물음표/느낌표 뒤에서 문장을 나눠 미리 보기를 만든다.
 * 호출 예시: splitDescriptionSentences("설명입니다. 두 번째 문장입니다.")
 */
function splitDescriptionSentences(description) {
  return String(description || "")
    .split(/(?<=[.!?。])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * 입력: 정보 출처, 요청 언어, 번역 가능 여부, 기계번역 적용 여부.
 * 출력: 모달 하단에 보여줄 상태 문구.
 * 역할: 실시간 여부와 번역 가능 여부를 하나의 문구로 안내한다.
 * 호출 예시: buildPlaceDetailStatusText("live", "eng", false, true)
 */
function buildPlaceDetailStatusText(source, language, translationAvailable, machineTranslated) {
  const languageLabel = UI_LANGUAGE_LABELS[language] || "";
  if (language && language !== "kor" && translationAvailable === false) {
    if (machineTranslated) {
      return `이 장소는 아직 ${languageLabel} 관광 정보가 없어 자동 번역으로 보여드려요.`;
    }
    return `이 장소는 아직 ${languageLabel} 관광 정보가 없어 국문 설명을 보여드려요.`;
  }
  if (source !== "live") {
    return "실시간 정보 준비 중 · 기본 설명을 보여드려요.";
  }
  return "";
}

/**
 * 입력: 지도에서 선택한 추천 항목.
 * 출력: 없음.
 * 역할: 장소 상세 API를 호출해 모달 상태를 채운다. 경합은 요청 토큰으로 막는다.
 * 호출 예시: loadPlaceDetail(place)
 */
async function loadPlaceDetail(place) {
  state.placeDetailRequestToken += 1;
  const requestToken = state.placeDetailRequestToken;

  if (!place.placeContentId) {
    if (state.placeDetailSheet?.place === place) {
      state.placeDetailSheet = {
        place,
        status: "unavailable",
        description: place.questDescription || "",
        amenities: [],
        source: "",
        language: state.uiLanguage,
        translationAvailable: true,
        machineTranslated: false,
        descriptionExpanded: false,
        audioGuide: null,
      };
      renderPlaceDetailSheet();
    }
    return;
  }

  try {
    const query = new URLSearchParams({
      contentTypeId: place.placeContentTypeId || "",
      lang: state.uiLanguage,
      lat: String(place.placeLatitude),
      lng: String(place.placeLongitude),
    });
    const payload = await fetchJson(`/api/places/${encodeURIComponent(place.placeContentId)}/detail?${query.toString()}`);
    if (requestToken !== state.placeDetailRequestToken) {
      return;
    }
    state.placeDetailSheet = {
      place,
      status: "ready",
      description: payload.description || place.questDescription || "",
      amenities: Array.isArray(payload.amenities) ? payload.amenities : [],
      source: payload.source || "",
      language: payload.language || state.uiLanguage,
      translationAvailable: payload.translationAvailable !== false,
      machineTranslated: Boolean(payload.machineTranslated),
      descriptionExpanded: false,
      audioGuide: payload.audioGuide || null,
    };
  } catch (error) {
    if (requestToken !== state.placeDetailRequestToken) {
      return;
    }
    state.placeDetailSheet = {
      place,
      status: "error",
      description: place.questDescription || "",
      amenities: [],
      source: "",
      language: state.uiLanguage,
      translationAvailable: false,
      machineTranslated: false,
      descriptionExpanded: false,
      audioGuide: null,
    };
  }
  renderPlaceDetailSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: Web Speech API(TTS) 오디오 가이드 재생을 멈춘다.
 * 호출 예시: stopAudioGuidePlayback()
 */
function stopAudioGuidePlayback() {
  // 오디오 가이드 재생 중 배경음악을 낮췄다면, 재생이 끝나는 순간 되돌립니다.
  const wasPlaying = state.audioGuidePlaying;
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  state.audioGuidePlaying = false;
  if (wasPlaying) {
    startBackgroundMusic();
  }
}

/**
 * 입력: 오디오 가이드 대본 객체.
 * 출력: 없음.
 * 역할: 재생 중이면 멈추고, 아니면 Web Speech API로 대본을 읽어준다.
 * 호출 예시: toggleAudioGuidePlayback(audioGuide)
 */
function toggleAudioGuidePlayback(audioGuide) {
  if (!window.speechSynthesis) {
    return;
  }
  if (state.audioGuidePlaying) {
    stopAudioGuidePlayback();
    renderPlaceDetailSheet();
    return;
  }

  window.speechSynthesis.cancel();
  // 오디오 가이드 내레이션과 겹치지 않도록 배경음악을 잠시 멈춥니다.
  pauseBackgroundMusic();
  const utterance = new SpeechSynthesisUtterance(audioGuide.script);
  // 백엔드가 영문 모드에서 script 자체를 이미 번역해서 내려주므로(_handle_place_detail),
  // 읽어 줄 음성도 그 언어에 맞춰야 자연스럽게 들린다.
  utterance.lang = state.uiLanguage === "eng" ? "en-US" : "ko-KR";
  utterance.onend = () => {
    stopAudioGuidePlayback();
    renderPlaceDetailSheet();
  };
  utterance.onerror = () => {
    stopAudioGuidePlayback();
    renderPlaceDetailSheet();
  };

  state.audioGuidePlaying = true;
  window.speechSynthesis.speak(utterance);
  renderPlaceDetailSheet();
}

/**
 * 입력: 오디오 가이드 대본 객체 또는 null.
 * 출력: 오디오 가이드 슬롯 HTMLElement.
 * 역할: 대본이 있으면 재생 버튼을, 없으면 안내 문구를 보여준다.
 * 호출 예시: createAudioGuideSlot(audioGuide)
 */
function createAudioGuideSlot(audioGuide) {
  if (!audioGuide) {
    return createElement("div", "place-detail__audio", "🔊 이 장소는 아직 오디오 가이드가 없습니다.");
  }

  const slot = createElement("div", "place-detail__audio place-detail__audio--ready");
  const playButton = createElement(
    "button",
    "place-detail__audio-button",
    state.audioGuidePlaying ? "⏸ 오디오 가이드 정지" : "▶ 오디오 가이드 재생",
  );
  playButton.type = "button";
  playButton.addEventListener("click", () => toggleAudioGuidePlayback(audioGuide));
  slot.append(playButton, createElement("span", "place-detail__audio-label", audioGuide.audioTitle || audioGuide.title));
  return slot;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 관광지 상세 모달을 그린다. 열려 있지 않으면 컨테이너를 비운다.
 * 호출 예시: renderPlaceDetailSheet()
 */
function renderPlaceDetailSheet() {
  const sheet = select("#place-detail-sheet");
  if (!sheet) {
    return;
  }

  if (!state.placeDetailSheet) {
    sheet.hidden = true;
    sheet.replaceChildren();
    delete document.body.dataset.placeDetailSheetOpen;
    return;
  }

  const {
    place,
    status,
    description,
    amenities,
    source,
    language,
    translationAvailable,
    machineTranslated,
    descriptionExpanded,
    audioGuide,
  } = state.placeDetailSheet;

  sheet.hidden = false;
  document.body.dataset.placeDetailSheetOpen = "true";
  sheet.replaceChildren();

  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closePlaceDetailSheet);

  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "place-detail-sheet-title");

  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", place.placeName);
  title.id = "place-detail-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title, createElement("p", "place-detail__sub", place.questTitle || ""));

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "상세 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closePlaceDetailSheet);
  head.append(titleGroup, closeButton);

  const body = createElement("div", "quest-sheet__body");

  // 설명을 문장 단위로 나눠 미리 보기와 전체 보기를 구분합니다.
  const descriptionSentences = splitDescriptionSentences(description);
  const shouldTruncateDescription = status !== "loading" && descriptionSentences.length > DESCRIPTION_PREVIEW_SENTENCE_COUNT;
  const visibleSentences = shouldTruncateDescription && !descriptionExpanded
    ? descriptionSentences.slice(0, DESCRIPTION_PREVIEW_SENTENCE_COUNT)
    : descriptionSentences;

  const descriptionGroup = createElement("div", "place-detail__description-group");
  if (status === "loading") {
    descriptionGroup.append(createElement("p", "place-detail__description", "설명을 불러오는 중입니다."));
  } else if (visibleSentences.length === 0) {
    descriptionGroup.append(createElement("p", "place-detail__description", "설명을 준비 중입니다."));
  } else {
    visibleSentences.forEach((sentence) => {
      descriptionGroup.append(createElement("p", "place-detail__description", sentence));
    });
  }
  body.append(descriptionGroup);

  if (shouldTruncateDescription) {
    const descriptionToggle = createElement(
      "button",
      "place-detail__description-toggle",
      descriptionExpanded ? "접기" : "더 보기",
    );
    descriptionToggle.type = "button";
    descriptionToggle.addEventListener("click", togglePlaceDetailDescription);
    body.append(descriptionToggle);
  }

  const amenitiesSection = createElement("div", "place-detail__amenities-section");
  amenitiesSection.append(createElement("div", "place-detail__section-title", "추가 정보"));
  const amenitiesList = createElement("div", "place-detail__amenities");
  if (amenities.length > 0) {
    amenities.forEach((amenity) => {
      amenitiesList.append(createElement("span", "place-detail__amenity", `${amenity.label} · ${amenity.value}`));
    });
  } else {
    amenitiesList.append(createElement("span", "place-detail__empty", "등록된 편의 정보가 아직 없습니다."));
  }
  amenitiesSection.append(amenitiesList);
  body.append(amenitiesSection);

  body.append(createAudioGuideSlot(audioGuide));

  const statusMessages = {
    loading: "불러오는 중...",
    error: "상세 정보를 불러오지 못했습니다.",
    unavailable: "실시간 정보 연결 전 장소입니다 · 기본 설명을 보여드려요.",
    ready: buildPlaceDetailStatusText(source, language, translationAvailable, machineTranslated),
  };
  body.append(createElement("p", "place-detail__status", statusMessages[status] || ""));

  panel.append(head, body);
  sheet.append(scrim, panel);

  trapFocus(panel);
  panel.querySelector("#place-detail-sheet-title")?.focus({ preventScroll: true });
}

/**
 * 입력: 추천 항목과 진행 상태.
 * 출력: 시트 상단 고정 영역 요소.
 * 역할: 스크롤해도 퀘스트명이 고정되도록 머리말을 만든다. (명세 §10 S06)
 * 호출 예시: createQuestSheetHead(quest, "accepted")
 */
function createQuestSheetHead(quest, questStatus) {
  // 대화창 형태의 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");

  // 퀘스트명을 담는 영역입니다.
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", quest.questTitle);
  title.id = "quest-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  // 상태와 카테고리를 텍스트로 함께 표시합니다. 목록과 같은 판정을 씁니다. (명세 §10 S05)
  const availability = getQuestAvailability(quest);
  const tags = createElement("div", "quest-sheet__tags");
  const categoryTag = createElement("span", "px-tag", CATEGORY_LABELS[quest.category] || "추천");
  categoryTag.dataset.category = quest.category;
  tags.append(
    categoryTag,
    createElement("span", getAvailabilityClass(availability.code), availability.label),
  );

  // 닫기 버튼입니다.
  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "상세 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closeQuestSheet);

  head.append(titleGroup, tags, closeButton);
  return head;
}

/**
 * 입력: 추천 항목과 진행 상태.
 * 출력: 시트 가운데 스크롤 영역 요소.
 * 역할: 명세 §10 S06 본문 순서대로 상세 내용을 쌓는다.
 * 호출 예시: createQuestSheetBody(quest, "recommended")
 */
function createQuestSheetBody(quest, questStatus) {
  // 스크롤되는 본문 영역입니다.
  const body = createElement("div", "quest-sheet__body");

  // 1. 관광지명, 2. 장소명과 도로명주소, 주소 복사
  body.append(createQuestPlacePanel(quest));

  // 3. 거리·예상 소요시간·난이도
  const stats = createElement("div", "stat-row");
  stats.append(
    createStatCell("직선 거리", formatDistance(quest.distanceMeters)),
    createStatCell("소요 시간", formatDuration(quest.estimatedMinutes)),
    createStatCell("난이도", DIFFICULTY_LABELS[quest.difficulty] || "발견"),
  );
  body.append(stats);

  // 4. 고유 미니 뱃지와 꿈돌이 미리보기
  body.append(createRewardPairPanel(quest, questStatus));

  // 5. 퀘스트 수행 방법
  const guide = createElement("section", "px-panel");
  guide.append(
    createElement("h3", "section-title", "퀘스트 수행 방법"),
    createElement("p", "px-body", quest.questDescription),
  );
  body.append(guide);

  // 6. 완료 인증 조건과 개인정보 안내
  body.append(createVerificationPanel(quest));

  // 7. 행사형이면 개최일·운영시간·타깃 선택 (명세 §10 S06 본문 7항)
  if (quest.isCommonFestival) {
    body.append(createFestivalTargetPanel(quest));
  }

  // 시트 안에서 알릴 메시지입니다. 주소 복사 결과 등을 여기서 보여 줍니다.
  const message = createElement("p", "data-note quest-sheet__message", state.questSheetMessage);
  message.setAttribute("aria-live", "polite");
  body.append(message);

  return body;
}

/**
 * 입력: 추천 항목.
 * 출력: 장소와 주소 복사 패널 요소.
 * 역할: 관광지명과 도로명주소를 보여 주고 둘을 함께 복사한다. (명세 §10 S06 주소 복사)
 * 호출 예시: createQuestPlacePanel(quest)
 */
function createQuestPlacePanel(quest) {
  // 장소 정보를 담는 패널입니다.
  const panel = createElement("section", "px-panel px-panel--inset");

  panel.append(createElement("span", "px-label quest-sheet__eyebrow", "LOCATION"));
  panel.append(createElement("h3", "page-title", quest.placeName));

  // 주소 줄과 복사 버튼입니다.
  const addressRow = createElement("div", "quest-sheet__address");
  addressRow.append(createElement("p", "px-body", quest.roadAddress || "주소 정보가 없습니다."));

  // 주소 복사 버튼입니다. 주소가 없으면 비활성화합니다.
  const copyButton = createElement("button", "px-button px-button--ghost");
  copyButton.type = "button";
  const copyIcon = createElement("span", "px-icon px-icon--sm", "content_copy");
  copyIcon.setAttribute("aria-hidden", "true");
  copyButton.append(copyIcon, createElement("span", "", "주소 복사"));
  copyButton.disabled = !quest.roadAddress;
  copyButton.addEventListener("click", () => copyQuestAddress(quest));
  addressRow.append(copyButton);

  panel.append(addressRow);

  // Clipboard API가 막힌 환경에서는 선택 가능한 텍스트를 대신 보여 줍니다.
  if (state.questSheetFallbackText) {
    const fallback = createElement("pre", "quest-sheet__fallback", state.questSheetFallbackText);
    fallback.tabIndex = 0;
    panel.append(fallback);
  }

  // 외부 길찾기는 제공하지 않습니다. (명세 §1.4, §19)
  panel.append(createElement("p", "data-note", "장소명과 도로명주소를 함께 복사합니다."));

  return panel;
}

/**
 * 입력: 추천 항목.
 * 출력: 없음.
 * 역할: 관광지명과 도로명주소를 클립보드에 복사하고 결과를 알린다. (명세 §10 S06)
 * 호출 예시: copyQuestAddress(quest)
 */
async function copyQuestAddress(quest) {
  if (!quest.roadAddress) {
    return;
  }

  // 복사할 내용은 관광지명 + 줄바꿈 + 도로명주소입니다.
  const text = `${quest.placeName}\n${quest.roadAddress}`;

  // 복사에 성공했는지 여부입니다.
  let isCopied = false;

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard-unavailable");
    }
    await navigator.clipboard.writeText(text);
    isCopied = true;
    state.questSheetFallbackText = "";
    state.questSheetMessage = "주소를 복사했어요";
  } catch (error) {
    // Clipboard API가 없거나 막힌 환경에서는 선택 가능한 텍스트로 대체합니다.
    state.questSheetFallbackText = text;
    state.questSheetMessage = "주소를 복사하지 못했어요. 다시 시도해주세요.";
  }

  // 모험 중 카드에서 부른 경우입니다. 시트가 닫혀 있으면 결과를 알릴 곳이 없습니다.
  if (state.questSheetId !== quest.instanceId) {
    updateSystemStatus(isCopied, state.questSheetMessage);

    // 복사에 실패했으면 선택 가능한 폴백을 보여 주려고 상세 시트를 엽니다. (명세 §10 S06 주소 복사)
    if (!isCopied) {
      openQuestSheet(quest.instanceId);
      state.questSheetMessage = "주소를 복사하지 못했어요. 다시 시도해주세요.";
      renderQuestSheet();
    }
    return;
  }

  renderQuestSheet();
}

/**
 * 입력: 라벨과 값 문자열.
 * 출력: 수치 셀 요소.
 * 역할: 거리·시간·난이도를 같은 규격의 HUD 칸으로 보여 준다.
 * 호출 예시: createStatCell("직선 거리", "480m")
 */
function createStatCell(label, value) {
  // 수치 한 칸입니다.
  const cell = createElement("div", "stat-cell");
  cell.append(
    createElement("span", "stat-cell__label", label),
    createElement("span", "stat-cell__value", value),
  );
  return cell;
}

/**
 * 입력: 추천 항목과 진행 상태.
 * 출력: 보상 쌍 패널 요소.
 * 역할: 누적 카테고리 XP 정책과 서버에서 확인한 보유 보상을 보여 줍니다.
 * 호출 예시: createRewardPairPanel(quest, "recommended")
 */
function createRewardPairPanel(quest, _questStatus) {
  const category = normalizeCategory(quest.category);
  const badge = state.badges
    .filter((item) => normalizeCategory(item.category) === category && (item.earned || item.earnedAt))
    .sort((left, right) => right.tier - left.tier)[0];
  const ggumdori = state.ggumdori
    .filter((item) => normalizeCategory(item.themeCategory) === category && item.unlocked)
    .sort((left, right) => right.tier - left.tier)[0];

  const panel = createElement("section", "px-panel");
  const heading = createElement("div", "context-row");
  heading.append(
    createElement("h3", "section-title", "카테고리 진행 보상"),
    createElement("span", "px-tag px-tag--ink", `+${quest.rewardXp} XP`),
  );
  panel.append(heading);
  panel.append(
    createElement("p", "data-note", "완료 XP가 카테고리에 누적되며 단계 조건을 달성할 때 뱃지와 꿈돌이가 해금됩니다."),
  );

  if (badge || ggumdori) {
    const pair = createElement("div", "reward-pair");
    if (badge) {
      pair.append(createRewardSlot("보유 뱃지", badge.name, badge.imageRef || "", true, category));
    }
    if (ggumdori) {
      pair.append(createRewardSlot("보유 꿈돌이", ggumdori.name, ggumdori.imageRef, true, category));
    }
    panel.append(pair);
  } else {
    panel.append(createElement("p", "data-note", "현재 이 카테고리에서 해금한 보상은 없습니다."));
  }

  return panel;
}

/**
 * 입력: 슬롯 이름, 보상 이름, 이미지 경로, 획득 여부, 카테고리.
 * 출력: 보상 슬롯 요소.
 * 역할: 미획득 보상을 무채색과 잠금 텍스트로 함께 표시한다. (명세 §5.3)
 * 호출 예시: createRewardSlot("꿈돌이", "산책 꿈돌이", ref, false, "nature")
 */
function createRewardSlot(slotLabel, rewardName, imageRef, isEarned, category) {
  // 보상 한 칸입니다.
  const slot = createElement("div", `reward-slot${isEarned ? "" : " is-locked"}`);
  slot.dataset.category = category;

  // 보상 이미지 자리입니다.
  const art = createElement("div", "reward-slot__art");
  if (imageRef) {
    const image = document.createElement("img");
    image.src = imageRef;
    image.alt = "";
    image.dataset.pixelArt = "true";
    image.loading = "lazy";
    art.append(image);
  }
  if (!isEarned) {
    // 색만으로 잠금을 구분하지 않도록 자물쇠 아이콘을 함께 얹습니다.
    const lock = createElement("span", "reward-slot__lock");
    const lockIcon = createElement("span", "px-icon px-icon--sm", "lock");
    lockIcon.setAttribute("aria-hidden", "true");
    lock.append(lockIcon);
    art.append(lock);
  }
  slot.append(art);

  // 보상 이름과 상태 문구입니다.
  const meta = createElement("div", "reward-slot__meta");
  meta.append(
    createElement("span", "stat-cell__label", slotLabel),
    createElement("span", "px-label", rewardName),
    createElement("span", "px-body", isEarned ? "획득함" : "미획득"),
  );
  slot.append(meta);

  return slot;
}

/**
 * 입력: 추천 항목.
 * 출력: 완료 인증 패널 요소.
 * 역할: 인증 5종별 조건과 개인정보 안내를 상세에 표시한다. (명세 §10 S06·S07)
 * 호출 예시: createVerificationPanel(quest)
 */
function createVerificationPanel(quest) {
  // 인증 안내 패널입니다.
  const panel = createElement("section", "px-panel");
  panel.append(
    createElement("h3", "section-title", "완료 인증 조건"),
    createElement(
      "p",
      "px-body",
      `${QUEST_TYPE_LABELS[quest.questType] || "방문형"} · ${getVerificationGuide(quest.questType)}`,
    ),
  );

  // 이동형은 경로를 저장하지 않는다는 사실을 명시합니다. (명세 §10 S07 이동형)
  if (quest.questType === "move") {
    panel.append(createElement("p", "data-note", "이동 중 위치를 계속 추적하지 않아요."));
  }

  // 소비형은 영수증 개인정보 고지가 필수입니다. (명세 §10 S07 소비형)
  if (quest.questType === "spend") {
    panel.append(createElement("p", "data-note", "금액·카드번호·승인번호는 저장하지 않습니다."));
  }

  // 계획 좌표로는 완료할 수 없다는 점을 알립니다. (명세 §19)
  if (state.explorationMode === "planned") {
    panel.append(
      createElement("p", "data-note", "계획 모드입니다. 완료 인증은 현장의 실제 위치에서만 할 수 있어요."),
    );
  }

  // 사진·영수증 업로드 패널을 상세 안으로 옮겼습니다. (마이그레이션 M6)
  panel.append(createEvidencePanel(quest, Boolean(state.pendingQuestActions[quest.instanceId])));

  return panel;
}

/**
 * 입력: 인증 5종 키.
 * 출력: 인증 방법 안내 문장.
 * 역할: 인증 방식별로 사용자가 무엇을 해야 하는지 한 줄로 설명한다. (명세 §4.3)
 * 호출 예시: getVerificationGuide("spend")
 */
function getVerificationGuide(questType) {
  // 인증 5종별 안내 문구입니다.
  const guides = {
    visit: "지정 반경 안에서 현재 위치로 인증합니다.",
    move: "출발지와 도착지에서 각각 위치를 확인합니다.",
    activity: "현장에서 사진을 촬영하거나 파일을 선택합니다.",
    spend: "영수증 또는 간판 사진에서 상호명을 확인합니다.",
    theme: "연결된 하위 퀘스트를 모두 완료합니다.",
  };

  return guides[questType] || guides.visit;
}

/**
 * 입력: 추천 항목, 진행 상태, 처리 중인 액션.
 * 출력: 하단 고정 CTA 영역 요소.
 * 역할: 상태별 CTA 한 개만 고정 노출한다. (명세 §10 S06 상태별 CTA)
 * 호출 예시: createQuestSheetCta(quest, "accepted", "")
 */
function createQuestSheetCta(quest, questStatus, pendingAction) {
  // 하단 고정 버튼 영역입니다.
  const footer = createElement("div", "quest-sheet__cta");

  // 상태와 수행 가능 여부에 맞는 CTA 정의입니다.
  const cta = getQuestCta(questStatus, getQuestAvailability(quest), quest);

  // 주 행동 버튼입니다.
  const button = createElement("button", "px-button px-button--primary");
  button.type = "button";
  button.textContent = pendingAction ? "처리 중" : cta.label;
  button.disabled = Boolean(pendingAction) || !cta.action;
  button.setAttribute("aria-busy", pendingAction ? "true" : "false");

  if (cta.action) {
    button.addEventListener("click", () => handleQuestAction(quest.instanceId, cta.action));
  }

  footer.append(button);
  return footer;
}

/**
 * 입력: 퀘스트 진행 상태와 수행 가능 상태.
 * 출력: CTA 라벨과 액션 이름.
 * 역할: 상태별 CTA 표를 한 곳에서 관리한다. (명세 §10 S06)
 * 호출 예시: getQuestCta("accepted", getQuestAvailability(quest))
 */
function getQuestCta(questStatus, availability = null, quest = null) {
  // 공통 축제 보상을 이미 받았다면 다른 행사는 추가 방문으로 기록합니다. (명세 §10 S06, §11.2)
  if (quest?.isCommonFestival && isAdditionalFestivalVisit(quest)) {
    // 아직 기록하지 않은 유효 타깃이 있어야 추가 방문을 제안합니다.
    const remaining = getValidFestivalTargets(quest).filter((target) => !hasVisitedFestivalTarget(quest, target));
    if (remaining.length > 0) {
      return { label: "추가 방문 기록", action: "complete" };
    }
    return { label: "완료됨", action: "" };
  }

  if (questStatus === "accepted" || questStatus === "in_progress") {
    return { label: "완료 인증", action: "complete" };
  }

  // 아직 시작하지 않았는데 기간을 벗어난 퀘스트는 시작할 수 없습니다. (명세 §10 S05)
  if (availability?.code === "event_ended") {
    return { label: "행사가 끝났어요", action: "" };
  }
  if (availability?.code === "unavailable_on_date") {
    return { label: "선택일에는 할 수 없어요", action: "" };
  }
  if (questStatus === "review" || questStatus === "in_review") {
    return { label: "인증 검토 중", action: "" };
  }
  if (questStatus === "completed" || questStatus === "done") {
    return { label: "완료됨", action: "" };
  }

  return { label: "모험 시작", action: "accept" };
}

/**
 * 입력: 추천 항목.
 * 출력: 미니 뱃지 요소.
 * 역할: 퀘스트에 연결된 고유 미니 뱃지를 목록과 상세에서 같은 모양으로 보여 준다. (명세 §5.1)
 * 호출 예시: createMiniBadge(recommendation, { compact: true })
 */
function createMiniBadge(recommendation, options = {}) {
  // 뱃지 이미지와 이름을 담는 요소입니다. 목록형은 이름 없이 그림만 씁니다.
  const wrapper = createElement("span", options.compact ? "mini-badge mini-badge--compact" : "mini-badge");
  wrapper.dataset.category = recommendation.category;

  // 서버가 준 명시적 뱃지 이미지 경로입니다. 클라이언트가 경로를 계산하지 않습니다. (명세 §5.1)
  const imageRef = recommendation.rewardPair?.badgeImageRef || "";

  if (imageRef) {
    const image = document.createElement("img");
    image.src = imageRef;
    image.alt = "";
    image.dataset.pixelArt = "true";
    image.loading = "lazy";
    wrapper.append(image);
  }

  if (options.compact) {
    // 목록형은 자리가 좁아 이름을 접근성 텍스트로만 남깁니다.
    wrapper.append(createElement("span", "px-sr-only", recommendation.badgeName));
    return wrapper;
  }

  wrapper.append(createElement("span", "mini-badge__name", recommendation.badgeName));
  return wrapper;
}

/**
 * 입력: 예상 소요 분.
 * 출력: 화면 표시용 소요시간 문자열.
 * 역할: 분 단위를 사람이 읽기 쉬운 표기로 바꾼다.
 * 호출 예시: formatDuration(95)
 */
function formatDuration(minutes) {
  // 0 이하이거나 값이 없으면 표시하지 않습니다.
  const total = Math.round(toNumber(minutes, 0));

  if (total <= 0) {
    return "소요시간 미정";
  }
  if (total < 60) {
    return `약 ${total}분`;
  }

  // 시간과 남은 분입니다.
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  return rest === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${rest}분`;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 수락한 퀘스트만 모아 모험 중 화면에 정렬해 표시한다. (명세 §10 S04)
 * 호출 예시: renderAdventure()
 */
function renderAdventure() {
  // 진행 중 퀘스트 목록 컨테이너입니다.
  const list = select("#adventure-list");

  if (!list) {
    return;
  }

  // 수락했거나 수행 중인 퀘스트만 모은 목록입니다. (명세 §10 S04)
  const activeQuests = state.recommendations.filter((item) => {
    // 로컬 저장소까지 반영한 현재 상태입니다.
    const status = getQuestStatus(item.instanceId, item.status);
    return status === "accepted" || status === "in_progress";
  });

  // 실제로 적용할 정렬 기준입니다. 위치 권한이 없으면 시작 순이 기본값입니다. (명세 §10 S04)
  const activeSort = getAdventureSort();

  // 가까운 순 또는 시작 순으로 정렬한 목록입니다. (명세 §19)
  const sortedQuests = [...activeQuests].sort((left, right) => {
    if (activeSort === "started") {
      // 최근에 시작한 퀘스트를 위에 둡니다.
      return String(right.startedAt || "").localeCompare(String(left.startedAt || ""));
    }
    return toNumber(left.distanceMeters, Infinity) - toNumber(right.distanceMeters, Infinity);
  });

  // 정렬 칩은 실제로 적용된 기준을 그대로 보여 줍니다.
  // 날씨 칩을 눌러 상세를 엽니다. (명세 §6.4)
  const weatherPill = select("#home-weather-pill");
  weatherPill?.addEventListener("click", openWeatherSheet);
  weatherPill?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWeatherSheet();
    }
  });

  // 계획 위치·날짜 설정 시트를 엽니다. (명세 §10 S15)
  select("#home-plan-search")?.addEventListener("click", openPlanSheet);

  // S02 닉네임 단계 컨트롤입니다. (명세 §9.4, §10 S02)
  select("#nickname-input")?.addEventListener("input", (event) => {
    state.nicknameDraft = event.target.value || "";
    // 사용자가 직접 고친 값이니, 언어 토글 때 제안값으로 되돌려 조립하지 않도록 잊습니다.
    state.nicknameSuggestionIndices = null;
  });
  select("#nickname-suggest")?.addEventListener("click", () => {
    state.nicknameDraft = suggestNickname();
    renderAccountStep();
  });
  select("#nickname-confirm")?.addEventListener("click", confirmNickname);

  // S09 도감 검색입니다. 꿈돌이와 퀘스트 이름을 함께 찾습니다. (명세 §10 S09)
  select("#collection-search")?.addEventListener("input", (event) => {
    state.catalogSearch = event.target.value || "";
    renderCollection();
  });

  // S09 획득 상태 필터입니다. (명세 §10 S09)
  document.querySelectorAll("[data-collection-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.catalogStatusFilter = button.dataset.collectionFilter || "all";
      renderCollection();
    });
  });

  // S09 카테고리 필터입니다. (명세 §10 S09)
  document.querySelectorAll("[data-collection-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.catalogCategory = button.dataset.collectionCategory || "all";
      renderCollection();
    });
  });

  // S05 목록형·카드형 전환입니다. (명세 §10 S05)
  document.querySelectorAll("[data-quests-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.questsViewMode = button.dataset.questsView === "list" ? "list" : "card";
      renderRecommendations();
    });
  });

  // S05 난이도 필터입니다. 난이도는 보상 단계가 아니라 예상 복잡도입니다. (명세 §4.2)
  document.querySelectorAll("[data-quests-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.questsDifficulty = button.dataset.questsDifficulty || "all";
      renderRecommendations();
    });
  });

  // S05 정렬 기준입니다. (명세 §10 S05)
  select("#quests-sort")?.addEventListener("change", (event) => {
    state.questsSort = QUEST_SORT_LABELS[event.target.value] ? event.target.value : "distance";
    renderRecommendations();
  });

  // 연결 상태가 바뀌면 퀘스트 목록의 오프라인 안내를 갱신합니다. (명세 §13.2)
  window.addEventListener("online", () => {
    state.isOnline = true;
    renderRecommendations();
  });
  window.addEventListener("offline", () => {
    state.isOnline = false;
    renderRecommendations();
  });

  document.querySelectorAll("[data-adventure-sort]").forEach((button) => {
    // 이 버튼이 나타내는 정렬 기준입니다.
    const buttonSort = button.dataset.adventureSort === "started" ? "started" : "distance";
    button.classList.toggle("is-active", buttonSort === activeSort);
    button.setAttribute("aria-pressed", buttonSort === activeSort ? "true" : "false");
    // 위치 권한이 없으면 가까운 순을 고를 수 없습니다. (명세 §10 S04)
    button.disabled = buttonSort === "distance" && !state.location.measured;
  });

  list.replaceChildren();

  if (sortedQuests.length === 0) {
    list.append(createAdventureEmptyState());
    return;
  }

  sortedQuests.forEach((recommendation) => {
    list.append(createRecommendationCard(recommendation, { variant: "adventure" }));
  });
}

/**
 * 입력: 없음.
 * 출력: 실제로 적용할 모험 중 정렬 기준.
 * 역할: 위치 권한이 없으면 시작 순을 기본값으로 쓴다. 사용자가 직접 고른 뒤에는 그 선택을 지킨다. (명세 §10 S04)
 * 호출 예시: const activeSort = getAdventureSort()
 */
function getAdventureSort() {
  // 가까운 순은 실제 현위치를 기준으로 하므로 실측 좌표가 있어야 합니다.
  if (!state.location.measured) {
    return "started";
  }

  return state.adventureSortPinned ? state.adventureSort : "distance";
}

/**
 * 입력: 없음.
 * 출력: 모험 중 빈 상태 요소.
 * 역할: 진행 중 퀘스트가 없을 때 퀘스트 찾아보기로 넘어갈 길을 준다. (명세 §10 S04)
 * 호출 예시: list.append(createAdventureEmptyState())
 */
function createAdventureEmptyState() {
  // 빈 상태를 담는 영역입니다.
  const empty = createElement("div", "empty-state");
  empty.append(createElement("p", "empty-message", "진행 중인 퀘스트가 없습니다."));

  // 퀘스트 탐색 화면으로 넘기는 버튼입니다. 화면 전환은 위임 처리기가 맡습니다.
  const browseButton = createElement("button", "px-button px-button--primary", "퀘스트 찾아보기");
  browseButton.type = "button";
  browseButton.dataset.viewTarget = "quests";
  empty.append(browseButton);

  return empty;
}

/**
 * 입력: 없음.
 * 출력: 현재 필터와 정렬을 적용한 퀘스트 목록.
 * 역할: 목록형과 카드형이 완전히 같은 데이터를 쓰게 한다. (명세 §10 S05)
 * 호출 예시: const quests = getVisibleQuests()
 */
function getVisibleQuests() {
  // 공통 축제 퀘스트는 타깃이 여러 개여도 목록에서는 하나로만 보여 줍니다. (명세 §11.1)
  const deduped = [];
  // 이미 담은 공통 축제 퀘스트의 questId 모음입니다.
  const seenFestivalIds = new Set();

  state.recommendations.forEach((item) => {
    if (!item.isCommonFestival) {
      deduped.push(item);
      return;
    }
    if (seenFestivalIds.has(item.questId)) {
      return;
    }
    seenFestivalIds.add(item.questId);
    deduped.push(item);
  });

  // 카테고리와 난이도를 모두 통과한 목록입니다.
  const filtered = deduped.filter((item) => {
    if (state.selectedCategory !== "all" && item.category !== state.selectedCategory) {
      return false;
    }
    if (state.questsDifficulty !== "all" && item.difficulty !== state.questsDifficulty) {
      return false;
    }
    return true;
  });

  return [...filtered].sort(compareQuestsForSort);
}

/**
 * 입력: 비교할 퀘스트 두 개.
 * 출력: 정렬 비교값.
 * 역할: 선택한 정렬 기준대로 퀘스트 순서를 정한다. (명세 §10 S05)
 * 호출 예시: quests.sort(compareQuestsForSort)
 */
function compareQuestsForSort(left, right) {
  if (state.questsSort === "duration") {
    // 소요시간 미정은 뒤로 보냅니다.
    return toNumber(left.estimatedMinutes, Infinity) - toNumber(right.estimatedMinutes, Infinity);
  }
  if (state.questsSort === "reward") {
    return toNumber(right.rewardXp, 0) - toNumber(left.rewardXp, 0);
  }

  return toNumber(left.distanceMeters, Infinity) - toNumber(right.distanceMeters, Infinity);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 탐색 컨텍스트, 필터, 목록형·카드형 보기를 함께 갱신한다. (명세 §10 S05)
 * 호출 예시: renderRecommendations()
 */
function renderRecommendations() {
  // 퀘스트 목록 컨테이너입니다.
  const list = select("#recommendation-list");

  if (!list) {
    return;
  }

  renderQuestsContext();
  renderQuestsControls();

  // 현재 필터와 정렬을 적용한 목록입니다.
  const quests = getVisibleQuests();

  // 목록형인지 여부입니다. 두 보기는 같은 항목을 다른 밀도로 보여 줍니다.
  const isListView = state.questsViewMode === "list";

  list.className = isListView ? "quest-list" : "card-list";
  list.replaceChildren();

  // 오프라인이면 목록 위에 먼저 알립니다. 캐시된 목록은 그대로 보여 줍니다. (명세 §13.2)
  if (!state.isOnline) {
    list.append(
      createElement("p", "data-note quest-offline-note", "오프라인입니다. 마지막으로 받은 퀘스트를 보여 줍니다."),
    );
  }

  if (quests.length === 0) {
    list.append(createElement("p", "empty-message", getQuestEmptyMessage()));
    return;
  }

  quests.forEach((quest) => {
    // 이 퀘스트의 수행 가능 상태입니다.
    const availability = getQuestAvailability(quest);
    list.append(
      isListView ? createQuestListRow(quest, availability) : createRecommendationCard(quest, { availability }),
    );
  });
}

/**
 * 입력: 없음.
 * 출력: 현재 필터에 맞는 빈 결과 문구.
 * 역할: 왜 결과가 없는지 필터별로 다르게 알린다. (명세 §10 S05)
 * 호출 예시: const message = getQuestEmptyMessage()
 */
function getQuestEmptyMessage() {
  if (state.selectedCategory !== "all" && state.questsDifficulty !== "all") {
    return "이 카테고리와 난이도에 맞는 퀘스트가 없습니다. 필터를 넓혀 보세요.";
  }
  if (state.selectedCategory !== "all") {
    return "이 카테고리의 퀘스트가 아직 없습니다.";
  }
  if (state.questsDifficulty !== "all") {
    return "이 난이도의 퀘스트가 아직 없습니다.";
  }

  return "표시할 퀘스트가 없습니다.";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 퀘스트 목록 상단에 현위치 또는 계획 위치·날짜 컨텍스트를 표시한다. (명세 §10 S05, §6)
 * 호출 예시: renderQuestsContext()
 */
function renderQuestsContext() {
  // 컨텍스트 문구를 담는 요소입니다.
  const contextText = select("#quests-context-text");

  if (!contextText) {
    return;
  }

  // 계획 모드인지 여부입니다.
  const isPlanned = state.explorationMode === "planned";

  // 기준 위치 이름입니다.
  const placeLabel = getRecommendationLocation().label || "대전광역시청";

  if (isPlanned) {
    contextText.textContent = `계획 중 · ${placeLabel} · ${formatContextDate(getQuestReferenceDate())} 기준`;
  } else {
    contextText.textContent = `현위치 · ${placeLabel} · 오늘 기준`;
  }

  // 계획 모드에서는 거리에 계획 위치 기준임을 덧붙입니다. (명세 §6.3)
  const distanceNote = select("#quests-distance-note");
  if (distanceNote) {
    distanceNote.hidden = !isPlanned;
  }
}

/**
 * 입력: YYYY-MM-DD 날짜 문자열.
 * 출력: 화면 표시용 날짜 문구.
 * 역할: 계획 날짜를 짧은 한국어 표기로 보여 준다.
 * 호출 예시: formatContextDate("2026-10-03")
 */
function formatContextDate(dateKey) {
  if (!dateKey) {
    return "오늘";
  }

  // 표시할 날짜입니다. 파싱에 실패하면 원문을 그대로 씁니다.
  const parsed = new Date(`${dateKey}T00:00:00+09:00`);

  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }

  return parsed.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 보기 전환·난이도·정렬 컨트롤의 현재 선택을 화면에 반영한다. (명세 §10 S05)
 * 호출 예시: renderQuestsControls()
 */
function renderQuestsControls() {
  document.querySelectorAll("[data-quests-view]").forEach((button) => {
    // 이 버튼이 나타내는 보기 방식입니다.
    const buttonView = button.dataset.questsView === "list" ? "list" : "card";
    button.classList.toggle("is-active", buttonView === state.questsViewMode);
    button.setAttribute("aria-pressed", buttonView === state.questsViewMode ? "true" : "false");
  });

  document.querySelectorAll("[data-quests-difficulty]").forEach((button) => {
    // 이 버튼이 나타내는 난이도입니다.
    const buttonDifficulty = button.dataset.questsDifficulty || "all";
    button.classList.toggle("is-active", buttonDifficulty === state.questsDifficulty);
    button.setAttribute("aria-pressed", buttonDifficulty === state.questsDifficulty ? "true" : "false");
  });

  // 정렬 선택 요소입니다.
  const sortSelect = select("#quests-sort");
  if (sortSelect instanceof HTMLSelectElement && sortSelect.value !== state.questsSort) {
    sortSelect.value = state.questsSort;
  }
}

/**
 * 입력: 퀘스트 항목과 수행 가능 상태.
 * 출력: 목록형 한 줄 요소.
 * 역할: 카드형과 같은 정보를 더 높은 밀도로 보여 준다. (명세 §10 S05)
 * 호출 예시: createQuestListRow(quest, availability)
 */
function createQuestListRow(quest, availability) {
  // 목록 한 줄 전체가 상세 시트를 여는 버튼입니다.
  const row = createElement("button", "quest-line");
  row.type = "button";
  row.dataset.category = quest.category;
  row.dataset.questTarget = quest.instanceId;

  // 왼쪽의 미니 뱃지입니다. 카드형과 같은 컴포넌트를 씁니다.
  row.append(createMiniBadge(quest, { compact: true }));

  // 가운데의 글 영역입니다.
  const main = createElement("div", "quest-line__main");
  main.append(createElement("span", "quest-line__title", quest.questTitle));
  main.append(createElement("span", "quest-line__place", quest.placeName));

  // 거리와 소요시간입니다.
  const meta = createElement("span", "quest-line__meta");
  meta.append(
    createElement("span", "px-counter", formatDistance(quest.distanceMeters)),
    createElement("span", "px-counter", formatDuration(quest.estimatedMinutes)),
  );
  main.append(meta);

  // 행사 개최 상태를 함께 알립니다. (명세 §6.5)
  const eventStatus = getEventStatusLabel(quest);
  if (eventStatus) {
    main.append(createElement("span", "quest-line__note event-note", eventStatus));
  }

  // 공통 축제 퀘스트는 참여 가능한 행사 수를 보조 문구로 덧붙입니다. (명세 §10 S05, §11.1)
  if (quest.isCommonFestival) {
    main.append(createElement("span", "quest-line__note", formatFestivalTargetNote(quest)));
  }

  row.append(main);

  // 오른쪽의 상태 표시입니다.
  row.append(createElement("span", getAvailabilityClass(availability.code), availability.label));

  return row;
}

/**
 * 입력: 공통 축제 퀘스트 항목.
 * 출력: 참여 가능한 행사 수 보조 문구.
 * 역할: 타깃이 여러 개인 공통 퀘스트를 한 장으로 보여 주면서 규모를 알린다. (명세 §10 S05, §11.1)
 * 호출 예시: formatFestivalTargetNote(quest)
 */
function formatFestivalTargetNote(quest) {
  // 참여할 수 있는 행사 타깃 수입니다.
  const count = toNumber(quest.festivalTargetCount, 0);

  return count > 0 ? `참여 가능한 행사 ${count}곳` : "참여 가능한 행사를 확인하세요";
}

/**
 * 입력: 수행 가능 상태 코드.
 * 출력: 상태 표시에 쓸 클래스 이름.
 * 역할: 색만으로 구분하지 않도록 상태별 태그 모양을 정한다. (명세 §3.2, §10 S05)
 * 호출 예시: getAvailabilityClass("event_ended")
 */
function getAvailabilityClass(availabilityCode) {
  if (availabilityCode === "completed") {
    return "status-badge status-badge--done";
  }
  if (availabilityCode === "in_progress") {
    return "status-badge status-badge--active";
  }
  if (availabilityCode === "event_ended" || availabilityCode === "unavailable_on_date") {
    return "status-badge status-badge--locked";
  }

  return "status-badge status-badge--available";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 퀘스트 진행 상태 요약을 렌더링한다.
 * 호출 예시: renderQuestBoard()
 */
function renderQuestBoard() {
  // 퀘스트 보드 컨테이너입니다.
  const board = select("#quest-board");

  if (!board) {
    return;
  }

  board.replaceChildren();

  // 퀘스트 상태 그룹 정의입니다. 영문 라벨은 카운트 숫자와 한 텍스트 노드로 합쳐지므로
  // (예: "추천됨 3") UI_STRINGS_EN의 완전 일치 방식으로는 못 잡아, localize()로 직접 고른다.
  const groups = [
    { key: "recommended", title: localize("추천됨", "Recommended") },
    { key: "accepted", title: localize("진행 중", "In Progress") },
    { key: "completed", title: localize("완료", "Completed") },
  ];

  groups.forEach((group) => {
    // 상태별 퀘스트 목록입니다.
    const groupItems = state.recommendations.filter((item) => {
      const status = getQuestStatus(item.instanceId, item.status);
      if (group.key === "accepted") {
        return status === "accepted" || status === "in_progress";
      }
      if (group.key === "completed") {
        return status === "completed" || status === "done";
      }
      return status === "recommended";
    });

    // 상태별 컬럼 요소입니다.
    const column = createElement("div", "quest-column");
    column.append(createElement("h3", "", `${group.title} ${groupItems.length}`));

    if (groupItems.length === 0) {
      column.append(createElement("p", "empty-message", "표시할 퀘스트가 없습니다."));
    }

    groupItems.slice(0, 4).forEach((item) => {
      // 퀘스트 한 줄 요약 요소입니다.
      const row = createElement("div", "quest-row");
      const text = createElement("div");
      text.append(createElement("strong", "", item.questTitle), createElement("p", "", item.placeName));
      row.append(text, createElement("span", "category-tag", `${item.rewardXp} XP`));
      column.append(row);
    });

    board.append(column);
  });
}

/**
 * 입력: 지도 캔버스 요소.
 * 출력: 없음.
 * 역할: 실제 지도 SDK가 없어도 이전 목업 지도와 비슷한 배경 요소를 만든다.
 * 호출 예시: renderMapBackground(canvas)
 */
function renderMapBackground(canvas) {
  // 지도 도로 배경 요소들입니다.
  const roadA = createElement("span", "map-road");
  const roadB = createElement("span", "map-road");
  const river = createElement("span", "map-river");
  const park = createElement("span", "map-park");
  const labelA = createElement("span", "map-label", "갑천");
  const labelB = createElement("span", "map-label", "대전 탐험권");

  roadA.style.cssText = "width:76%;height:18px;left:10%;top:45%;transform:rotate(-18deg);";
  roadB.style.cssText = "width:62%;height:14px;left:24%;top:64%;transform:rotate(26deg);";
  river.style.cssText = "left:7%;top:22%;transform:rotate(-10deg);";
  park.style.cssText = "width:132px;height:86px;right:12%;top:16%;";
  labelA.style.cssText = "left:13%;top:19%;";
  labelB.style.cssText = "right:12%;top:40%;";
  canvas.append(roadA, roadB, river, park, labelA, labelB);
}

/**
 * 입력: 지도 캔버스와 추천 장소 목록.
 * 출력: 없음.
 * 역할: 실제 지도 SDK를 사용할 수 없을 때 기존 수첩형 목업 지도를 표시한다.
 * 호출 예시: renderMockMapView(canvas, places)
 */
function renderMockMapView(canvas, places) {
  // 위도 목록입니다.
  const latitudes = places.map((item) => item.placeLatitude).concat(getRecommendationLocation().lat);
  // 경도 목록입니다.
  const longitudes = places.map((item) => item.placeLongitude).concat(getRecommendationLocation().lng);
  // 지도 좌표 범위입니다.
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  state.naverMapInstance = null;
  state.naverMapMarkers = [];
  state.naverPositionMarker = null;
  canvas.classList.remove("is-naver");
  canvas.classList.add("is-mock");
  canvas.replaceChildren();
  renderMapBackground(canvas);

  // 현재 위치 표시 요소입니다.
  const currentLocationMarker = createElement("span", "current-location-marker");
  currentLocationMarker.title = getRecommendationLocation().label;
  currentLocationMarker.style.left = `${toMapPercent(getRecommendationLocation().lng, minLongitude, maxLongitude)}%`;
  currentLocationMarker.style.top = `${toMapPercent(getRecommendationLocation().lat, minLatitude, maxLatitude, true)}%`;
  canvas.append(currentLocationMarker);

  places.forEach((place) => {
    // 현재 추천 장소가 선택 상태인지 여부입니다.
    const isSelected = place.instanceId === state.selectedMapInstanceId;
    // 지도 마커 버튼입니다.
    const marker = createElement("button", `map-marker${isSelected ? " is-selected" : ""}`.trim());
    marker.type = "button";
    marker.style.left = `${toMapPercent(place.placeLongitude, minLongitude, maxLongitude)}%`;
    marker.style.top = `${toMapPercent(place.placeLatitude, minLatitude, maxLatitude, true)}%`;
    marker.addEventListener("click", () => selectMapPlace(place.instanceId));
    marker.append(
      createElement("span", "map-badge", getCategoryIcon(place.category)),
      createElement("span", "map-marker-label", place.placeName),
    );
    canvas.append(marker);
  });
}

/**
 * 입력: 지도 캔버스와 추천 장소 목록.
 * 출력: 없음.
 * 역할: NAVER Dynamic Map 위에 현재 위치와 추천 퀘스트 마커를 표시한다.
 * 호출 예시: await renderNaverMapView(canvas, places)
 */
async function renderNaverMapView(canvas, places) {
  if (!state.naverMapConfig.dynamicMapConfigured || !state.naverMapConfig.keyId) {
    throw new Error("NAVER Dynamic Map Key ID is missing.");
  }

  await loadNaverMapsSdk(state.naverMapConfig.keyId);
  if (places !== state.recommendations) {
    return;
  }

  // 지도 중심 좌표입니다.
  const center = new window.naver.maps.LatLng(getRecommendationLocation().lat, getRecommendationLocation().lng);
  canvas.classList.remove("is-mock");
  canvas.classList.add("is-naver");

  if (!state.naverMapInstance) {
    canvas.replaceChildren();
    state.naverMapInstance = new window.naver.maps.Map(canvas, {
      center,
      zoom: NAVER_MAP_DEFAULT_ZOOM,
      minZoom: 7,
      scaleControl: true,
      mapDataControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: window.naver.maps.Position.TOP_RIGHT,
      },
    });
    state.naverMapCenteredLocation = { lat: getRecommendationLocation().lat, lng: getRecommendationLocation().lng };
    window.naver.maps.Event.addListener(state.naverMapInstance, "click", (event) => {
      if (state.explorationMode !== "planned") {
        return;
      }
      setPlanningLocation(event.coord.lat(), event.coord.lng(), "지도에서 선택한 위치");
    });
  } else {
    // 추천 기준 위치가 실제로 바뀐 경우(GPS 갱신, 계획 위치 변경, 현위치/계획 모드 전환)에만
    // 센터를 옮긴다. 모달을 열고 닫는 것처럼 위치와 무관한 재렌더링마다 센터를 리셋하면
    // 사용자가 손으로 확대/이동해 둔 지도 위치가 자꾸 원점으로 튕겨 나가 불편해진다.
    const referenceLocation = getRecommendationLocation();
    const lastCenteredLocation = state.naverMapCenteredLocation;
    const locationChanged =
      !lastCenteredLocation ||
      lastCenteredLocation.lat !== referenceLocation.lat ||
      lastCenteredLocation.lng !== referenceLocation.lng;
    if (locationChanged) {
      state.naverMapInstance.setCenter(center);
      state.naverMapCenteredLocation = { lat: referenceLocation.lat, lng: referenceLocation.lng };
    }
  }

  syncNaverPositionMarker();
  syncNaverPlaceMarkers(places);
  renderRecommendationMeta();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: NAVER 지도 위의 현재 위치 마커를 만들거나 갱신한다.
 * 호출 예시: syncNaverPositionMarker()
 */
function syncNaverPositionMarker() {
  if (!state.naverMapInstance || !hasNaverMaps()) {
    return;
  }

  // 현재 위치 좌표입니다.
  const position = new window.naver.maps.LatLng(getRecommendationLocation().lat, getRecommendationLocation().lng);

  if (state.naverPositionMarker) {
    state.naverPositionMarker.setPosition(position);
    return;
  }

  state.naverPositionMarker = new window.naver.maps.Marker({
    map: state.naverMapInstance,
    position,
    icon: buildNaverPositionMarkerIcon(),
    zIndex: 100,
  });
}

/**
 * 입력: 되돌아갈 기준 위치.
 * 출력: 없음.
 * 역할: "현재 위치" 버튼처럼 사용자가 명시적으로 위치로 돌아가길 요청했을 때만 지도를
 *       그 위치로 되돌린다. 좌표 값이 이전과 같아도(같은 GPS 캐시 결과 등) 항상 되돌아간다는
 *       걸 보장한다 — renderNaverMapView()의 좌표-변경 감지는 모달 열고 닫기 같은 무관한
 *       재렌더링에서 지도를 건드리지 않기 위한 것이라 이 경우엔 못 쓴다.
 * 호출 예시: recenterNaverMapOnLocation(state.location)
 */
function recenterNaverMapOnLocation(location) {
  if (!state.naverMapInstance || !hasNaverMaps()) {
    return;
  }
  state.naverMapInstance.setCenter(new window.naver.maps.LatLng(location.lat, location.lng));
  state.naverMapInstance.setZoom(NAVER_MAP_DEFAULT_ZOOM);
  state.naverMapCenteredLocation = { lat: location.lat, lng: location.lng };
}

/**
 * 입력: 추천 장소 목록.
 * 출력: 없음.
 * 역할: NAVER 지도 위 퀘스트 마커를 추천 데이터와 선택 상태에 맞게 갱신한다.
 * 호출 예시: syncNaverPlaceMarkers(places)
 */
function syncNaverPlaceMarkers(places) {
  if (!state.naverMapInstance || !hasNaverMaps()) {
    return;
  }

  state.naverMapMarkers.forEach((entry) => entry.marker.setMap(null));
  state.naverMapMarkers = places.map((place) => {
    // 장소 마커입니다.
    const marker = new window.naver.maps.Marker({
      map: state.naverMapInstance,
      position: toNaverLatLng(place),
      icon: buildNaverPlaceMarkerIcon(place, place.instanceId === state.selectedMapInstanceId),
    });

    window.naver.maps.Event.addListener(marker, "click", () => {
      // 마커를 눌러 모달을 열 때도 지도를 확대/이동시키지 않는다(사용자가 옮겨 둔 상태 보존).
      selectMapPlace(place.instanceId);
    });

    return { marker, place };
  });
}

/**
 * 입력: 숫자 값, 최솟값, 최댓값, 반전 여부.
 * 출력: 지도 위 백분율 좌표.
 * 역할: 대전 주변 좌표를 작은 목업 지도 안에 안정적으로 배치한다.
 * 호출 예시: const left = toMapPercent(place.lng, minLng, maxLng)
 */
function toMapPercent(value, minValue, maxValue, isReversed = false) {
  // 좌표 범위입니다.
  const range = Math.max(maxValue - minValue, 0.0001);
  // 8~92% 사이에 배치할 정규화 값입니다.
  const normalized = 8 + ((toNumber(value) - minValue) / range) * 84;
  // 지도 경계 안으로 보정한 값입니다.
  const clamped = Math.min(Math.max(normalized, 8), 92);

  return isReversed ? 100 - clamped : clamped;
}

/**
 * 입력: 지도에서 선택할 추천 항목 ID.
 * 출력: 없음.
 * 역할: 지도 마커와 장소 목록의 선택 상태를 갱신한다.
 * 호출 예시: selectMapPlace("mock-science-001")
 */
function selectMapPlace(instanceId) {
  state.selectedMapInstanceId = instanceId;
  renderMapView();

  // 선택한 추천 장소입니다.
  const selectedPlace = state.recommendations.find((item) => item.instanceId === instanceId);
  if (selectedPlace) {
    // 모달을 여느라 지도를 확대/이동시키지 않는다. 사용자가 직접 옮겨 둔 지도 상태(확대/이동)를
    // 그대로 보존해야 모달을 보고 나서도 하던 흐름을 이어갈 수 있다.
    openPlaceDetailSheet(selectedPlace);
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 지도 탭의 목업 지도, 장소 목록, 선택 상세를 렌더링한다.
 * 호출 예시: renderMapView()
 */
function renderMapView() {
  // 지도 캔버스 요소입니다.
  const canvas = select("#quest-map");
  // 지도 상세 카드 컨테이너입니다.
  const detail = select("#map-detail");
  // 지도 장소 목록 컨테이너입니다.
  const list = select("#map-place-list");

  if (!canvas || !detail || !list) {
    return;
  }

  // 지도에 표시할 추천 항목입니다.
  const places = state.recommendations;

  if (!places.some((item) => item.instanceId === state.selectedMapInstanceId)) {
    state.selectedMapInstanceId = places[0]?.instanceId || "";
  }

  detail.replaceChildren();
  list.replaceChildren();

  places.forEach((place) => {
    // 현재 추천 장소가 선택 상태인지 여부입니다.
    const isSelected = place.instanceId === state.selectedMapInstanceId;
    // 장소 목록 버튼입니다.
    const placeButton = createElement("button", `map-place-button${isSelected ? " is-selected" : ""}`.trim());
    placeButton.type = "button";
    placeButton.addEventListener("click", () => selectMapPlace(place.instanceId));
    placeButton.append(
      createElement("span", "map-badge", getCategoryIcon(place.category)),
      createMapPlaceCopy(place),
      createElement("span", "distance-tag", formatDistance(place.distanceMeters)),
    );
    list.append(placeButton);
  });

  // 선택된 장소입니다.
  const selectedPlace = places.find((item) => item.instanceId === state.selectedMapInstanceId) || places[0];

  if (selectedPlace) {
    detail.append(createMapDetailCard(selectedPlace));
  } else {
    detail.append(createElement("p", "empty-state", "이 위치에는 추천 퀘스트가 없습니다."));
  }

  if (state.naverMapConfig.dynamicMapConfigured && state.naverMapConfig.keyId && state.naverMapLoadState !== "failed") {
    renderNaverMapView(canvas, places).catch(() => {
      if (places !== state.recommendations) {
        return;
      }
      state.naverMapLoadState = "failed";
      state.naverMapConfigured = false;
      renderMockMapView(canvas, places);
      renderRecommendationMeta();
    });
    return;
  }

  renderMockMapView(canvas, places);
}

/**
 * 입력: 추천 장소 항목.
 * 출력: 장소 목록용 텍스트 HTMLElement.
 * 역할: 지도 장소 목록의 제목과 부제목을 구성한다.
 * 호출 예시: const copy = createMapPlaceCopy(place)
 */
function createMapPlaceCopy(place) {
  // 장소 목록 텍스트 영역입니다.
  const copy = createElement("div", "map-detail-copy");
  copy.append(createElement("div", "map-detail-title", place.placeName), createElement("div", "map-detail-sub", place.questTitle));
  return copy;
}

/**
 * 입력: 추천 장소 항목.
 * 출력: 지도 상세 카드 HTMLElement.
 * 역할: 선택된 장소의 퀘스트 정보를 표시한다.
 * 호출 예시: detail.append(createMapDetailCard(place))
 */
function createMapDetailCard(place) {
  // 지도 상세 카드입니다.
  const card = createElement("article", "map-detail-card");
  // 지도 상세 헤더입니다.
  const head = createElement("div", "map-detail-head");
  head.append(createElement("span", "map-badge", getCategoryIcon(place.category)), createMapPlaceCopy(place));

  // 지도 상세 메타 정보입니다.
  const meta = createElement("div", "reward-row");
  meta.append(
    createElement("span", "", `${place.rewardXp} XP`),
    createElement("span", "", place.badgeName),
    createElement("span", "", place.verificationType),
  );

  // 퀘스트 화면으로 이동하는 버튼입니다.
  const questButton = createElement("button", "primary-action", "퀘스트 보기");
  questButton.type = "button";
  questButton.addEventListener("click", () => setActiveView("quests"));

  card.append(head, createElement("p", "card-description", place.questDescription), meta, questButton);
  return card;
}

/**
 * 입력: 수첩 기록.
 * 출력: 화면 입력 상태 객체.
 * 역할: 서버 기록을 일기·리뷰 편집 폼의 초기 상태로 변환한다.
 * 호출 예시: const draft = createNoteDraft(note)
 */
function createNoteDraft(note) {
  // 편집 폼의 기준이 되는 서버 기록입니다.
  const entry = note.entry || {};

  return {
    type: entry.type === "review" ? "review" : "diary",
    title: String(entry.title || ""),
    body: String(entry.body || ""),
    rating: entry.type === "review" ? toNumber(entry.rating, 0) || "" : "",
    dirty: false,
    pending: false,
    isOpen: false,
    message: "",
    tone: "",
  };
}

/**
 * 입력: 수첩 기록.
 * 출력: 해당 기록의 현재 편집 상태.
 * 역할: 전체 화면 재렌더링 뒤에도 작성 중인 값을 잃지 않게 편집 상태를 보존한다.
 * 호출 예시: const draft = getNoteDraft(note)
 */
function getNoteDraft(note) {
  if (!state.noteDrafts[note.id]) {
    state.noteDrafts[note.id] = createNoteDraft(note);
  }

  return state.noteDrafts[note.id];
}

/**
 * 입력: 사진이 연결된 수첩 기록과 즉시 렌더링 여부.
 * 출력: 다운로드 URL 발급 완료 Promise.
 * 역할: 현재 사용자 사진의 짧은 presigned GET URL을 발급받아 카드 상태에 저장한다.
 * 호출 예시: await requestNotePhoto(note, true)
 */
async function requestNotePhoto(note, shouldRender = false) {
  if (!note.photoRef) {
    delete state.notePhotos[note.id];
    return;
  }

  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  // 동시에 진행된 요청 중 최신 응답만 반영하기 위한 요청 식별자입니다.
  const requestId = createClientId("note-photo");
  state.notePhotos[note.id] = {
    status: "loading",
    url: "",
    objectKey: note.photoRef,
    requestId,
    error: "",
  };

  if (shouldRender) {
    renderNotes();
  }

  try {
    // Object Storage 다운로드 URL 발급 응답입니다.
    const payload = await fetchJson("/api/object-storage/download-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectKey: note.photoRef }),
    });
    // 응답을 반영할 현재 사진 요청 상태입니다.
    const currentPhoto = state.notePhotos[note.id];

    if (
      currentPhoto?.requestId !== requestId ||
      sessionVersion !== state.sessionVersion ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    if (!payload.url) {
      throw new Error("missing download url");
    }

    state.notePhotos[note.id] = {
      status: "ready",
      url: String(payload.url),
      objectKey: String(payload.objectKey || note.photoRef),
      expiresInSeconds: toNumber(payload.expiresInSeconds, 0),
      requestId,
      error: "",
    };
  } catch (error) {
    // 실패 응답을 반영할 현재 사진 요청 상태입니다.
    const currentPhoto = state.notePhotos[note.id];
    if (
      isUnauthorizedError(error) ||
      currentPhoto?.requestId !== requestId ||
      sessionVersion !== state.sessionVersion ||
      accessToken !== state.accessToken
    ) {
      return;
    }

    state.notePhotos[note.id] = {
      status: "failed",
      url: "",
      objectKey: note.photoRef,
      requestId,
      error: "사진을 불러오지 못했습니다.",
    };
  } finally {
    if (shouldRender && accessToken && accessToken === state.accessToken && sessionVersion === state.sessionVersion) {
      renderNotes();
    }
  }
}

/**
 * 입력: 이미지 표시가 실패한 수첩 기록.
 * 출력: 없음.
 * 역할: 만료되거나 읽을 수 없는 사진 URL을 재발급 가능한 실패 상태로 바꾼다.
 * 호출 예시: markNotePhotoFailed(note)
 */
function markNotePhotoFailed(note) {
  // 브라우저가 표시하지 못한 현재 사진 상태입니다.
  const currentPhoto = state.notePhotos[note.id];
  if (!currentPhoto || currentPhoto.status !== "ready") {
    return;
  }

  state.notePhotos[note.id] = {
    ...currentPhoto,
    status: "failed",
    error: "사진 주소가 만료되었거나 이미지를 표시할 수 없습니다.",
  };
  renderNotes();
}

/**
 * 입력: 수첩 기록.
 * 출력: 사진 표시 HTMLElement.
 * 역할: 사진 로딩, 원본 열기, 실패 재시도 상태를 접근 가능한 한 영역으로 만든다.
 * 호출 예시: const photo = createNotePhoto(note)
 */
function createNotePhoto(note) {
  // 수첩 기록의 사진 조회 상태입니다.
  const photoState = state.notePhotos[note.id] || { status: "loading" };
  // 사진과 상태 문구를 감싸는 영역입니다.
  const panel = createElement("section", "note-photo-panel");
  panel.setAttribute("aria-label", "퀘스트 인증 사진");

  if (photoState.status === "ready" && photoState.url) {
    // 인증 사진과 설명을 묶는 요소입니다.
    const figure = createElement("figure", "note-photo-figure");
    // Object Storage에서 불러온 인증 사진입니다.
    const image = document.createElement("img");
    image.className = "note-photo-image";
    image.src = photoState.url;
    image.alt = `${note.placeName}에서 완료한 ${note.title} 인증 사진`;
    image.loading = "lazy";
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => markNotePhotoFailed(note), { once: true });

    // 사진의 용도를 알려주는 설명입니다.
    const caption = createElement("figcaption", "note-photo-caption", "퀘스트 완료 시 첨부한 인증 사진");
    figure.append(image, caption);

    // 별도 탭에서 원본 사진을 확인하는 링크입니다.
    const originalLink = createElement("a", "card-action card-action--secondary note-photo-link", "원본 사진 열기");
    originalLink.href = photoState.url;
    originalLink.target = "_blank";
    originalLink.rel = "noopener noreferrer";
    originalLink.referrerPolicy = "no-referrer";
    originalLink.setAttribute("aria-label", `${note.title} 인증 사진 원본을 새 탭에서 열기`);
    panel.append(figure, originalLink);
    return panel;
  }

  if (photoState.status === "failed") {
    // 사진 조회 실패 안내 문구입니다.
    const errorMessage = createElement("p", "note-photo-status note-photo-status--error", photoState.error || "사진을 불러오지 못했습니다.");
    // 새 presigned URL을 요청하는 재시도 버튼입니다.
    const retryButton = createElement("button", "card-action card-action--secondary", "사진 다시 불러오기");
    retryButton.type = "button";
    retryButton.addEventListener("click", () => requestNotePhoto(note, true));
    panel.append(errorMessage, retryButton);
    if (photoState.url) {
      // 브라우저 미지원 이미지도 별도 탭에서 확인할 수 있는 원본 링크입니다.
      const originalLink = createElement("a", "card-action card-action--secondary note-photo-link", "원본 사진 열기");
      originalLink.href = photoState.url;
      originalLink.target = "_blank";
      originalLink.rel = "noopener noreferrer";
      originalLink.referrerPolicy = "no-referrer";
      originalLink.setAttribute("aria-label", `${note.title} 인증 사진 원본을 새 탭에서 열기`);
      panel.append(originalLink);
    }
    return panel;
  }

  panel.setAttribute("aria-busy", "true");
  panel.append(createElement("p", "note-photo-status", "인증 사진을 불러오는 중입니다…"));
  return panel;
}

/**
 * 입력: 수첩 기록.
 * 출력: 사용자 일기·리뷰 표시 HTMLElement.
 * 역할: 시스템 완료 요약과 사용자가 작성한 기록을 구분해 읽기 화면에 표시한다.
 * 호출 예시: const entry = createNoteEntryDisplay(note)
 */
function createNoteEntryDisplay(note) {
  // 화면에 표시할 사용자 작성 기록입니다.
  const entry = note.entry || {};
  // 작성된 제목 또는 본문이 있는지 여부입니다.
  const hasEntry = Boolean(String(entry.title || "").trim() || String(entry.body || "").trim());

  if (!hasEntry) {
    return createElement("p", "note-entry-empty", "아직 작성한 일기나 리뷰가 없습니다.");
  }

  // 사용자 기록 전체 영역입니다.
  const section = createElement("section", "note-entry-display");
  section.setAttribute("aria-label", entry.type === "review" ? "나의 리뷰" : "나의 일기");
  // 기록 유형과 리뷰 별점을 표시하는 머리글입니다.
  const header = createElement("div", "note-entry-header");
  header.append(createElement("span", "type-chip", entry.type === "review" ? "리뷰" : "일기"));

  if (entry.type === "review" && entry.rating) {
    // 숫자 평점을 별 문자로 표현한 읽기 전용 요소입니다.
    const rating = createElement("span", "note-entry-rating", `${"★".repeat(entry.rating)}${"☆".repeat(5 - entry.rating)}`);
    rating.setAttribute("aria-label", `별점 5점 만점에 ${entry.rating}점`);
    header.append(rating);
  }

  section.append(header);
  if (entry.title) {
    section.append(createElement("h4", "note-entry-title", entry.title));
  }
  section.append(createElement("p", "note-entry-body", entry.body));
  if (entry.updatedAt) {
    section.append(createElement("p", "note-entry-updated", `마지막 수정 ${formatDate(entry.updatedAt)}`));
  }
  return section;
}

/**
 * 입력: 저장할 수첩 기록 ID.
 * 출력: 기록 저장 완료 Promise.
 * 역할: 편집 상태를 검증해 현재 사용자의 수첩 기록을 PATCH로 갱신한다.
 * 호출 예시: await saveNoteEntry("note_x")
 */
async function saveNoteEntry(noteId) {
  // 계정 전환 후에는 저장 결과를 화면에 반영하지 않습니다.
  const isCurrentSession = captureSession();
  // 저장 대상 수첩 기록입니다.
  const note = state.notes.find((item) => item.id === noteId);
  // 저장 대상의 현재 편집 상태입니다.
  const draft = note ? getNoteDraft(note) : null;
  if (!note || !draft || draft.pending) {
    return;
  }

  // 앞뒤 공백을 제거한 기록 제목입니다.
  const title = String(draft.title || "").trim();
  // 앞뒤 공백을 제거한 기록 본문입니다.
  const body = String(draft.body || "").trim();
  // 서버에 저장할 기록 유형입니다.
  const entryType = draft.type === "review" ? "review" : "diary";
  // 리뷰에만 저장할 숫자 평점입니다.
  const rating = entryType === "review" ? Number(draft.rating) : null;

  draft.isOpen = true;
  draft.tone = "error";
  if (title.length > NOTE_ENTRY_TITLE_MAX_LENGTH) {
    draft.message = `제목은 ${NOTE_ENTRY_TITLE_MAX_LENGTH}자 이내로 작성하세요.`;
    renderNotes();
    return;
  }
  if (!body) {
    draft.message = "일기 또는 리뷰 본문을 작성하세요.";
    renderNotes();
    return;
  }
  if (body.length > NOTE_ENTRY_BODY_MAX_LENGTH) {
    draft.message = `본문은 ${NOTE_ENTRY_BODY_MAX_LENGTH}자 이내로 작성하세요.`;
    renderNotes();
    return;
  }
  if (entryType === "review" && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    draft.message = "리뷰 별점을 1점부터 5점 사이에서 선택하세요.";
    renderNotes();
    return;
  }
  if (!ensureSessionReady()) {
    return;
  }

  draft.pending = true;
  draft.message = "기록을 저장하는 중입니다…";
  draft.tone = "pending";
  renderNotes();

  try {
    // 수첩 기록 갱신 API 응답입니다.
    const payload = await fetchJson(`/api/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryType, title, body, rating }),
    });
    if (!isCurrentSession()) {
      return;
    }
    // 서버가 반환한 최신 수첩 기록입니다.
    const updatedRawNote = payload.note || payload.data;
    if (!updatedRawNote || typeof updatedRawNote !== "object") {
      throw new Error("missing updated note");
    }
    // 화면 구조로 정규화한 최신 수첩 기록입니다.
    const updatedNote = normalizeNote(updatedRawNote);
    state.requestVersions.notes += 1;
    state.notes = state.notes.map((item) => (item.id === noteId ? updatedNote : item));
    state.noteDrafts[noteId] = {
      ...createNoteDraft(updatedNote),
      isOpen: true,
      message: "일기·리뷰 기록을 저장했습니다.",
      tone: "success",
    };
  } catch (error) {
    if (!isCurrentSession() || isUnauthorizedError(error)) {
      return;
    }

    draft.pending = false;
    draft.message = Number(error?.status) === 404
      ? "이 수첩 기록을 찾을 수 없습니다. 목록을 새로고침하세요."
      : "기록을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.";
    draft.tone = "error";
  } finally {
    if (isCurrentSession()) {
      renderNotes();
    }
  }
}

/**
 * 입력: 수첩 기록과 목록 순번.
 * 출력: 일기·리뷰 편집 details HTMLElement.
 * 역할: 기록 종류, 제목, 본문, 리뷰 별점을 모바일 입력 폼으로 제공한다.
 * 호출 예시: const editor = createNoteEditor(note, 0)
 */
function createNoteEditor(note, noteIndex) {
  // 재렌더링 사이에 보존되는 현재 편집 상태입니다.
  const draft = getNoteDraft(note);
  // 입력 요소 ID 중복을 피하기 위한 접두사입니다.
  const fieldPrefix = `note-entry-${noteIndex}`;
  // 접고 펼칠 수 있는 편집 영역입니다.
  const details = createElement("details", "note-editor");
  details.open = Boolean(draft.isOpen);
  details.append(createElement("summary", "note-editor-summary", "일기·리뷰 작성 또는 수정"));

  // 기록 입력을 묶는 폼입니다.
  const form = createElement("form", "note-entry-form");
  form.setAttribute("aria-busy", draft.pending ? "true" : "false");

  // 기록 종류 선택 필드입니다.
  const typeField = createElement("label", "note-field");
  const typeLabel = createElement("span", "note-field-label", "기록 종류");
  const typeSelect = document.createElement("select");
  typeSelect.id = `${fieldPrefix}-type`;
  typeSelect.name = "entryType";
  [
    ["diary", "일기"],
    ["review", "리뷰"],
  ].forEach(([value, label]) => {
    // 기록 종류 선택지입니다.
    const option = createElement("option", "", label);
    option.value = value;
    option.selected = draft.type === value;
    typeSelect.append(option);
  });
  typeSelect.disabled = draft.pending;
  typeField.append(typeLabel, typeSelect);

  // 제목 입력 필드입니다.
  const titleField = createElement("label", "note-field");
  const titleLabel = createElement("span", "note-field-label", "제목 (선택)");
  const titleInput = document.createElement("input");
  titleInput.id = `${fieldPrefix}-title`;
  titleInput.name = "title";
  titleInput.type = "text";
  titleInput.maxLength = NOTE_ENTRY_TITLE_MAX_LENGTH;
  titleInput.value = draft.title;
  titleInput.placeholder = "탐험에서 기억하고 싶은 제목";
  titleInput.disabled = draft.pending;
  // 제목 글자 수 표시입니다.
  const titleCount = createElement("span", "note-character-count", `${draft.title.length}/${NOTE_ENTRY_TITLE_MAX_LENGTH}`);
  titleCount.id = `${fieldPrefix}-title-count`;
  titleInput.setAttribute("aria-describedby", titleCount.id);
  titleField.append(titleLabel, titleInput, titleCount);

  // 본문 입력 필드입니다.
  const bodyField = createElement("label", "note-field");
  const bodyLabel = createElement("span", "note-field-label", "본문 (필수)");
  const bodyInput = document.createElement("textarea");
  bodyInput.id = `${fieldPrefix}-body`;
  bodyInput.name = "body";
  bodyInput.rows = 6;
  bodyInput.required = true;
  bodyInput.maxLength = NOTE_ENTRY_BODY_MAX_LENGTH;
  bodyInput.value = draft.body;
  bodyInput.placeholder = "오늘의 탐험, 느낀 점, 다시 찾고 싶은 이유를 남겨보세요.";
  bodyInput.disabled = draft.pending;
  // 본문 글자 수 표시입니다.
  const bodyCount = createElement("span", "note-character-count", `${draft.body.length}/${NOTE_ENTRY_BODY_MAX_LENGTH}`);
  bodyCount.id = `${fieldPrefix}-body-count`;
  bodyInput.setAttribute("aria-describedby", bodyCount.id);
  bodyField.append(bodyLabel, bodyInput, bodyCount);

  // 리뷰일 때만 표시하는 별점 필드입니다.
  const ratingField = createElement("label", "note-field note-rating-field");
  const ratingLabel = createElement("span", "note-field-label", "별점 (필수)");
  const ratingSelect = document.createElement("select");
  ratingSelect.id = `${fieldPrefix}-rating`;
  ratingSelect.name = "rating";
  // 아직 별점을 선택하지 않은 상태를 위한 안내 선택지입니다.
  const emptyRatingOption = createElement("option", "", "별점을 선택하세요");
  emptyRatingOption.value = "";
  ratingSelect.append(emptyRatingOption);
  [1, 2, 3, 4, 5].forEach((value) => {
    // 1점부터 5점까지의 별점 선택지입니다.
    const option = createElement("option", "", `${value}점 ${"★".repeat(value)}`);
    option.value = String(value);
    option.selected = Number(draft.rating) === value;
    ratingSelect.append(option);
  });
  ratingField.append(ratingLabel, ratingSelect);

  // 저장 처리 결과를 스크린리더에도 알리는 상태 문구입니다.
  const status = createElement("p", `note-editor-status${draft.tone ? ` note-editor-status--${draft.tone}` : ""}`, draft.message);
  status.setAttribute("role", "status");
  // 수첩 기록 저장 버튼입니다.
  const saveButton = createElement("button", "card-action card-action--primary note-save-button", draft.pending ? "저장 중…" : "기록 저장");
  saveButton.type = "submit";
  saveButton.disabled = draft.pending;
  saveButton.setAttribute("aria-busy", draft.pending ? "true" : "false");

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 기록 종류에 맞춰 별점 입력의 노출과 필수 상태를 갱신한다.
   * 호출 예시: updateRatingField()
   */
  function updateRatingField() {
    // 현재 선택된 기록이 리뷰인지 여부입니다.
    const isReview = typeSelect.value === "review";
    ratingField.hidden = !isReview;
    ratingSelect.disabled = !isReview || draft.pending;
    ratingSelect.required = isReview;
  }

  updateRatingField();
  typeSelect.addEventListener("change", () => {
    draft.type = typeSelect.value === "review" ? "review" : "diary";
    draft.dirty = true;
    draft.message = "";
    draft.tone = "";
    updateRatingField();
  });
  titleInput.addEventListener("input", () => {
    draft.title = titleInput.value;
    draft.dirty = true;
    draft.message = "";
    draft.tone = "";
    titleCount.textContent = `${titleInput.value.length}/${NOTE_ENTRY_TITLE_MAX_LENGTH}`;
  });
  bodyInput.addEventListener("input", () => {
    draft.body = bodyInput.value;
    draft.dirty = true;
    draft.message = "";
    draft.tone = "";
    bodyCount.textContent = `${bodyInput.value.length}/${NOTE_ENTRY_BODY_MAX_LENGTH}`;
  });
  ratingSelect.addEventListener("change", () => {
    draft.rating = ratingSelect.value;
    draft.dirty = true;
    draft.message = "";
    draft.tone = "";
  });
  details.addEventListener("toggle", () => {
    draft.isOpen = details.open;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveNoteEntry(note.id);
  });

  form.append(typeField, titleField, bodyField, ratingField, status, saveButton);
  details.append(form);
  return details;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 모험가의 수첩 기록을 최신순 카드로 렌더링한다.
 * 호출 예시: renderNotes()
 */
function renderNotes() {
  // 수첩 목록 컨테이너입니다.
  const list = select("#note-list");

  if (!list) {
    return;
  }

  list.replaceChildren();
  if (state.notes.length === 0) {
    // API가 정상 반환한 빈 수첩 상태입니다.
    const emptyState = createElement("section", "note-empty-state");
    emptyState.append(
      createElement("h3", "", "아직 탐험 기록이 없습니다"),
      createElement("p", "empty-message", "퀘스트를 완료하면 인증 사진과 일기·리뷰를 이곳에 차곡차곡 남길 수 있습니다."),
    );
    list.append(emptyState);
    return;
  }

  state.notes.forEach((note, noteIndex) => {
    // 수첩 기록 카드 요소입니다.
    const card = createElement("article", "note-card");
    // 수첩 아이콘 요소입니다.
    const icon = createElement("span", "note-icon", "▤");
    icon.setAttribute("aria-hidden", "true");
    // 수첩 텍스트 묶음입니다.
    const copy = createElement("div", "note-copy");
    // 날짜와 획득 경험치를 묶는 상단 행입니다.
    const topline = createElement("div", "note-topline");
    topline.append(createElement("span", "note-date", formatDate(note.createdAt)), createElement("span", "category-tag", `${note.earnedXp} XP`));

    // 완료한 퀘스트 제목입니다.
    const title = createElement("h3", "", note.title);
    // 완료 장소 이름입니다.
    const place = createElement("p", "card-place", note.placeName);
    // 시스템이 만든 퀘스트 완료 요약입니다.
    const memo = createElement("p", "card-description", note.memo);
    // 완료로 획득한 뱃지 목록입니다.
    const badges = createElement("div", "note-badges");

    note.badges.forEach((badge) => {
      badges.append(createElement("span", "", String(badge)));
    });

    copy.append(topline, title, place, memo);
    if (note.badges.length > 0) {
      copy.append(badges);
    }
    if (note.photoRef) {
      copy.append(createNotePhoto(note));
    }
    if (state.notesSource === "api") {
      copy.append(createNoteEntryDisplay(note), createNoteEditor(note, noteIndex));
    } else {
      copy.append(createElement("p", "note-entry-empty", "API에 연결하면 실제 탐험 기록에 일기와 리뷰를 남길 수 있습니다."));
    }
    card.append(icon, copy);
    list.append(card);
  });
}

/**
 * 입력: 꿈돌이 img 요소와 화면별 클래스 이름.
 * 출력: 없음.
 * 역할: 이미지의 실제 크기를 읽어 세로형과 일반형 표시 규칙을 자동 적용한다.
 * 호출 예시: configureGgumdoriArtwork(image, "ggumdori-card-art")
 */
function configureGgumdoriArtwork(image, contextClass) {
  image.classList.add("ggumdori-art", contextClass);

  const applyAspectClass = () => {
    if (!image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const isPortrait = image.naturalHeight / image.naturalWidth >= 1.25;
    image.classList.toggle("ggumdori-art--portrait", isPortrait);
    image.classList.toggle("ggumdori-art--standard", !isPortrait);
    image.classList.add("is-aspect-ready");
  };

  image.addEventListener("load", applyAspectClass, { once: true });
  if (image.complete) {
    applyAspectClass();
  }
}

/* ──────────────────────────────────────────────
   S09 꿈돌이 도감 · S10 도감 상세 (명세 §5.2, §5.3, §5.4, §10 S09·S10)
   ────────────────────────────────────────────── */

/**
 * 입력: 도감 API 원본 항목.
 * 출력: 화면에서 사용하는 도감 항목.
 * 역할: 서버 CatalogEntry 를 한 가지 모양으로 맞춘다. (명세 §16.3)
 * 호출 예시: normalizeCatalogEntry(rawEntry)
 */
function normalizeCatalogEntry(rawEntry) {
  // 도감 항목 원본입니다.
  const entry = rawEntry || {};
  // 퀘스트에 1:1:1 로 묶인 보상 쌍입니다. (명세 §5.1)
  const rewardPair = entry.rewardPair || {};

  return {
    questId: String(entry.questId || ""),
    // 도감의 식별자는 꿈돌이 id 입니다. 대표 설정과 홈 표시가 이 값을 씁니다.
    ggumdoriId: String(rewardPair.ggumdoriId || entry.ggumdoriId || ""),
    ggumdoriName: String(rewardPair.ggumdoriName || entry.ggumdoriName || "꿈돌이"),
    ggumdoriImageRef: String(rewardPair.ggumdoriStillImageRef || entry.ggumdoriStillImageRef || ""),
    badgeName: String(rewardPair.badgeName || entry.badgeName || "탐험 뱃지"),
    badgeImageRef: String(rewardPair.badgeImageRef || entry.badgeImageRef || ""),
    category: normalizeCategory(entry.category || rewardPair.category || "all"),
    // locked | earned | unavailable. 종료된 퀘스트도 슬롯을 유지합니다. (명세 §5.2)
    state: normalizeCatalogState(entry.state),
    unlockedAt: String(entry.unlockedAt || ""),
    equipped: Boolean(entry.equipped),
    questTitle: String(entry.questTitle || ""),
    placeName: String(entry.placeName || ""),
    unlockDescription: String(entry.unlockDescription || "연결된 퀘스트를 완료하면 얻을 수 있어요."),
    catalogOrder: toNumber(entry.catalogOrder, 0),
    // 이 도감 항목으로 이동할 수 있는 퀘스트 인스턴스입니다. "이 퀘스트 보기"에 씁니다.
    instanceId: String(entry.instanceId || ""),
  };
}

/**
 * 입력: 서버가 준 도감 상태 값.
 * 출력: locked | earned | unavailable 중 하나.
 * 역할: 상태 값을 세 가지로 좁힌다. (명세 §16.3)
 * 호출 예시: normalizeCatalogState("earned")
 */
function normalizeCatalogState(rawState) {
  // 소문자로 맞춘 상태 값입니다.
  const value = String(rawState || "").toLowerCase();

  if (value === "earned" || value === "unavailable") {
    return value;
  }

  return "locked";
}

/**
 * 입력: 도감 API 응답 본문.
 * 출력: 화면에서 사용하는 CatalogPage.
 * 역할: 전체 수를 클라이언트가 세지 않고 서버값을 그대로 쓴다. (명세 §5.2)
 * 호출 예시: normalizeCatalogPage(payload)
 */
function normalizeCatalogPage(payload) {
  // 응답이 data 로 감싸여 온 경우의 실제 본문입니다.
  const body = payload?.data || payload || {};
  // 정규화한 도감 항목 목록입니다.
  const entries = unwrapList(body.entries || body).map(normalizeCatalogEntry);

  return {
    earnedCount: toNumber(body.earnedCount, entries.filter((item) => item.state === "earned").length),
    totalCount: toNumber(body.totalCount, entries.length),
    entries,
    nextCursor: String(body.nextCursor || ""),
  };
}

/**
 * 입력: 없음.
 * 출력: 서버의 꿈돌이와 뱃지 상태로 만든 도감 페이지.
 * 역할: 서버 보유 variant id와 해금 상태를 정본으로 사용합니다.
 * 호출 예시: state.catalog = buildServerCatalog()
 */
function buildServerCatalog() {
  const entries = state.ggumdori.map((item, index) => {
    const category = normalizeCategory(item.themeCategory);
    const badge = state.badges.find(
      (candidate) => normalizeCategory(candidate.category) === category && candidate.tier === item.tier,
    );

    return normalizeCatalogEntry({
      questId: "",
      ggumdoriId: item.id,
      ggumdoriName: item.name,
      ggumdoriStillImageRef: item.imageRef,
      badgeName: badge?.name || CATEGORY_LABELS[category] || "탐험 뱃지",
      category,
      state: item.unlocked ? "earned" : "locked",
      unlockedAt: item.unlockedAt || "",
      equipped: item.id === state.selectedGgumdoriId,
      unlockDescription: item.condition,
      catalogOrder: index,
    });
  });

  return {
    earnedCount: entries.filter((item) => item.state === "earned").length,
    totalCount: entries.length,
    entries,
    nextCursor: "",
  };
}

/**
 * 입력: 없음.
 * 출력: 목업 도감 페이지.
 * 역할: 서버가 없을 때 퀘스트의 rewardPair 로 도감을 만든다. 도감은 퀘스트에서 파생된다. (명세 §5.1, §5.2)
 * 호출 예시: state.catalog = buildFallbackCatalog()
 */
function buildFallbackCatalog() {
  // 도감 항목 목록입니다. 등록 순서를 안정적으로 유지합니다. (명세 §10 S09)
  const entries = [];
  // 이미 담은 꿈돌이 id 모음입니다. 같은 꿈돌이를 두 번 넣지 않습니다.
  const seen = new Set();

  // 1. 퀘스트에 묶인 보상 쌍을 먼저 등록합니다. 1:1:1 이 도감의 정본입니다.
  state.recommendations.forEach((quest) => {
    // 이 퀘스트의 보상 쌍입니다.
    const rewardPair = quest.rewardPair || {};
    if (!rewardPair.ggumdoriId || seen.has(rewardPair.ggumdoriId)) {
      return;
    }
    seen.add(rewardPair.ggumdoriId);

    // 이 퀘스트의 현재 진행 상태입니다.
    const questStatus = getQuestStatus(quest.instanceId, quest.status);
    // 완료한 퀘스트의 보상만 획득 상태입니다.
    const isEarned = questStatus === "completed" || questStatus === "done";

    entries.push(
      normalizeCatalogEntry({
        questId: quest.questId,
        instanceId: quest.instanceId,
        rewardPair,
        category: quest.category,
        state: isEarned ? "earned" : "locked",
        questTitle: quest.questTitle,
        placeName: quest.placeName,
        unlockDescription: `${quest.placeName}에서 ${quest.questTitle}을 완료하면 얻어요.`,
        catalogOrder: entries.length,
      }),
    );
  });

  // 2. 퀘스트에 아직 연결되지 않은 기존 꿈돌이 에셋도 슬롯을 유지합니다. (명세 §5.2)
  FALLBACK_GGUMDORI.forEach((item) => {
    if (seen.has(item.id)) {
      return;
    }
    seen.add(item.id);

    entries.push(
      normalizeCatalogEntry({
        questId: `legacy-${item.id}`,
        rewardPair: {
          ggumdoriId: item.id,
          ggumdoriName: item.name,
          ggumdoriStillImageRef: item.imageRef,
          badgeName: item.name,
        },
        category: item.themeCategory,
        state: item.unlocked ? "earned" : "locked",
        questTitle: "",
        placeName: "",
        unlockDescription: item.condition,
        catalogOrder: entries.length,
      }),
    );
  });

  return {
    earnedCount: entries.filter((item) => item.state === "earned").length,
    totalCount: entries.length,
    entries,
    nextCursor: "",
  };
}

/**
 * 입력: 이어 받을 커서. 비우면 첫 페이지입니다.
 * 출력: 도감 로드 Promise.
 * 역할: /api/catalog 를 호출하고 실패하면 퀘스트에서 파생한 도감을 쓴다. (명세 §5.2)
 * 호출 예시: await loadCatalog()
 */
async function loadCatalog(_cursor = "") {
  state.catalog = buildServerCatalog();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 대표 꿈돌이 표시가 도감과 같은 목록을 보게 맞춘다. (명세 §5.4)
 * 호출 예시: syncGgumdoriFromCatalog()
 */
function syncGgumdoriFromCatalog() {
  if (state.catalog.entries.length === 0) {
    return;
  }

  state.ggumdori = state.catalog.entries.map((entry) => ({
    id: entry.ggumdoriId,
    name: entry.ggumdoriName,
    themeCategory: entry.category,
    unlocked: entry.state === "earned",
    condition: entry.unlockDescription,
    imageRef: entry.ggumdoriImageRef,
  }));
}

/**
 * 입력: 없음.
 * 출력: 검색·상태·카테고리 필터를 통과한 도감 항목.
 * 역할: 정렬은 서버의 등록 순서를 기본값으로 유지한다. (명세 §10 S09)
 * 호출 예시: const entries = getVisibleCatalogEntries()
 */
function getVisibleCatalogEntries() {
  // 소문자로 맞춘 검색어입니다.
  const keyword = state.catalogSearch.trim().toLowerCase();

  return state.catalog.entries.filter((entry) => {
    if (state.catalogStatusFilter === "earned" && entry.state !== "earned") {
      return false;
    }
    if (state.catalogStatusFilter === "locked" && entry.state === "earned") {
      return false;
    }
    if (state.catalogCategory !== "all" && entry.category !== state.catalogCategory) {
      return false;
    }
    if (!keyword) {
      return true;
    }

    // 꿈돌이 이름과 퀘스트 이름을 함께 검색합니다. (명세 §10 S09)
    return (
      entry.ggumdoriName.toLowerCase().includes(keyword) ||
      entry.questTitle.toLowerCase().includes(keyword) ||
      entry.placeName.toLowerCase().includes(keyword)
    );
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 획득 수·전체 수, 필터, 3열 그리드를 그린다. (명세 §10 S09)
 * 호출 예시: renderCollection()
 */
function renderCollection() {
  // 꿈돌이 그리드 컨테이너입니다.
  const grid = select("#ggumdori-grid");

  if (!grid) {
    return;
  }

  // 획득 수와 전체 수 표시입니다. 전체 수는 서버값을 그대로 씁니다. (명세 §5.2)
  const countElement = select("#collection-count");
  if (countElement) {
    countElement.textContent = `${state.catalog.earnedCount} / ${state.catalog.totalCount}`;
  }

  // 현재 홈 대표 꿈돌이 표시입니다. (명세 §5.4)
  const featuredElement = select("#collection-featured");
  if (featuredElement) {
    // 대표로 설정된 도감 항목입니다.
    const featured = state.catalog.entries.find(
      (item) => item.ggumdoriId === state.selectedGgumdoriId && item.state === "earned",
    );
    featuredElement.textContent = featured
      ? localize(`대표 ${featured.ggumdoriName}`, `Featured ${UI_STRINGS_EN[featured.ggumdoriName] || featured.ggumdoriName}`)
      : localize("대표 미설정", "No featured character set");
  }

  // 필터 버튼의 현재 선택을 반영합니다.
  document.querySelectorAll("[data-collection-filter]").forEach((button) => {
    // 이 버튼이 나타내는 상태 필터입니다.
    const buttonFilter = button.dataset.collectionFilter || "all";
    button.classList.toggle("is-active", buttonFilter === state.catalogStatusFilter);
    button.setAttribute("aria-pressed", buttonFilter === state.catalogStatusFilter ? "true" : "false");
  });

  document.querySelectorAll("[data-collection-category]").forEach((button) => {
    // 이 버튼이 나타내는 카테고리입니다.
    const buttonCategory = button.dataset.collectionCategory || "all";
    button.classList.toggle("is-active", buttonCategory === state.catalogCategory);
    button.setAttribute("aria-pressed", buttonCategory === state.catalogCategory ? "true" : "false");
  });

  // 현재 필터를 통과한 도감 항목입니다.
  const entries = getVisibleCatalogEntries();

  grid.replaceChildren();

  if (entries.length === 0) {
    grid.append(createElement("p", "empty-message", "조건에 맞는 꿈돌이가 없습니다."));
    return;
  }

  entries.forEach((entry) => grid.append(createCatalogCard(entry)));

  // 서버가 다음 커서를 주면 이어서 받을 수 있게 합니다. (명세 §10 S09)
  if (state.catalog.nextCursor) {
    const moreButton = createElement("button", "px-button px-button--ghost catalog-more", "더 보기");
    moreButton.type = "button";
    moreButton.addEventListener("click", async () => {
      moreButton.disabled = true;
      moreButton.textContent = "불러오는 중";
      await loadCatalog(state.catalog.nextCursor);
      renderCollection();
    });
    grid.append(moreButton);
  }
}

/**
 * 입력: 도감 항목.
 * 출력: 도감 카드 요소.
 * 역할: 꿈돌이, 미니 뱃지, 짧은 이름, 획득 상태를 한 칸에 담는다. (명세 §10 S09)
 * 호출 예시: createCatalogCard(entry)
 */
function createCatalogCard(entry) {
  // 획득한 항목인지 여부입니다.
  const isEarned = entry.state === "earned";
  // 현재 홈 대표로 설정된 항목인지 여부입니다. (명세 §5.4)
  const isFeatured = isEarned && state.selectedGgumdoriId === entry.ggumdoriId;

  // 카드 전체가 상세를 여는 버튼입니다. (명세 §5.3)
  const card = createElement("button", `catalog-card${isEarned ? "" : " is-locked"}`);
  card.type = "button";
  card.dataset.category = entry.category;
  card.dataset.catalogTarget = entry.ggumdoriId;

  // 꿈돌이 그림 자리입니다.
  const art = createElement("div", "catalog-card__art");
  if (entry.ggumdoriImageRef) {
    const image = document.createElement("img");
    image.src = entry.ggumdoriImageRef;
    image.alt = "";
    image.loading = "lazy";
    art.append(image);
  } else {
    art.append(createElement("span", "catalog-card__placeholder", isEarned ? entry.ggumdoriName.slice(0, 1) : "?"));
  }

  // 잠금 표시는 무채색·딤·자물쇠·물음표·미획득을 함께 씁니다. (명세 §5.3)
  if (!isEarned) {
    const lock = createElement("div", "catalog-card__lock");
    const lockIcon = createElement("span", "px-icon px-icon--sm", "lock");
    lockIcon.setAttribute("aria-hidden", "true");
    lock.append(lockIcon, createElement("span", "catalog-card__question", "?"));
    art.append(lock);
  }

  // 대표 꿈돌이는 별표와 대표 텍스트를 함께 표시합니다. (명세 §10 S09)
  if (isFeatured) {
    const featured = createElement("span", "catalog-card__featured");
    const star = createElement("span", "px-icon px-icon--sm", "star");
    star.setAttribute("aria-hidden", "true");
    featured.append(star, createElement("span", "", "대표"));
    art.append(featured);
  }

  card.append(art);

  // 미니 뱃지와 짧은 이름입니다.
  const meta = createElement("div", "catalog-card__meta");
  if (entry.badgeImageRef) {
    const badge = document.createElement("img");
    badge.className = "catalog-card__badge";
    badge.src = entry.badgeImageRef;
    badge.alt = "";
    badge.loading = "lazy";
    meta.append(badge);
  }
  meta.append(createElement("span", "catalog-card__name", entry.ggumdoriName));
  card.append(meta);

  // 획득 상태를 텍스트로도 표시합니다. 색만으로 구분하지 않습니다. (명세 §3.2)
  card.append(createElement("span", "catalog-card__state", getCatalogStateLabel(entry.state)));

  return card;
}

/**
 * 입력: 도감 상태 값.
 * 출력: 화면에 표시할 상태 문구.
 * 역할: 획득·미획득·획득 불가를 한국어로 알린다. (명세 §5.2, §5.3)
 * 호출 예시: getCatalogStateLabel("unavailable")
 */
function getCatalogStateLabel(catalogState) {
  if (catalogState === "earned") {
    return "획득";
  }
  if (catalogState === "unavailable") {
    return "현재 획득 불가";
  }

  return "미획득";
}

/**
 * 입력: 꿈돌이 식별자.
 * 출력: 없음.
 * 역할: 도감 상세 시트를 연다. (명세 §10 S10)
 * 호출 예시: openCatalogSheet("science-1")
 */
function openCatalogSheet(ggumdoriId) {
  if (!ggumdoriId) {
    return;
  }

  // 시트를 열기 전 포커스가 있던 요소입니다. 닫을 때 되돌립니다.
  state.catalogSheetReturnFocus = document.activeElement;
  state.catalogSheetId = ggumdoriId;
  state.catalogMessage = "";
  renderCatalogSheet();
  renderPhotoSheet();
  renderSettings();
  renderRecordSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 도감 상세 시트를 닫고 포커스를 되돌린다.
 * 호출 예시: closeCatalogSheet()
 */
function closeCatalogSheet() {
  if (!state.catalogSheetId) {
    return;
  }

  state.catalogSheetId = "";
  state.catalogMessage = "";
  renderCatalogSheet();

  // 포커스는 시트를 열었던 카드로 되돌립니다.
  const target = state.catalogSheetReturnFocus;
  if (target instanceof HTMLElement && target.isConnected) {
    target.focus({ preventScroll: true });
  }
  state.catalogSheetReturnFocus = null;
}

/**
 * 입력: 없음.
 * 출력: 현재 시트가 보여 주는 도감 항목 또는 null.
 * 역할: 시트와 버튼 처리가 같은 항목을 보게 한다.
 * 호출 예시: const entry = getCatalogSheetTarget()
 */
function getCatalogSheetTarget() {
  return state.catalog.entries.find((item) => item.ggumdoriId === state.catalogSheetId) || null;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 미획득과 획득을 다르게 보여 주는 도감 상세를 그린다. (명세 §10 S10)
 * 호출 예시: renderCatalogSheet()
 */
function renderCatalogSheet() {
  // 시트 컨테이너입니다.
  const sheet = select("#catalog-sheet");

  if (!sheet) {
    return;
  }

  // 현재 시트가 보여 줄 도감 항목입니다.
  const entry = getCatalogSheetTarget();

  if (!entry) {
    sheet.hidden = true;
    sheet.replaceChildren();
    delete document.body.dataset.catalogSheetOpen;
    return;
  }

  // 획득한 항목인지 여부입니다.
  const isEarned = entry.state === "earned";

  sheet.hidden = false;
  document.body.dataset.catalogSheetOpen = "true";
  sheet.replaceChildren();

  // 배경을 덮는 딤 레이어입니다. 눌러서 닫습니다.
  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closeCatalogSheet);

  // 시트 본체입니다. 퀘스트 상세와 같은 구조를 씁니다.
  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "catalog-sheet-title");

  // 상단 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", entry.ggumdoriName);
  title.id = "catalog-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  const tags = createElement("div", "quest-sheet__tags");
  const categoryTag = createElement("span", "px-tag", CATEGORY_LABELS[entry.category] || "테마");
  categoryTag.dataset.category = entry.category;
  tags.append(
    categoryTag,
    createElement(
      "span",
      isEarned ? "status-badge status-badge--done" : "status-badge status-badge--locked",
      getCatalogStateLabel(entry.state),
    ),
  );

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "도감 상세 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closeCatalogSheet);

  head.append(titleGroup, tags, closeButton);

  // 가운데 스크롤 영역입니다.
  const body = createElement("div", "quest-sheet__body");

  // 큰 꿈돌이 그림입니다. 미획득은 무채색으로 보여 줍니다. (명세 §5.3, §10 S10)
  const figure = createElement("div", `catalog-detail__art${isEarned ? "" : " is-locked"}`);
  if (entry.ggumdoriImageRef) {
    const image = document.createElement("img");
    image.src = entry.ggumdoriImageRef;
    image.alt = isEarned
      ? entry.ggumdoriName
      : localize(`${entry.ggumdoriName} 미획득`, `${UI_STRINGS_EN[entry.ggumdoriName] || entry.ggumdoriName} (not yet earned)`);
    figure.append(image);
  }
  if (!isEarned) {
    const lock = createElement("span", "catalog-detail__lock");
    const lockIcon = createElement("span", "px-icon", "lock");
    lockIcon.setAttribute("aria-hidden", "true");
    lock.append(lockIcon);
    figure.append(lock);
  }
  body.append(figure);

  // 미니 뱃지와 획득일입니다.
  const badgeRow = createElement("section", "px-panel px-panel--inset catalog-detail__badge-row");
  if (entry.badgeImageRef) {
    const badge = document.createElement("img");
    badge.className = "catalog-detail__badge";
    badge.src = entry.badgeImageRef;
    badge.alt = "";
    badgeRow.append(badge);
  }
  const badgeMeta = createElement("div", "catalog-detail__badge-meta");
  badgeMeta.append(createElement("span", "px-label", entry.badgeName));
  badgeMeta.append(
    createElement(
      "span",
      "px-body",
      isEarned ? (entry.unlockedAt ? `${formatDate(entry.unlockedAt)} 획득` : "획득함") : "미획득",
    ),
  );
  badgeRow.append(badgeMeta);
  body.append(badgeRow);

  // 연결 퀘스트와 관광지입니다.
  if (entry.questTitle || entry.placeName) {
    const questPanel = createElement("section", "px-panel");
    questPanel.append(createElement("h3", "section-title", "연결 퀘스트"));
    if (entry.questTitle) {
      questPanel.append(createElement("p", "px-label", entry.questTitle));
    }
    if (entry.placeName) {
      questPanel.append(createElement("p", "px-body", entry.placeName));
    }
    body.append(questPanel);
  }

  // 미획득은 해금 조건을, 보유 보상은 서버에 기록된 획득일을 보여 줍니다.
  const conditionPanel = createElement("section", "px-panel");
  conditionPanel.append(createElement("h3", "section-title", isEarned ? "획득 기록" : "해금 조건"));
  conditionPanel.append(
    createElement(
      "p",
      "px-body",
      isEarned
        ? entry.unlockedAt
          ? `${formatDate(entry.unlockedAt)}에 이 꿈돌이를 획득했어요.`
          : "보유한 꿈돌이입니다."
        : entry.unlockDescription,
    ),
  );
  body.append(conditionPanel);

  // 대표 설정 결과 등을 알리는 문구입니다.
  const message = createElement("p", "data-note quest-sheet__message", state.catalogMessage);
  message.setAttribute("aria-live", "polite");
  body.append(message);

  // 하단 고정 버튼 영역입니다.
  const footer = createElement("div", "quest-sheet__cta catalog-detail__cta");

  if (isEarned) {
    // 현재 대표인지 여부입니다. 현재 대표에서는 버튼을 상태 표시로 바꿉니다. (명세 §10 S10)
    const isFeatured = state.selectedGgumdoriId === entry.ggumdoriId;
    const featureButton = createElement(
      "button",
      "px-button px-button--primary",
      isFeatured ? "현재 홈 대표" : "홈 대표 꿈돌이로 설정",
    );
    featureButton.type = "button";
    featureButton.disabled = isFeatured;
    featureButton.addEventListener("click", () => setFeaturedGgumdori(entry));

    // 획득한 꿈돌이만 2D 촬영을 할 수 있습니다. (명세 §10 S10·S11)
    const photoButton = createElement("button", "px-button px-button--ghost", "사진 찍기");
    photoButton.type = "button";
    photoButton.addEventListener("click", () => {
      // 도감 상세를 닫고 촬영 화면으로 넘어갑니다.
      const targetId = entry.ggumdoriId;
      closeCatalogSheet();
      openPhotoSheet(targetId);
    });

    footer.append(featureButton, photoButton);
  } else if (entry.instanceId) {
    // 미획득은 연결 퀘스트로 보냅니다. (명세 §5.3, §10 S10)
    const questButton = createElement("button", "px-button px-button--primary", "이 퀘스트 보기");
    questButton.type = "button";
    questButton.addEventListener("click", () => {
      // 도감 상세를 닫고 퀘스트 상세를 엽니다.
      const targetInstanceId = entry.instanceId;
      closeCatalogSheet();
      setActiveView("quests");
      openQuestSheet(targetInstanceId);
    });
    footer.append(questButton);
  } else {
    footer.append(createElement("p", "data-note", "아직 연결된 퀘스트가 없어요."));
  }

  panel.append(head, body, footer);
  sheet.append(scrim, panel);

  // 열자마자 제목으로 포커스를 옮겨 스크린리더가 시트를 읽게 합니다.
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#catalog-sheet-title")?.focus({ preventScroll: true });
}

/**
 * 입력: 도감 항목.
 * 출력: 없음.
 * 역할: 홈 대표 꿈돌이를 바꾸고 즉시 반영한다. (명세 §5.4, §10 S10)
 * 호출 예시: setFeaturedGgumdori(entry)
 */
async function setFeaturedGgumdori(entry) {
  // 저장 중 계정이 바뀌면 결과 안내도 새 화면에 남기지 않습니다.
  const isCurrentSession = captureSession();
  if (entry.state !== "earned") {
    return;
  }

  state.catalogMessage = "대표 꿈돌이를 저장하는 중입니다.";
  renderCatalogSheet();
  const saved = await saveFeaturedGgumdori(entry.ggumdoriId);
  if (!isCurrentSession()) {
    return;
  }
  if (!saved) {
    state.catalogMessage = "대표 꿈돌이를 저장하지 못했어요.";
    renderCatalogSheet();
    return;
  }

  state.selectedGgumdoriId = entry.ggumdoriId;
  writeStorageValue(SELECTED_GGUMDORI_KEY, entry.ggumdoriId);
  state.catalog.entries.forEach((item) => {
    item.equipped = item.ggumdoriId === entry.ggumdoriId;
  });
  state.catalogMessage = "홈 대표 꿈돌이를 바꿨어요.";
  renderAll();
}

/**
 * 입력: 꿈돌이 식별자.
 * 출력: 저장 Promise.
 * 역할: 대표 꿈돌이를 서버에 저장한다. (명세 §5.4)
 * 호출 예시: saveFeaturedGgumdori("science-1")
 */
async function saveFeaturedGgumdori(ggumdoriId) {
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  try {
    await fetchJson("/api/me/ggumdori", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedGgumdoriId: ggumdoriId }),
    });
    return sessionVersion === state.sessionVersion && accessToken === state.accessToken;
  } catch (error) {
    if (sessionVersion === state.sessionVersion && accessToken === state.accessToken) {
      updateSystemStatus(state.apiHealthy, "대표 꿈돌이를 서버에 저장하지 못했어요");
    }
    return false;
  }
}

/* ──────────────────────────────────────────────
   게스트 계정과 소셜 승계 (명세 §9.3, §9.4, §10 S02·S12)
   ────────────────────────────────────────────── */

/**
 * 입력: 없음.
 * 출력: 추천 닉네임 문자열.
 * 역할: 중복을 허용하므로 확인 API 없이 즉석에서 이름을 제안한다. (명세 §9.4)
 * 호출 예시: const nickname = suggestNickname()
 */
function suggestNickname() {
  // 앞뒤 조각을 하나씩 골라 붙입니다. 국문/영문 배열은 같은 순서로 대응하므로 인덱스를
  // 공유해서 현재 화면 언어에 맞는 쪽을 고릅니다.
  const prefixIndex = Math.floor(Math.random() * NICKNAME_PREFIXES.length);
  const nounIndex = Math.floor(Math.random() * NICKNAME_NOUNS.length);
  // 뽑은 인덱스를 기억해 둡니다. 언어를 토글했을 때 새로 랜덤 추첨하지 않고, 같은 조합을
  // 다른 언어 단어로만 다시 조립할 수 있게 하기 위해서입니다(formatNicknameSuggestion 참고).
  state.nicknameSuggestionIndices = { prefixIndex, nounIndex };
  return formatNicknameSuggestion(prefixIndex, nounIndex);
}

/**
 * 입력: 형용사/명사 인덱스.
 * 출력: 현재 화면 언어에 맞는 닉네임 제안 문자열.
 * 역할: suggestNickname()과 언어 토글 재조립이 같은 조립 로직을 쓰게 한다.
 * 호출 예시: formatNicknameSuggestion(0, 5)
 */
function formatNicknameSuggestion(prefixIndex, nounIndex) {
  const prefix = localize(NICKNAME_PREFIXES[prefixIndex], NICKNAME_PREFIXES_EN[prefixIndex]);
  const noun = localize(NICKNAME_NOUNS[nounIndex], NICKNAME_NOUNS_EN[nounIndex]);
  return `${prefix} ${noun}`;
}

/**
 * 입력: 저장된 닉네임(국문 또는 영문 제안값 형태일 수 있음).
 * 출력: 현재 화면 언어에 맞는 닉네임. 제안 조합이 아니면 원본 그대로.
 * 역할: 확정해 저장한 닉네임이 "형용사 명사" 자동 제안 조합(64가지)과 정확히 일치하면
 *       같은 조합을 현재 언어 단어로 다시 조립해 보여준다. 사용자가 직접 입력한 커스텀
 *       닉네임은 어느 목록과도 안 맞으니 그대로 남는다(번역할 사전이 없어서 자연스러운 동작).
 * 호출 예시: displayNickname(state.user.nickname)
 */
function displayNickname(nickname) {
  const text = String(nickname || "").trim();
  if (!text) {
    return text;
  }
  // 변수 의미: (명사 목록, 그 명사 목록과 짝지어진 형용사 목록) 쌍입니다. 저장된 닉네임이
  // 국문으로 됐던 영문으로 됐던 둘 다 검사해야 하므로 두 언어를 모두 확인합니다.
  const nounLists = [
    { nouns: NICKNAME_NOUNS, prefixes: NICKNAME_PREFIXES },
    { nouns: NICKNAME_NOUNS_EN, prefixes: NICKNAME_PREFIXES_EN },
  ];
  for (const { nouns, prefixes } of nounLists) {
    for (let nounIndex = 0; nounIndex < nouns.length; nounIndex += 1) {
      const noun = nouns[nounIndex];
      if (!text.endsWith(` ${noun}`)) {
        continue;
      }
      // 변수 의미: 명사를 뗀 나머지, 형용사여야 합니다.
      const prefixText = text.slice(0, text.length - noun.length - 1).trim();
      const prefixIndex = prefixes.indexOf(prefixText);
      if (prefixIndex !== -1) {
        return formatNicknameSuggestion(prefixIndex, nounIndex);
      }
    }
  }
  return text;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 동의를 마친 뒤 공통 닉네임 설정 단계로 넘어간다. (명세 §10 S02 3단계)
 * 호출 예시: enterNicknameStep()
 */
function enterNicknameStep() {
  state.accountStep = "nickname";
  state.nicknameDraft = state.nicknameDraft || suggestNickname();
  renderAccountStep();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 동의 단계와 닉네임 단계 중 하나만 보여 준다. (명세 §10 S02)
 * 호출 예시: renderAccountStep()
 */
function renderAccountStep() {
  // 동의 항목과 계정 선택을 담은 영역입니다.
  const consentStep = select("#consent-step");
  // 닉네임 설정 영역입니다.
  const nicknameStep = select("#nickname-step");

  if (!consentStep || !nicknameStep) {
    return;
  }

  // 닉네임 단계인지 여부입니다.
  const isNicknameStep = state.accountStep === "nickname";

  consentStep.hidden = isNicknameStep;
  nicknameStep.hidden = !isNicknameStep;

  // 닉네임 입력 칸입니다.
  const input = select("#nickname-input");
  if (input instanceof HTMLInputElement && input.value !== state.nicknameDraft) {
    input.value = state.nicknameDraft;
  }
}

/**
 * 입력: 없음.
 * 출력: 닉네임 저장 Promise.
 * 역할: 닉네임을 확정하고 홈으로 들어간다. 중복은 허용한다. (명세 §9.4)
 * 호출 예시: await confirmNickname()
 */
async function confirmNickname() {
  // 사용자가 확정한 닉네임입니다.
  const nickname = (state.nicknameDraft || "").trim();

  if (!nickname) {
    setConsentMessage("닉네임을 입력하거나 추천을 받아주세요.");
    return;
  }

  if (!await saveNickname(nickname)) {
    return;
  }
  state.accountStep = "consent";
  setConsentPanelVisible(false);
  setConsentMessage("");
  renderAll();
}

/**
 * 입력: 닉네임 문자열.
 * 출력: 현재 세션의 저장 성공 여부 Promise.
 * 역할: 서버가 저장을 확인한 뒤 닉네임과 성공 안내를 갱신합니다.
 * 호출 예시: await saveNickname("씩씩한 꿈돌이")
 */
async function saveNickname(nickname) {
  // 닉네임 저장을 시작한 계정의 유효성을 확인합니다.
  const isCurrentSession = captureSession();
  if (!isCurrentSession() || state.nicknamePending) {
    return false;
  }
  state.nicknamePending = true;
  state.accountMessage = "닉네임을 저장하는 중입니다.";
  try {
    // 명시적 디자인 미리보기 이외에는 실제 서버의 저장 응답이 필요합니다.
    const payload = IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW
      ? { user: { nickname } }
      : await fetchJson("/api/me/nickname", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
    if (!isCurrentSession()) {
      return false;
    }
    if (!payload.user?.nickname) {
      throw new Error("missing saved nickname");
    }
    state.requestVersions.user += 1;
    state.user = { ...state.user, nickname: payload.user.nickname };
    state.accountMessage = "닉네임을 바꿨어요.";
    return true;
  } catch (error) {
    if (isCurrentSession()) {
      state.accountMessage = "닉네임을 저장하지 못했어요. 20자 이내로 입력하고 다시 시도해주세요.";
      setConsentMessage(state.accountMessage);
      renderAccountPanel();
    }
    return false;
  } finally {
    if (isCurrentSession()) {
      state.nicknamePending = false;
    }
  }
}

/**
 * 입력: provider 이름("naver" 또는 "google").
 * 출력: 연결 시작 Promise.
 * 역할: 게스트 토큰을 보관한 채 소셜 계정 연결을 시작한다. (명세 §9.3)
 * 호출 예시: await startAccountLink("naver")
 */
async function startAccountLink(provider) {
  if (state.user.accountType === "social" || !state.authProviders[provider]) {
    state.accountMessage = state.authProviders[provider]
      ? ""
      : "이 로그인 방식은 서버 설정이 완료된 뒤 사용할 수 있어요.";
    renderAccountPanel();
    return;
  }

  state.accountLinkState = "pending";
  state.accountMessage = "새 계정으로 로그인합니다. 공용 체험 기록은 이전되지 않습니다.";
  renderAccountPanel();
  await handleOAuthLogin(provider);
}

/**
 * 입력: 없음.
 * 출력: 관심사 저장과 대전 전체 관광지 조회 패널.
 * 역할: 기존 6개 관심사를 마이페이지의 기존 시각 스타일로 제공합니다.
 * 호출 예시: panel.append(renderInterestSettings())
 */
function renderInterestSettings() {
  const section = createElement("div", "account-field");
  section.append(createElement("span", "account-field__label", "관심사"));
  section.append(
    createElement("p", "data-note", "관심사는 주변 추천과 대전 전체 관광지 탐색에 사용합니다."),
  );

  const labels = {
    nature: "자연·산책",
    science: "과학·우주",
    downtown: "원도심·역사",
    market: "시장·상권",
    mobility: "이동·타슈",
    nightview: "문화·예술(현 단계 야경)",
  };
  const chips = createElement("div", "chip-row");
  INTEREST_CATEGORIES.forEach((category) => {
    const active = state.interestDraft.includes(category);
    const button = createElement("button", `chip-button${active ? " is-active" : ""}`, labels[category]);
    button.type = "button";
    button.setAttribute("aria-pressed", String(active));
    button.addEventListener("click", () => {
      state.interestDraft = active
        ? state.interestDraft.filter((item) => item !== category)
        : [...state.interestDraft, category];
      renderAccountPanel();
    });
    chips.append(button);
  });
  section.append(chips);

  const actions = createElement("div", "account-field__controls");
  const saveButton = createElement("button", "px-button px-button--primary", "관심사 저장");
  saveButton.type = "button";
  saveButton.addEventListener("click", savePreferences);
  const attractionsButton = createElement("button", "px-button px-button--ghost", "대전 전체 관광지");
  attractionsButton.type = "button";
  attractionsButton.addEventListener("click", loadAttractions);
  actions.append(saveButton, attractionsButton);
  section.append(actions);

  if (state.interestMessage) {
    section.append(createElement("p", "data-note", state.interestMessage));
  }
  if (state.attractionMessage) {
    section.append(createElement("p", "data-note", state.attractionMessage));
  }
  state.attractions.slice(0, state.attractionLimit).forEach((item) => {
    const button = createElement("button", "quest-line");
    button.type = "button";
    button.append(createElement("span", "quest-line__title", item.placeName));
    button.disabled = !Number.isFinite(item.lat) || !Number.isFinite(item.lng);
    button.addEventListener("click", () => {
      state.plannedCategory = normalizeCategory(item.category);
      setActiveView("home");
      setPlanningLocation(item.lat, item.lng, item.placeName);
    });
    section.append(button);
  });
  if (state.attractions.length > state.attractionLimit) {
    // 뒤쪽 추천도 기존 버튼 스타일로 계속 조회할 수 있습니다.
    const moreButton = createElement("button", "px-button px-button--ghost", "관광지 더 보기");
    moreButton.type = "button";
    moreButton.addEventListener("click", () => {
      state.attractionLimit += 5;
      renderAccountPanel();
    });
    section.append(moreButton);
  }
  return section;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 마이페이지 계정 영역을 현재 계정 종류에 맞게 그린다. (명세 §10 S12 계정)
 * 호출 예시: renderAccountPanel()
 */
function renderAccountPanel() {
  // 계정 영역 컨테이너입니다.
  const panel = select("#me-account-details");

  if (!panel) {
    return;
  }

  // 게스트 계정인지 여부입니다.
  const isDemo = state.user.accountType !== "social";

  panel.replaceChildren();

  // 닉네임 변경 줄입니다. 중복을 허용한다는 점을 함께 알립니다. (명세 §9.4)
  const nicknameRow = createElement("div", "account-field");
  nicknameRow.append(createElement("span", "account-field__label", "닉네임"));

  const nicknameControls = createElement("div", "account-field__controls");
  const nicknameInput = document.createElement("input");
  nicknameInput.type = "text";
  nicknameInput.id = "me-nickname-input";
  nicknameInput.value = displayNickname(state.user.nickname);
  nicknameInput.maxLength = 20;
  nicknameInput.setAttribute("aria-label", "닉네임");

  const nicknameSave = createElement("button", "px-button px-button--ghost", "변경");
  nicknameSave.type = "button";
  nicknameSave.addEventListener("click", async () => {
    // 사용자가 입력한 새 닉네임입니다.
    const next = nicknameInput.value.trim();
    if (!next) {
      state.accountMessage = "닉네임을 입력해주세요.";
      renderAccountPanel();
      return;
    }
    if (await saveNickname(next)) {
      renderAll();
    }
  });

  nicknameControls.append(nicknameInput, nicknameSave);
  nicknameRow.append(nicknameControls);
  nicknameRow.append(createElement("p", "data-note", "같은 닉네임을 여러 명이 써도 괜찮아요."));
  panel.append(nicknameRow);

  // 계정 연결 상태입니다. 소셜과 게스트를 다르게 보여 줍니다. (명세 §9.4, §10 S12)
  const accountRow = createElement("div", "account-field");
  accountRow.append(createElement("span", "account-field__label", "계정"));

  if (isDemo) {
    accountRow.append(createElement("p", "px-body", "공용 체험 계정"));

    // 게스트 승계 안내입니다. (명세 §9.3)
    accountRow.append(
      createElement(
        "p",
        "data-note",
        "여러 사용자가 같은 체험 데이터를 사용합니다. 소셜 로그인 시 해당 계정의 기록을 불러옵니다.",
      ),
    );
    accountRow.append(
      createElement(
        "p",
        "data-note account-warning",
        "공용 체험 계정의 기록은 소셜 계정으로 이전되지 않습니다.",
      ),
    );

    // 연결 버튼입니다. 처리 중에는 잠급니다.
    const linkRow = createElement("div", "account-field__controls");
    ["naver", "google"].forEach((provider) => {
      const button = createElement(
        "button",
        "px-button px-button--primary",
        provider === "naver" ? "네이버 계정으로 로그인" : "구글 계정으로 로그인",
      );
      button.type = "button";
      button.disabled = state.accountLinkState === "pending" || !state.authProviders[provider];
      button.addEventListener("click", () => startAccountLink(provider));
      linkRow.append(button);
    });
    accountRow.append(linkRow);
  } else {
    accountRow.append(createElement("p", "px-body", state.user.email || "이메일 없음"));
    accountRow.append(
      createElement("p", "data-note", `${getProviderLabel(state.user.provider)}(으)로 로그인했어요.`),
    );
  }

  panel.append(accountRow);
  panel.append(renderInterestSettings());

  // 연결 결과 등을 알리는 문구입니다.
  const message = createElement("p", "data-note account-message", state.accountMessage);
  message.setAttribute("aria-live", "polite");
  panel.append(message);

  // 로그아웃과 회원 탈퇴입니다. (명세 §10 S12)
  const dangerRow = createElement("div", "account-field__controls");
  const logoutButton = createElement("button", "px-button px-button--ghost", "로그아웃");
  logoutButton.type = "button";
  logoutButton.addEventListener("click", handleLogout);

  const withdrawButton = createElement("button", "px-button px-button--danger", "회원 탈퇴 · 준비 중");
  withdrawButton.type = "button";
  withdrawButton.disabled = true;
  withdrawButton.title = "계정 삭제 기능은 현재 제공하지 않습니다.";

  dangerRow.append(logoutButton, withdrawButton);
  panel.append(dangerRow);
}

/**
 * 입력: 제공자 코드.
 * 출력: 화면에 표시할 제공자 이름.
 * 역할: 로그인 제공자를 한국어로 보여 준다. (명세 §9.4)
 * 호출 예시: getProviderLabel("naver")
 */
function getProviderLabel(provider) {
  // 제공자별 표시 이름입니다.
  const labels = { naver: "네이버", google: "구글" };

  return labels[String(provider).toLowerCase()] || "소셜 계정";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 세션을 지우고 동의 화면으로 되돌린다. (명세 §10 S12)
 * 호출 예시: handleLogout()
 */
function handleLogout() {
  state.accessToken = "";
  state.user = { ...FALLBACK_USER };
  state.badges = [];
  state.ggumdori = [];
  state.catalog = { earnedCount: 0, totalCount: 0, entries: [], nextCursor: "" };
  state.notes = [];
  state.notePhotos = {};
  state.noteDrafts = {};
  state.preference = { categories: [], categoriesSetAt: "", isConfigured: false };
  state.attractions = [];
  state.sessionVersion += 1;
  clearAccountActions();
  removeStorageValue(ACCESS_TOKEN_KEY);
  // 로그아웃은 연결 대기 중인 게스트 토큰까지 정리합니다.
  removeStorageValue(GUEST_TOKEN_KEY);
  removeSessionValue(OAUTH_INTENT_KEY);
  state.accountStep = "consent";
  state.accountLinkState = "idle";
  state.accountMessage = "";
  ensureSessionReady();
  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 탈퇴 처리 Promise.
 * 역할: 되돌릴 수 없는 탈퇴를 한 번 더 확인한 뒤 처리한다. (명세 §10 S12)
 * 호출 예시: await handleWithdraw()
 */
async function handleWithdraw() {
  state.accountMessage = "계정 삭제 기능은 현재 제공하지 않습니다.";
  renderAccountPanel();
}

/* ──────────────────────────────────────────────
   날씨 (명세 §6.4, §10 S14)
   데이터가 없을 때 0℃ 또는 맑음으로 대체하지 않는다.
   ────────────────────────────────────────────── */

/**
 * 입력: 없음.
 * 출력: 위치·선택일·조회시각을 담은 캐시 키.
 * 역할: 같은 위치·같은 날짜의 조회를 KST 시간 단위로 재사용한다. (명세 §6.4)
 * 호출 예시: const key = buildWeatherCacheKey()
 */
function buildWeatherCacheKey() {
  // 소수 셋째 자리까지 자른 기준 좌표입니다. 미세한 GPS 흔들림으로 키가 바뀌지 않게 합니다.
  const lat = toNumber(getRecommendationLocation().lat, 0).toFixed(3);
  const lng = toNumber(getRecommendationLocation().lng, 0).toFixed(3);
  // 조회 기준 날짜입니다. 계획 모드면 선택일입니다.
  const date = getQuestReferenceDate();
  // KST 기준 조회 시각입니다. 시간이 바뀌면 다시 받습니다.
  const hour = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 13);

  return `${lat},${lng}|${date}|${hour}`;
}

/**
 * 입력: 날씨 API 원본 응답.
 * 출력: 화면에서 사용하는 날씨 정보.
 * 역할: 없는 값을 임의로 채우지 않고 비운 채로 넘긴다. (명세 §6.4)
 * 호출 예시: normalizeWeather(payload)
 */
function normalizeWeather(payload) {
  // 응답이 data 로 감싸여 온 경우의 실제 본문입니다.
  const body = payload?.data || payload || {};

  // 기온과 강수확률은 값이 없으면 null 로 둡니다. 0 으로 대체하지 않습니다.
  const temperature = body.temperatureC ?? body.temperature ?? null;
  const precipitation = body.precipitationProbability ?? body.pop ?? null;

  return {
    temperatureC: temperature === null || temperature === "" ? null : Number(temperature),
    precipitationProbability:
      precipitation === null || precipitation === "" ? null : Number(precipitation),
    condition: String(body.condition || body.summary || ""),
    // 시간대별 예보입니다. S14 상세에서 씁니다.
    hourly: unwrapList(body.hourly || body.forecast).map((slot) => ({
      time: String(slot.time || slot.hour || ""),
      temperatureC: slot.temperatureC ?? slot.temperature ?? null,
      precipitationProbability: slot.precipitationProbability ?? slot.pop ?? null,
    })),
    // 야외활동 참고 문구입니다. (명세 §10 S14)
    outdoorNote: String(body.outdoorNote || body.advisory || ""),
    // 서버가 예보 제공 범위 밖이라고 알린 경우입니다. (명세 §6.4)
    unavailable: Boolean(body.unavailable || body.outOfRange),
  };
}

/**
 * 입력: 없음.
 * 출력: 날씨 로드 Promise.
 * 역할: 현위치·오늘 또는 계획 위치·선택일의 날씨를 받는다. 실패해도 지도와 추천은 건드리지 않는다. (명세 §6.4)
 * 호출 예시: await loadWeather()
 */
async function loadWeather(_forceRefresh = false) {
  state.weather = {
    ...createEmptyWeather(),
    status: "unavailable",
    unavailable: true,
    cacheKey: buildWeatherCacheKey(),
    outdoorNote: state.explorationMode === "planned"
      ? "계획 날짜는 일정 메모이며 현재 날씨·행사 조회에는 사용되지 않습니다."
      : "날씨 연동은 준비 중입니다.",
  };
  renderWeather();
}

/**
 * 입력: 없음.
 * 출력: 빈 날씨 상태 객체.
 * 역할: 값이 없는 상태를 한 곳에서 정의한다.
 * 호출 예시: state.weather = createEmptyWeather()
 */
function createEmptyWeather() {
  return {
    status: "idle",
    temperatureC: null,
    precipitationProbability: null,
    condition: "",
    hourly: [],
    outdoorNote: "",
    unavailable: false,
    cacheKey: "",
  };
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 상단 날씨 칩에 아이콘·대표 기온·강수확률만 표시한다. (명세 §6.4)
 * 호출 예시: renderWeather()
 */
function renderWeather() {
  // 날씨 칩과 문구 요소입니다.
  const pill = select("#home-weather-pill");
  const text = select("#home-weather-text");

  if (!pill || !text) {
    return;
  }

  // 칩을 눌러 상세를 열 수 있게 버튼 역할을 줍니다. (명세 §6.4)
  pill.setAttribute("role", "button");
  pill.setAttribute("tabindex", "0");
  pill.setAttribute("aria-label", "날씨 상세 보기");

  // 아이콘 요소입니다. 상태에 따라 리거처를 바꿉니다.
  const icon = pill.querySelector(".px-icon");
  if (icon) {
    icon.textContent = getWeatherIcon();
  }

  if (state.weather.status === "loading") {
    text.textContent = "날씨 확인 중";
    return;
  }
  if (state.weather.status === "failed") {
    text.textContent = "날씨 불러오기 실패";
    return;
  }
  if (state.weather.status === "unavailable") {
    text.textContent = "날씨 연동 준비 중";
    return;
  }

  // 표시할 조각들입니다. 값이 없으면 넣지 않습니다. (명세 §6.4)
  const parts = [];
  if (state.weather.temperatureC !== null) {
    parts.push(`${Math.round(state.weather.temperatureC)}℃`);
  }
  if (state.weather.precipitationProbability !== null) {
    parts.push(`강수 ${Math.round(state.weather.precipitationProbability)}%`);
  }

  text.textContent = parts.length > 0 ? parts.join(" · ") : "날씨 정보 없음";
}

/**
 * 입력: 없음.
 * 출력: Material Symbols 리거처 이름.
 * 역할: 날씨 상태를 아이콘으로 보여 준다. 값이 없으면 물음표 아이콘을 쓴다.
 * 호출 예시: getWeatherIcon()
 */
function getWeatherIcon() {
  if (state.weather.status !== "ready") {
    return "help";
  }

  // 서버가 준 상태 문구입니다.
  const condition = state.weather.condition.toLowerCase();

  if (condition.includes("rain") || condition.includes("비")) return "rainy";
  if (condition.includes("snow") || condition.includes("눈")) return "weather_snowy";
  if (condition.includes("cloud") || condition.includes("흐")) return "cloud";

  return "wb_sunny";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 시간대별 예보와 야외활동 참고를 작은 시트로 보여 준다. (명세 §6.4, §10 S14)
 * 호출 예시: renderWeatherSheet()
 */
function renderWeatherSheet() {
  // 날씨 상세 시트 컨테이너입니다.
  const sheet = select("#weather-sheet");

  if (!sheet) {
    return;
  }

  if (!state.weatherSheetOpen) {
    sheet.hidden = true;
    sheet.replaceChildren();
    return;
  }

  sheet.hidden = false;
  sheet.replaceChildren();

  // 배경 딤입니다. 눌러서 닫습니다.
  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closeWeatherSheet);

  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "weather-sheet-title");

  // 상단 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", "날씨");
  title.id = "weather-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "날씨 상세 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closeWeatherSheet);

  head.append(titleGroup, closeButton);

  // 본문입니다.
  const body = createElement("div", "quest-sheet__body");

  // 어느 위치·어느 날짜의 예보인지 먼저 밝힙니다. (명세 §10 S14)
  const contextPanel = createElement("section", "px-panel px-panel--inset");
  contextPanel.append(
    createElement("span", "px-label quest-sheet__eyebrow", state.explorationMode === "planned" ? "계획 위치" : "현위치"),
    createElement("p", "px-body", `${getRecommendationLocation().label || "대전광역시청"} · ${formatContextDate(getQuestReferenceDate())}`),
  );
  body.append(contextPanel);

  if (state.weather.status === "unavailable") {
    body.append(createElement("p", "empty-message", "아직 예보가 제공되지 않아요"));
  } else if (state.weather.status === "failed") {
    // 실패는 날씨 영역만 재시도합니다. (명세 §6.4)
    const failPanel = createElement("section", "px-panel");
    failPanel.append(createElement("p", "px-body", "날씨를 불러오지 못했어요."));
    const retryButton = createElement("button", "px-button px-button--primary", "다시 시도");
    retryButton.type = "button";
    retryButton.addEventListener("click", () => loadWeather(true).then(renderWeatherSheet));
    failPanel.append(retryButton);
    body.append(failPanel);
  } else if (state.weather.status === "loading") {
    body.append(createElement("p", "empty-message", "날씨를 불러오는 중이에요."));
  } else {
    // 대표 값입니다.
    const stats = createElement("div", "stat-row");
    stats.append(
      createStatCell("기온", state.weather.temperatureC === null ? "정보 없음" : `${Math.round(state.weather.temperatureC)}℃`),
      createStatCell(
        "강수확률",
        state.weather.precipitationProbability === null
          ? "정보 없음"
          : `${Math.round(state.weather.precipitationProbability)}%`,
      ),
      createStatCell("상태", state.weather.condition || "정보 없음"),
    );
    body.append(stats);

    // 시간대별 예보입니다. (명세 §10 S14)
    const hourlyPanel = createElement("section", "px-panel");
    hourlyPanel.append(createElement("h3", "section-title", "시간대별"));
    if (state.weather.hourly.length === 0) {
      hourlyPanel.append(createElement("p", "data-note", "시간대별 예보가 없어요."));
    } else {
      const list = createElement("div", "weather-hourly");
      state.weather.hourly.forEach((slot) => {
        const cell = createElement("div", "weather-hourly__cell");
        cell.append(
          createElement("span", "weather-hourly__time", slot.time || "-"),
          createElement(
            "span",
            "weather-hourly__temp",
            slot.temperatureC === null || slot.temperatureC === undefined
              ? "-"
              : `${Math.round(slot.temperatureC)}℃`,
          ),
          createElement(
            "span",
            "weather-hourly__pop",
            slot.precipitationProbability === null || slot.precipitationProbability === undefined
              ? "-"
              : `${Math.round(slot.precipitationProbability)}%`,
          ),
        );
        list.append(cell);
      });
      hourlyPanel.append(list);
    }
    body.append(hourlyPanel);

    // 야외활동 참고입니다. (명세 §10 S14)
    if (state.weather.outdoorNote) {
      const notePanel = createElement("section", "px-panel");
      notePanel.append(
        createElement("h3", "section-title", "야외활동 참고"),
        createElement("p", "px-body", state.weather.outdoorNote),
      );
      body.append(notePanel);
    }
  }

  panel.append(head, body);
  sheet.append(scrim, panel);
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#weather-sheet-title")?.focus({ preventScroll: true });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 날씨 상세 시트를 연다. (명세 §6.4)
 * 호출 예시: openWeatherSheet()
 */
function openWeatherSheet() {
  state.weatherSheetOpen = true;
  renderWeatherSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 날씨 상세 시트를 닫는다.
 * 호출 예시: closeWeatherSheet()
 */
function closeWeatherSheet() {
  state.weatherSheetOpen = false;
  renderWeatherSheet();
  select("#home-weather-pill")?.focus({ preventScroll: true });
}

/* ──────────────────────────────────────────────
   행사 상태 문구 (명세 §6.5) · 계획 위치·날짜 (명세 §6.3, §10 S15)
   ────────────────────────────────────────────── */

/**
 * 입력: 정규화된 퀘스트 항목.
 * 출력: 행사 상태 문구 또는 "".
 * 역할: 운영시간을 신뢰할 수 있을 때만 지금 참여 가능을 쓴다. (명세 §6.5)
 * 호출 예시: getEventStatusLabel(quest)
 */
function getEventStatusLabel(quest) {
  if (!quest.availableFrom && !quest.availableUntil) {
    return "";
  }

  // 오늘 날짜입니다. 종료일은 포함해 판정합니다. (명세 §6.5)
  const todayKey = toKstDateKey(new Date());
  // 기간 안인지 여부입니다.
  const isTodayInRange =
    (!quest.availableFrom || quest.availableFrom <= todayKey) &&
    (!quest.availableUntil || quest.availableUntil >= todayKey);

  // 계획 모드에서는 선택일 기준으로 알립니다. (명세 §6.5)
  if (state.explorationMode === "planned") {
    // 계획 기준 날짜입니다.
    const referenceDate = getQuestReferenceDate();
    const isPlannedInRange =
      (!quest.availableFrom || quest.availableFrom <= referenceDate) &&
      (!quest.availableUntil || quest.availableUntil >= referenceDate);

    return isPlannedInRange ? "선택일 개최" : "";
  }

  if (!isTodayInRange) {
    return "";
  }

  // 오프라인의 오래된 캐시로는 지금 참여 가능을 쓰지 않습니다. (명세 §6.5)
  if (!state.isOnline) {
    return "오늘 개최 중";
  }

  // 운영시간이 신뢰 가능하고 지금이 그 안일 때만 지금 참여 가능입니다. (명세 §6.5)
  if (quest.openTime && quest.closeTime && isNowWithinOperatingHours(quest)) {
    return "지금 참여 가능";
  }

  return "오늘 개최 중";
}

/**
 * 입력: 운영시간을 가진 퀘스트 항목.
 * 출력: 현재가 운영시간 안인지 여부.
 * 역할: KST 기준 현재 시각과 운영시간을 비교한다. (명세 §6.5)
 * 호출 예시: isNowWithinOperatingHours(quest)
 */
function isNowWithinOperatingHours(quest) {
  // KST 기준 현재 시각을 HH:MM 으로 만든 값입니다.
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);

  return quest.openTime <= nowKst && nowKst <= quest.closeTime;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 계획 위치·날짜 설정 시트를 연다. (명세 §10 S15)
 * 호출 예시: openPlanSheet()
 */
function openPlanSheet() {
  state.planSheetOpen = true;
  state.planSearchQuery = "";
  state.planSearchResults = [];
  state.planMessage = "";
  renderPlanSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 계획 설정 시트를 닫는다.
 * 호출 예시: closePlanSheet()
 */
function closePlanSheet() {
  state.planSheetOpen = false;
  renderPlanSheet();
  select("#home-plan-search")?.focus({ preventScroll: true });
}

/**
 * 입력: 검색어.
 * 출력: 검색 Promise.
 * 역할: 장소·주소·행정구역으로 계획 위치 후보를 찾는다. (명세 §6.3, §10 S15)
 * 호출 예시: await searchPlanLocation("유성구")
 */
async function searchPlanLocation(keyword) {
  const query = String(keyword || "").trim();
  const requestId = ++state.requestVersions.planSearch;
  const sessionVersion = state.sessionVersion;

  if (!query) {
    state.planSearchResults = [];
    state.planMessage = "찾을 장소나 지역을 입력해주세요.";
    renderPlanSheet();
    return;
  }

  state.planMessage = "검색 중입니다.";
  renderPlanSheet();

  try {
    const payload = await fetchJson(`/api/naver-map/geocode?query=${encodeURIComponent(query)}`);
    if (!isCurrentRequest("planSearch", requestId, sessionVersion)) {
      return;
    }
    const addresses = Array.isArray(payload?.addresses) ? payload.addresses : unwrapList(payload);
    state.planSearchResults = addresses
      .map((item) => ({
        label: String(item.roadAddress || item.jibunAddress || item.label || item.name || query),
        address: String(item.roadAddress || item.jibunAddress || item.address || ""),
        lat: Number(item.y ?? item.latitude ?? item.lat),
        lng: Number(item.x ?? item.longitude ?? item.lng),
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    state.planMessage = state.planSearchResults.length === 0 ? "검색 결과가 없어요." : "";
  } catch (error) {
    if (!isCurrentRequest("planSearch", requestId, sessionVersion)) {
      return;
    }
    state.planSearchResults = [];
    state.planMessage = "위치를 검색하지 못했어요. 다시 시도해주세요.";
  }

  renderPlanSheet();
}

/**
 * 입력: 선택한 위치 후보.
 * 출력: 없음.
 * 역할: 계획 좌표를 확정한다. 완료 인증에는 절대 쓰지 않는다. (명세 §6.3, §19)
 * 호출 예시: applyPlanLocation(candidate)
 */
function applyPlanLocation(candidate) {
  const lat = Number(candidate?.lat);
  const lng = Number(candidate?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    state.planMessage = "올바른 위도와 경도를 입력해주세요.";
    renderPlanSheet();
    return;
  }

  state.plannedLocation = {
    lat,
    lng,
    label: String(candidate?.label || "선택한 계획 위치"),
    measured: false,
  };
  state.explorationMode = "planned";
  state.selectedCategory = state.plannedCategory;
  state.requestVersions.recommendation += 1;
  persistPlanContext();
  closePlanSheet();
  renderAll();
  loadRecommendations(true);
}

/**
 * 입력: 선택한 위도, 경도와 표시 이름.
 * 출력: 없음.
 * 역할: 프리셋, 직접 좌표와 지도 클릭을 같은 계획 위치 설정 흐름으로 연결합니다.
 * 호출 예시: setPlanningLocation(36.3321, 127.4344, "대전역")
 */
function setPlanningLocation(lat, lng, label = "선택한 계획 위치") {
  applyPlanLocation({ lat, lng, label });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 마지막 계획 위치와 날짜를 저장한다. (명세 §6.3)
 * 호출 예시: persistPlanContext()
 */
function persistPlanContext() {
  writeStorageValue(
    PLAN_CONTEXT_KEY,
    JSON.stringify({
      lat: state.plannedLocation.lat,
      lng: state.plannedLocation.lng,
      label: state.plannedLocation.label,
      date: state.plannedDate,
    }),
  );
}

/**
 * 입력: 없음.
 * 출력: 저장된 계획 컨텍스트 또는 null.
 * 역할: 마지막 계획 위치와 날짜를 복원한다. (명세 §6.3)
 * 호출 예시: const saved = readPlanContext()
 */
function readPlanContext() {
  try {
    return JSON.parse(readStorageValue(PLAN_CONTEXT_KEY) || "null");
  } catch (error) {
    return null;
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 계획 위치 검색과 날짜 선택 시트를 그린다. (명세 §10 S15)
 * 호출 예시: renderPlanSheet()
 */
function renderPlanSheet() {
  // 계획 설정 시트 컨테이너입니다.
  const sheet = select("#plan-sheet");

  if (!sheet) {
    return;
  }

  if (!state.planSheetOpen) {
    sheet.hidden = true;
    sheet.replaceChildren();
    return;
  }

  sheet.hidden = false;
  sheet.replaceChildren();

  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closePlanSheet);

  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "plan-sheet-title");

  // 상단 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", "계획 위치와 날짜");
  title.id = "plan-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "계획 설정 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closePlanSheet);

  head.append(titleGroup, closeButton);

  const body = createElement("div", "quest-sheet__body");

  // 검색 줄입니다. 장소·주소·행정구역을 함께 찾습니다. (명세 §6.3)
  const searchPanel = createElement("section", "px-panel");
  searchPanel.append(createElement("h3", "section-title", "위치 검색"));

  const searchRow = createElement("div", "account-field__controls");
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.id = "plan-search-input";
  searchInput.placeholder = "장소, 주소, 지역";
  searchInput.value = state.planSearchQuery;
  searchInput.setAttribute("aria-label", "계획 위치 검색");
  searchInput.addEventListener("input", (event) => {
    state.planSearchQuery = event.target.value || "";
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchPlanLocation(state.planSearchQuery);
    }
  });

  const searchButton = createElement("button", "px-button px-button--primary", "검색");
  searchButton.type = "button";
  searchButton.addEventListener("click", () => searchPlanLocation(state.planSearchQuery));

  searchRow.append(searchInput, searchButton);
  searchPanel.append(searchRow);
  searchPanel.append(
    createElement("p", "data-note", `현재 계획 위치: ${state.plannedLocation.label}`),
  );
  const presets = createElement("div", "chip-row");
  PLAN_LOCATION_PRESETS.forEach((preset) => {
    const button = createElement("button", "chip-button", preset.label);
    button.type = "button";
    button.addEventListener("click", () => applyPlanLocation(preset));
    presets.append(button);
  });
  searchPanel.append(presets);

  const coordinateRow = createElement("div", "account-field__controls");
  const latitudeInput = document.createElement("input");
  latitudeInput.type = "number";
  latitudeInput.step = "any";
  latitudeInput.value = String(state.plannedLocation.lat);
  latitudeInput.setAttribute("aria-label", "계획 위치 위도");
  latitudeInput.placeholder = "위도";
  const longitudeInput = document.createElement("input");
  longitudeInput.type = "number";
  longitudeInput.step = "any";
  longitudeInput.value = String(state.plannedLocation.lng);
  longitudeInput.setAttribute("aria-label", "계획 위치 경도");
  longitudeInput.placeholder = "경도";
  const coordinateButton = createElement("button", "px-button px-button--ghost", "좌표 적용");
  coordinateButton.type = "button";
  coordinateButton.addEventListener("click", () => {
    setPlanningLocation(
      latitudeInput.value,
      longitudeInput.value,
      `${latitudeInput.value}, ${longitudeInput.value}`,
    );
  });
  coordinateRow.append(latitudeInput, longitudeInput, coordinateButton);
  searchPanel.append(coordinateRow);
  searchPanel.append(
    createElement("p", "data-note", "계획 모드에서는 지도에서 지점을 눌러 위치를 정할 수도 있습니다."),
  );

  if (state.planMessage) {
    searchPanel.append(createElement("p", "data-note", state.planMessage));
  }

  // 검색 결과 목록입니다.
  if (state.planSearchResults.length > 0) {
    const list = createElement("div", "plan-result-list");
    state.planSearchResults.forEach((candidate) => {
      const row = createElement("button", "quest-line");
      row.type = "button";
      const main = createElement("div", "quest-line__main");
      main.append(createElement("span", "quest-line__title", candidate.label));
      if (candidate.address) {
        main.append(createElement("span", "quest-line__place", candidate.address));
      }
      row.append(main);
      row.addEventListener("click", () => applyPlanLocation(candidate));
      list.append(row);
    });
    searchPanel.append(list);
  }

  body.append(searchPanel);

  // 단일 날짜 선택입니다. 기간·시간대·일정표는 제공하지 않습니다. (명세 §6.3)
  const datePanel = createElement("section", "px-panel");
  datePanel.append(createElement("h3", "section-title", "날짜"));

  const dateRow = createElement("div", "account-field__controls");
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.id = "plan-date-input";
  dateInput.value = state.plannedDate || toKstDateKey(new Date());
  dateInput.setAttribute("aria-label", "계획 날짜");
  dateInput.addEventListener("change", (event) => {
    state.plannedDate = event.target.value || "";
    persistPlanContext();
    renderHomeContext();
    renderRecommendations();
    loadWeather(true);
  });

  // 오늘 바로가기입니다. (명세 §10 S15)
  const todayButton = createElement("button", "px-button px-button--ghost", "오늘");
  todayButton.type = "button";
  todayButton.addEventListener("click", () => {
    state.plannedDate = toKstDateKey(new Date());
    persistPlanContext();
    renderPlanSheet();
    renderHomeContext();
    renderRecommendations();
    loadWeather(true);
  });

  dateRow.append(dateInput, todayButton);
  datePanel.append(dateRow);
  datePanel.append(
    createElement("p", "data-note", "날짜는 일정 메모로 저장됩니다. 추천은 계획 위치를 기준으로 하며 완료 인증은 현장의 실제 GPS와 현재 시각만 사용합니다."),
  );
  body.append(datePanel);

  panel.append(head, body);
  sheet.append(scrim, panel);
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#plan-sheet-title")?.focus({ preventScroll: true });
}

/* ──────────────────────────────────────────────
   공통 축제 퀘스트와 추가 방문 (명세 §11, §10 S06·S07·S08)
   ────────────────────────────────────────────── */

/**
 * 입력: 행사 타깃 원본 항목.
 * 출력: 화면에서 사용하는 행사 타깃.
 * 역할: 서버 FestivalTarget 을 한 가지 모양으로 맞춘다. (명세 §16.2)
 * 호출 예시: normalizeFestivalTarget(rawTarget)
 */
function normalizeFestivalTarget(rawTarget) {
  // 행사 타깃 원본입니다.
  const target = rawTarget || {};

  return {
    eventId: String(target.eventId || ""),
    // 같은 축제의 연도·회차를 구분합니다. (명세 §16.2)
    editionId: String(target.editionId || ""),
    title: String(target.title || "행사"),
    venueName: String(target.venueName || ""),
    roadAddress: String(target.roadAddress || ""),
    latitude: toNumber(target.latitude, 0),
    longitude: toNumber(target.longitude, 0),
    startDate: normalizeDateKey(target.startDate),
    endDate: normalizeDateKey(target.endDate),
    startTime: String(target.startTime || ""),
    endTime: String(target.endTime || ""),
    availabilityLabel: String(target.availabilityLabel || ""),
    sourceContentId: String(target.sourceContentId || ""),
  };
}

/**
 * 입력: 행사 타깃.
 * 출력: 이 타깃을 구분하는 고유 키.
 * 역할: 같은 축제의 다른 회차를 별개로 다룬다. (명세 §11.1)
 * 호출 예시: getFestivalTargetKey(target)
 */
function getFestivalTargetKey(target) {
  return `${target.eventId}#${target.editionId}`;
}

/**
 * 입력: 공통 축제 퀘스트.
 * 출력: 기준 날짜에 유효한 타깃 목록.
 * 역할: 취소·종료된 행사를 빼고 지금 또는 선택일에 참여 가능한 타깃만 남긴다. (명세 §6.5, §11.1)
 * 호출 예시: getValidFestivalTargets(quest)
 */
function getValidFestivalTargets(quest) {
  // 계획 모드면 선택일, 아니면 오늘입니다.
  const referenceDate = getQuestReferenceDate();

  return (quest.festivalTargets || []).filter((target) => {
    // 종료일은 포함해 판정합니다. (명세 §6.5)
    if (target.startDate && referenceDate < target.startDate) {
      return false;
    }
    if (target.endDate && referenceDate > target.endDate) {
      return false;
    }
    return true;
  });
}

/**
 * 입력: 퀘스트 인스턴스 식별자.
 * 출력: 선택된 행사 타깃 또는 null.
 * 역할: 사용자가 실제 수행할 행사 하나를 기억한다. (명세 §11.1)
 * 호출 예시: getSelectedFestivalTarget(quest)
 */
function getSelectedFestivalTarget(quest) {
  // 이 퀘스트에서 사용자가 고른 타깃 키입니다.
  const selectedKey = state.selectedFestivalTargets[quest.instanceId] || "";

  return (quest.festivalTargets || []).find((target) => getFestivalTargetKey(target) === selectedKey) || null;
}

/**
 * 입력: 공통 축제 퀘스트와 행사 타깃.
 * 출력: 이 회차를 이미 방문 기록했는지 여부.
 * 역할: 동일 사용자·동일 행사 회차의 중복 기록을 막는다. (명세 §11.1)
 * 호출 예시: hasVisitedFestivalTarget(quest, target)
 */
function hasVisitedFestivalTarget(quest, target) {
  // 이 퀘스트에 기록된 방문 목록입니다.
  return state.festivalVisits.some(
    (visit) => visit.questId === quest.questId && visit.targetKey === getFestivalTargetKey(target),
  );
}

/**
 * 입력: 공통 축제 퀘스트.
 * 출력: 공통 보상을 이미 받았는지 여부.
 * 역할: 첫 완료와 추가 방문을 가른다. (명세 §11.2)
 * 호출 예시: hasEarnedCommonFestivalReward(quest)
 */
function hasEarnedCommonFestivalReward(quest) {
  // 로컬 저장소까지 반영한 진행 상태입니다.
  const questStatus = getQuestStatus(quest.instanceId, quest.status);

  return questStatus === "completed" || questStatus === "done";
}

/**
 * 입력: 공통 축제 퀘스트와 진행 상태.
 * 출력: 행사 타깃 선택 패널 요소.
 * 역할: 개최일·신뢰 가능한 운영시간·타깃 선택을 상세에 보여 준다. (명세 §10 S06 본문 7항)
 * 호출 예시: createFestivalTargetPanel(quest)
 */
function createFestivalTargetPanel(quest) {
  // 타깃 선택 패널입니다.
  const panel = createElement("section", "px-panel");
  panel.append(createElement("h3", "section-title", "참여할 행사 고르기"));

  // 이미 공통 보상을 받았다면 시작 전에 알립니다. (명세 §11.2)
  if (hasEarnedCommonFestivalReward(quest)) {
    panel.append(
      createElement(
        "p",
        "data-note account-warning",
        "공통 보상은 이미 받았어요. 다른 행사는 추가 방문으로 기록되고 새 뱃지·꿈돌이·XP는 지급되지 않아요.",
      ),
    );
  }

  // 기준 날짜에 참여할 수 있는 타깃 목록입니다.
  const targets = getValidFestivalTargets(quest);

  if (targets.length === 0) {
    panel.append(createElement("p", "empty-message", "선택한 날짜에 참여할 수 있는 행사가 없어요."));
    return panel;
  }

  // 현재 선택된 타깃 키입니다.
  const selectedKey = state.selectedFestivalTargets[quest.instanceId] || "";

  // 라디오 목록입니다. 하나만 고를 수 있습니다. (명세 §11.1)
  const list = createElement("div", "festival-target-list");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", "참여할 행사 선택");

  targets.forEach((target) => {
    // 이 타깃의 고유 키입니다.
    const key = getFestivalTargetKey(target);
    // 이미 방문 기록이 있는 회차인지 여부입니다. (명세 §11.1)
    const isVisited = hasVisitedFestivalTarget(quest, target);

    const option = createElement("button", `festival-target${key === selectedKey ? " is-selected" : ""}`);
    option.type = "button";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", key === selectedKey ? "true" : "false");
    // 이미 기록한 회차는 다시 고를 수 없습니다.
    option.disabled = isVisited;

    const main = createElement("div", "festival-target__main");
    main.append(createElement("span", "festival-target__title", target.title));
    if (target.venueName) {
      main.append(createElement("span", "festival-target__venue", target.venueName));
    }

    // 개최일과 신뢰 가능한 운영시간입니다. (명세 §10 S06 본문 7항)
    main.append(createElement("span", "festival-target__when", formatFestivalPeriod(target)));

    option.append(main);
    option.append(
      createElement(
        "span",
        isVisited ? "status-badge status-badge--done" : "status-badge status-badge--available",
        isVisited ? "방문함" : target.availabilityLabel || "참여 가능",
      ),
    );

    option.addEventListener("click", () => {
      state.selectedFestivalTargets[quest.instanceId] = key;
      persistFestivalSelections();
      renderQuestSheet();
    });

    list.append(option);
  });

  panel.append(list);

  // 선택한 행사의 좌표를 실제 GPS 와 확인한다는 점을 알립니다. (명세 §10 S07 행사형)
  panel.append(
    createElement("p", "data-note", "선택한 행사의 개최 기간·운영시간·위치를 현장의 실제 GPS와 확인해요."),
  );

  return panel;
}

/**
 * 입력: 행사 타깃.
 * 출력: 개최 기간과 운영시간 문구.
 * 역할: 언제 열리는 행사인지 한 줄로 보여 준다. (명세 §10 S06)
 * 호출 예시: formatFestivalPeriod(target)
 */
function formatFestivalPeriod(target) {
  // 개최 기간 문구입니다.
  const period =
    target.startDate && target.endDate
      ? `${formatContextDate(target.startDate)} ~ ${formatContextDate(target.endDate)}`
      : target.startDate
        ? `${formatContextDate(target.startDate)}부터`
        : "개최일 미정";

  // 운영시간은 둘 다 있을 때만 신뢰합니다. (명세 §6.5)
  const hours = target.startTime && target.endTime ? ` · ${target.startTime}~${target.endTime}` : "";

  return period + hours;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 고른 행사 타깃을 브라우저에 저장한다.
 * 호출 예시: persistFestivalSelections()
 */
function persistFestivalSelections() {
  writeStorageValue(FESTIVAL_SELECTION_KEY, JSON.stringify(state.selectedFestivalTargets));
}

/**
 * 입력: 없음.
 * 출력: 저장된 행사 선택 객체.
 * 역할: 새로고침해도 고른 행사를 유지한다.
 * 호출 예시: state.selectedFestivalTargets = readFestivalSelections()
 */
function readFestivalSelections() {
  try {
    return JSON.parse(readStorageValue(FESTIVAL_SELECTION_KEY) || "{}") || {};
  } catch (error) {
    return {};
  }
}

/**
 * 입력: 없음.
 * 출력: 저장된 행사 방문 기록 배열.
 * 역할: 어떤 회차를 이미 방문했는지 기억한다. (명세 §11.1, §11.2)
 * 호출 예시: state.festivalVisits = readFestivalVisits()
 */
function readFestivalVisits() {
  try {
    // 저장된 방문 기록입니다.
    const parsed = JSON.parse(readStorageValue(FESTIVAL_VISIT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/**
 * 입력: 공통 축제 퀘스트와 방문한 행사 타깃.
 * 출력: 없음.
 * 역할: 실제 방문한 행사만 기록한다. 중복 회차는 담지 않는다. (명세 §11.1, §11.2)
 * 호출 예시: recordFestivalVisit(quest, target)
 */
function recordFestivalVisit(quest, target) {
  if (!target || hasVisitedFestivalTarget(quest, target)) {
    return;
  }

  state.festivalVisits = [
    ...state.festivalVisits,
    {
      // 완료에는 canonicalQuestId 와 실제 행사 정보를 함께 남깁니다. (명세 §11.1)
      canonicalQuestId: quest.questId,
      questId: quest.questId,
      targetKey: getFestivalTargetKey(target),
      eventId: target.eventId,
      editionId: target.editionId,
      title: target.title,
      venueName: target.venueName,
      visitedAt: new Date().toISOString(),
    },
  ];

  writeStorageValue(FESTIVAL_VISIT_KEY, JSON.stringify(state.festivalVisits));
}

/**
 * 입력: 공통 축제 퀘스트.
 * 출력: 이번 완료가 추가 방문인지 여부.
 * 역할: 공통 보상을 이미 받은 뒤의 완료는 추가 방문으로 다룬다. (명세 §11.2)
 * 호출 예시: if (isAdditionalFestivalVisit(quest)) { ... }
 */
function isAdditionalFestivalVisit(quest) {
  if (!quest?.isCommonFestival) {
    return false;
  }

  return hasEarnedCommonFestivalReward(quest);
}

/* ──────────────────────────────────────────────
   꿈돌이 2D 촬영 (명세 §10 S11)
   합성은 기기 안 Canvas 에서 하고, 인증 사진은 절대 자동으로 불러오지 않는다. (§15.2)
   ────────────────────────────────────────────── */

/**
 * 입력: 꿈돌이 식별자.
 * 출력: 없음.
 * 역할: 획득한 꿈돌이만 촬영 화면을 연다. (명세 §10 S11)
 * 호출 예시: openPhotoSheet("science-1")
 */
function openPhotoSheet(ggumdoriId) {
  // 촬영에 쓸 도감 항목입니다.
  const entry = state.catalog.entries.find((item) => item.ggumdoriId === ggumdoriId);

  if (!entry || entry.state !== "earned") {
    return;
  }

  state.photo = {
    ...createEmptyPhotoState(),
    open: true,
    ggumdoriId,
    returnFocus: document.activeElement,
  };

  renderPhotoSheet();
  startPhotoCamera();
}

/**
 * 입력: 없음.
 * 출력: 초기 촬영 상태.
 * 역할: 촬영 상태를 한 곳에서 정의한다.
 * 호출 예시: state.photo = createEmptyPhotoState()
 */
function createEmptyPhotoState() {
  return {
    open: false,
    ggumdoriId: "",
    // idle | camera | file | denied
    source: "idle",
    // 캐릭터 크기 배율과 좌우 위치(0~100%)입니다. (명세 §10 S11)
    scale: 40,
    offsetX: 50,
    // 셔터를 누른 뒤 만들어진 정지 PNG 입니다.
    resultDataUrl: "",
    message: "",
    // 사용자가 고른 사진입니다. 카메라를 못 쓸 때 배경으로 씁니다.
    pickedImageUrl: "",
    returnFocus: null,
  };
}

/**
 * 입력: 없음.
 * 출력: 카메라 시작 Promise.
 * 역할: 실제 카메라를 켜고, 거부되면 권한 안내와 파일 선택 폴백을 제공한다. (명세 §10 S11)
 * 호출 예시: await startPhotoCamera()
 */
async function startPhotoCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    state.photo = { ...state.photo, source: "denied", message: "이 브라우저에서는 카메라를 쓸 수 없어요. 사진을 골라 합성할 수 있어요." };
    renderPhotoSheet();
    return;
  }

  try {
    // 후면 카메라를 우선 요청합니다.
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });

    // 시트가 이미 닫혔으면 스트림을 바로 정리합니다.
    if (!state.photo.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    photoStream = stream;
    state.photo = { ...state.photo, source: "camera", message: "" };
    renderPhotoSheet();

    // 미리보기 영상에 스트림을 연결합니다.
    const video = select("#photo-video");
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => {});
    }
  } catch (error) {
    // 카메라 거부 시 권한 안내와 파일 선택 폴백입니다. (명세 §10 S11)
    state.photo = {
      ...state.photo,
      source: "denied",
      message: "카메라 권한이 없어요. 설정에서 권한을 허용하거나 사진을 골라 합성할 수 있어요.",
    };
    renderPhotoSheet();
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 카메라 스트림을 끈다. 시트를 닫거나 결과를 만든 뒤 호출한다.
 * 호출 예시: stopPhotoCamera()
 */
function stopPhotoCamera() {
  if (!photoStream) {
    return;
  }

  photoStream.getTracks().forEach((track) => track.stop());
  photoStream = null;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 촬영 화면을 닫고 카메라와 임시 URL 을 정리한다.
 * 호출 예시: closePhotoSheet()
 */
function closePhotoSheet() {
  if (!state.photo.open) {
    return;
  }

  stopPhotoCamera();

  // 파일 선택으로 만든 임시 URL 을 해제합니다.
  if (state.photo.pickedImageUrl) {
    URL.revokeObjectURL(state.photo.pickedImageUrl);
  }

  // 시트를 열기 전 포커스가 있던 요소입니다.
  const target = state.photo.returnFocus;

  state.photo = createEmptyPhotoState();
  renderPhotoSheet();

  if (target instanceof HTMLElement && target.isConnected) {
    target.focus({ preventScroll: true });
  }
}

/**
 * 입력: 사용자가 고른 이미지 파일.
 * 출력: 없음.
 * 역할: 카메라 대신 사용자가 고른 사진을 배경으로 쓴다. (명세 §10 S11)
 * 호출 예시: usePickedPhoto(file)
 */
function usePickedPhoto(file) {
  if (!file) {
    return;
  }

  stopPhotoCamera();

  if (state.photo.pickedImageUrl) {
    URL.revokeObjectURL(state.photo.pickedImageUrl);
  }

  state.photo = {
    ...state.photo,
    source: "file",
    pickedImageUrl: URL.createObjectURL(file),
    resultDataUrl: "",
    message: "",
  };
  renderPhotoSheet();
}

/**
 * 입력: 없음.
 * 출력: 합성 Promise.
 * 역할: 셔터 순간의 배경과 꿈돌이를 Canvas 로 합쳐 정지 PNG 를 만든다. (명세 §10 S11)
 * 호출 예시: await capturePhoto()
 */
async function capturePhoto() {
  // 배경으로 쓸 요소입니다. 카메라면 video, 아니면 고른 사진입니다.
  const video = select("#photo-video");
  const picked = select("#photo-picked");
  const source = state.photo.source === "camera" && video?.videoWidth ? video : picked;

  if (!source) {
    state.photo = { ...state.photo, message: "합성할 사진이 없어요. 카메라를 켜거나 사진을 골라주세요." };
    renderPhotoSheet();
    return;
  }

  // 배경의 원본 크기입니다.
  const sourceWidth = source.videoWidth || source.naturalWidth || 0;
  const sourceHeight = source.videoHeight || source.naturalHeight || 0;

  if (!sourceWidth || !sourceHeight) {
    state.photo = { ...state.photo, message: "사진을 아직 불러오는 중이에요." };
    renderPhotoSheet();
    return;
  }

  // 합성 캔버스입니다. 기기 안에서만 처리합니다. (명세 §10 S11)
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0, sourceWidth, sourceHeight);

  // 합성할 꿈돌이 그림입니다. GIF 여도 셔터 순간의 한 프레임이 그려집니다. (명세 §10 S11)
  const entry = state.catalog.entries.find((item) => item.ggumdoriId === state.photo.ggumdoriId);
  if (entry?.ggumdoriImageRef) {
    try {
      const art = await loadImageElement(entry.ggumdoriImageRef);
      // 캐릭터 높이는 사진 높이의 scale% 입니다.
      const drawHeight = (sourceHeight * state.photo.scale) / 100;
      const drawWidth = art.naturalWidth ? (drawHeight * art.naturalWidth) / art.naturalHeight : drawHeight;
      // 좌우 위치는 offsetX% 지점을 중심으로 둡니다.
      const drawX = (sourceWidth * state.photo.offsetX) / 100 - drawWidth / 2;
      // 발이 사진 아래쪽에 닿게 둡니다.
      const drawY = sourceHeight - drawHeight - sourceHeight * 0.04;
      context.drawImage(art, drawX, drawY, drawWidth, drawHeight);
    } catch (error) {
      state.photo = { ...state.photo, message: "꿈돌이 그림을 불러오지 못했어요." };
      renderPhotoSheet();
      return;
    }
  }

  stopPhotoCamera();
  state.photo = { ...state.photo, resultDataUrl: canvas.toDataURL("image/png"), message: "" };
  renderPhotoSheet();
}

/**
 * 입력: 이미지 경로.
 * 출력: 로드된 이미지 요소 Promise.
 * 역할: Canvas 에 그리기 전에 이미지가 준비되기를 기다린다.
 * 호출 예시: const art = await loadImageElement("/assets/ggumdori/science-1.png")
 */
function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    // 합성에 쓸 이미지입니다.
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", reject, { once: true });
    image.src = source;
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 결과 PNG 를 다시 찍을 수 있게 되돌린다. (명세 §10 S11)
 * 호출 예시: retakePhoto()
 */
function retakePhoto() {
  state.photo = { ...state.photo, resultDataUrl: "", message: "" };
  renderPhotoSheet();

  if (state.photo.source === "camera" || state.photo.source === "idle") {
    startPhotoCamera();
  }
}

/**
 * 입력: 없음.
 * 출력: 저장 Promise.
 * 역할: 합성한 PNG 를 기기에 내려받는다. (명세 §10 S11)
 * 호출 예시: savePhoto()
 */
function savePhoto() {
  if (!state.photo.resultDataUrl) {
    return;
  }

  // 내려받기용 임시 링크입니다.
  const link = document.createElement("a");
  link.href = state.photo.resultDataUrl;
  link.download = `questbook-${state.photo.ggumdoriId || "ggumdori"}.png`;
  document.body.append(link);
  link.click();
  link.remove();

  state.photo = { ...state.photo, message: "PNG 로 저장했어요." };
  renderPhotoSheet();
}

/**
 * 입력: 없음.
 * 출력: 공유 Promise.
 * 역할: 파일 공유를 지원하면 기기 공유창을 열고, 아니면 다운로드로 대신한다. (명세 §10 S11)
 * 호출 예시: await sharePhoto()
 */
async function sharePhoto() {
  if (!state.photo.resultDataUrl) {
    return;
  }

  try {
    // dataURL 을 공유 가능한 파일로 바꿉니다.
    const blob = await (await fetch(state.photo.resultDataUrl)).blob();
    const file = new File([blob], `questbook-${state.photo.ggumdoriId || "ggumdori"}.png`, { type: "image/png" });

    // 파일 공유를 지원하는 기기에서만 공유창을 엽니다. (명세 §10 S11)
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "모험가의 수첩" });
      state.photo = { ...state.photo, message: "공유했어요." };
      renderPhotoSheet();
      return;
    }
  } catch (error) {
    // 사용자가 공유창을 닫은 경우도 여기로 옵니다. 다운로드로 넘기지 않고 조용히 끝냅니다.
    if (error?.name === "AbortError") {
      return;
    }
  }

  // 공유를 지원하지 않으면 다운로드 폴백입니다. (명세 §10 S11)
  savePhoto();
  state.photo = { ...state.photo, message: "공유를 지원하지 않아 PNG 로 저장했어요." };
  renderPhotoSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 촬영 화면을 그린다. 미리보기·조절·결과를 한 시트에 담는다. (명세 §10 S11)
 * 호출 예시: renderPhotoSheet()
 */
function renderPhotoSheet() {
  // 촬영 시트 컨테이너입니다.
  const sheet = select("#photo-sheet");

  if (!sheet) {
    return;
  }

  if (!state.photo.open) {
    sheet.hidden = true;
    sheet.replaceChildren();
    delete document.body.dataset.photoSheetOpen;
    return;
  }

  // 촬영에 쓰는 꿈돌이입니다.
  const entry = state.catalog.entries.find((item) => item.ggumdoriId === state.photo.ggumdoriId);

  sheet.hidden = false;
  document.body.dataset.photoSheetOpen = "true";
  sheet.replaceChildren();

  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closePhotoSheet);

  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "photo-sheet-title");

  // 상단 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  // 변수 의미: 사진 찍기 대상 꿈돌이 이름입니다(고정된 이름 집합이라 UI_STRINGS_EN에도 등록돼 있음).
  const photoGgumdoriName = entry?.ggumdoriName || "꿈돌이";
  const title = createElement(
    "h2",
    "px-label",
    localize(`${photoGgumdoriName}와 사진 찍기`, `Take a photo with ${UI_STRINGS_EN[photoGgumdoriName] || photoGgumdoriName}`),
  );
  title.id = "photo-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", "촬영 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closePhotoSheet);

  head.append(titleGroup, closeButton);

  const body = createElement("div", "quest-sheet__body");

  if (state.photo.resultDataUrl) {
    // 결과 화면입니다.
    const resultBox = createElement("div", "photo-stage");
    const resultImage = document.createElement("img");
    resultImage.className = "photo-result";
    resultImage.src = state.photo.resultDataUrl;
    resultImage.alt = "합성한 사진";
    resultBox.append(resultImage);
    body.append(resultBox);
  } else {
    // 미리보기 화면입니다. 배경 위에 꿈돌이를 얹어 보여 줍니다.
    const stage = createElement("div", "photo-stage");

    if (state.photo.source === "camera") {
      const video = document.createElement("video");
      video.id = "photo-video";
      video.className = "photo-source";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      stage.append(video);
    } else if (state.photo.pickedImageUrl) {
      const picked = document.createElement("img");
      picked.id = "photo-picked";
      picked.className = "photo-source";
      picked.src = state.photo.pickedImageUrl;
      picked.alt = "고른 사진";
      stage.append(picked);
    } else {
      stage.append(createElement("p", "photo-placeholder", "카메라를 켜거나 사진을 골라주세요."));
    }

    // 미리보기 위에 얹는 꿈돌이입니다. 모션 에셋이 있으면 여기서 움직입니다. (명세 §5.4)
    if (entry?.ggumdoriImageRef) {
      const overlay = document.createElement("img");
      overlay.className = "photo-overlay";
      overlay.src = entry.ggumdoriImageRef;
      overlay.alt = "";
      overlay.style.height = `${state.photo.scale}%`;
      overlay.style.insetInlineStart = `${state.photo.offsetX}%`;
      stage.append(overlay);
    }

    body.append(stage);

    // 크기와 좌우 위치 조절입니다. (명세 §10 S11)
    const controls = createElement("section", "px-panel");
    controls.append(createElement("h3", "section-title", "캐릭터 조절"));
    controls.append(createPhotoSlider("크기", "scale", 15, 90, state.photo.scale));
    controls.append(createPhotoSlider("좌우 위치", "offsetX", 5, 95, state.photo.offsetX));
    body.append(controls);
  }

  // 안내 문구입니다.
  if (state.photo.message) {
    const message = createElement("p", "data-note", state.photo.message);
    message.setAttribute("aria-live", "polite");
    body.append(message);
  }

  // 인증 사진을 자동으로 쓰지 않는다는 점을 밝힙니다. (명세 §15.2)
  body.append(
    createElement("p", "data-note", "인증 사진은 여기에 자동으로 불러오지 않아요. 합성은 기기 안에서만 처리합니다."),
  );

  // 하단 고정 버튼입니다.
  const footer = createElement("div", "quest-sheet__cta photo-cta");

  if (state.photo.resultDataUrl) {
    const retakeButton = createElement("button", "px-button px-button--ghost", "다시 찍기");
    retakeButton.type = "button";
    retakeButton.addEventListener("click", retakePhoto);

    const saveButton = createElement("button", "px-button px-button--ghost", "PNG로 저장");
    saveButton.type = "button";
    saveButton.addEventListener("click", savePhoto);

    const shareButton = createElement("button", "px-button px-button--primary", "공유하기");
    shareButton.type = "button";
    shareButton.addEventListener("click", sharePhoto);

    footer.append(retakeButton, saveButton, shareButton);
  } else {
    // 사진 고르기는 항상 제공합니다. 카메라를 거부해도 촬영을 이어갈 수 있습니다. (명세 §10 S11)
    const pickLabel = createElement("label", "px-button px-button--ghost", "사진 고르기");
    const pickInput = document.createElement("input");
    pickInput.type = "file";
    pickInput.accept = "image/*";
    pickInput.className = "px-sr-only";
    pickInput.addEventListener("change", (event) => usePickedPhoto(event.target.files?.[0]));
    pickLabel.append(pickInput);

    const shutterButton = createElement("button", "px-button px-button--primary", "촬영");
    shutterButton.type = "button";
    shutterButton.disabled = state.photo.source !== "camera" && !state.photo.pickedImageUrl;
    shutterButton.addEventListener("click", capturePhoto);

    footer.append(pickLabel, shutterButton);
  }

  panel.append(head, body, footer);
  sheet.append(scrim, panel);
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#photo-sheet-title")?.focus({ preventScroll: true });
}

/**
 * 입력: 라벨, 상태 키, 최솟값, 최댓값, 현재 값.
 * 출력: 슬라이더 행 요소.
 * 역할: 캐릭터 크기와 좌우 위치를 같은 모양으로 조절한다. (명세 §10 S11)
 * 호출 예시: createPhotoSlider("크기", "scale", 15, 90, 40)
 */
function createPhotoSlider(label, key, min, max, value) {
  // 슬라이더 한 줄입니다.
  const row = createElement("div", "photo-slider");
  const labelElement = createElement("label", "photo-slider__label", label);
  labelElement.htmlFor = `photo-slider-${key}`;

  const input = document.createElement("input");
  input.type = "range";
  input.id = `photo-slider-${key}`;
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener("input", (event) => {
    state.photo = { ...state.photo, [key]: Number(event.target.value) };
    // 미리보기만 즉시 갱신해 슬라이더 조작이 끊기지 않게 합니다.
    const overlay = select(".photo-overlay");
    if (overlay) {
      overlay.style.height = `${state.photo.scale}%`;
      overlay.style.insetInlineStart = `${state.photo.offsetX}%`;
    }
  });

  row.append(labelElement, input);
  return row;
}

/* ──────────────────────────────────────────────
   TAP-TO-START 시작 화면과 배경음악(BGM)
   ────────────────────────────────────────────── */

// 시작 화면 로딩 바가 추적하는 항목입니다. 전부 끝나야 TAP TO START로 바뀝니다.
const START_SCREEN_TASKS = ["splashImage", "iconFont", "bgmReady", "authProviders", "geolocation"];
// 느린 네트워크 등으로 항목 하나가 안 끝나도 화면이 멈추지 않도록 두는 최대 대기 시간입니다.
const START_SCREEN_TASK_TIMEOUT_MS = 8000;
// 로컬 서버 등에서는 실제 로딩이 순식간에 끝나 로딩 바가 스쳐 지나가듯 사라지므로,
// 실제 로딩이 이보다 빨리 끝나도 최소 이 시간만큼은 로딩 연출을 보여준다.
const START_SCREEN_MIN_DURATION_MS = 1500;
// 진행률 갱신 주기입니다. 부드럽게 차오르도록 짧게 잡습니다.
const START_SCREEN_TICK_MS = 80;

// 시작 화면 로딩 항목별 완료 여부입니다.
const startScreenTaskDone = Object.fromEntries(START_SCREEN_TASKS.map((task) => [task, false]));
// 로딩을 시작한 시각(performance.now() 기준)입니다.
let startScreenLoadStartedAt = 0;
// 진행률 갱신 타이머 id입니다.
let startScreenTickerId = null;

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 경과 시간과 실제 로딩 완료 여부를 함께 반영해 로딩 바를 갱신한다.
 *       실제 로딩이 먼저 끝나도 최소 시간 전에는 99%에서 멈추고, 최소 시간이 지나도
 *       실제 로딩이 안 끝났으면 100%를 보여주지 않는다. 둘 다 끝나야 TAP TO START로 바뀐다.
 * 호출 예시: updateStartScreenDisplay()
 */
function updateStartScreenDisplay() {
  // 변수 의미: 로딩 시작 이후 지난 시간(ms)입니다.
  const elapsedMs = performance.now() - startScreenLoadStartedAt;
  // 변수 의미: 항목 네 개가 모두 끝났는지 여부입니다.
  const allTasksDone = Object.values(startScreenTaskDone).every(Boolean);
  // 변수 의미: 시간 기준 진행률입니다. 실제 로딩이 안 끝났으면 99%를 넘지 않습니다.
  const timePercent = Math.round((elapsedMs / START_SCREEN_MIN_DURATION_MS) * 100);
  const percent = Math.max(0, Math.min(allTasksDone ? 100 : 99, timePercent));

  const fill = select("#start-screen-progress-fill");
  const bar = select("#start-screen-progress-bar");
  const text = select("#start-screen-loading-text");
  if (fill) {
    fill.style.width = `${percent}%`;
  }
  if (bar) {
    bar.setAttribute("aria-valuenow", String(percent));
    bar.setAttribute("aria-label", `로딩 중 ${percent}퍼센트`);
  }
  if (text) {
    text.textContent = `Loading... ${percent}%`;
  }

  if (percent >= 100 && allTasksDone) {
    if (startScreenTickerId !== null) {
      window.clearInterval(startScreenTickerId);
      startScreenTickerId = null;
    }
    state.startScreenReady = true;
    select("#start-screen-loading")?.setAttribute("hidden", "");
    select("#start-screen-hint")?.removeAttribute("hidden");
  }
}

/**
 * 입력: 완료된 로딩 항목 이름.
 * 출력: 없음.
 * 역할: 로딩 항목 하나를 끝난 것으로 표시하고 화면을 갱신한다. 실제로 100%가 되는 시점은
 *       updateStartScreenDisplay()가 최소 시간과 함께 판단한다.
 * 호출 예시: markStartScreenTaskDone("splashImage")
 */
function markStartScreenTaskDone(taskName) {
  if (!(taskName in startScreenTaskDone) || startScreenTaskDone[taskName]) {
    return;
  }
  startScreenTaskDone[taskName] = true;
  updateStartScreenDisplay();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 스플래시 이미지·폰트·배경음악·인증 서버 연결 네 가지 준비 상태를 각각 추적해 로딩 바에 반영한다.
 *       하나가 너무 오래 걸려도(느린 네트워크 등) 정해진 시간 뒤 강제로 완료 처리해 화면이 멈추지 않게 한다.
 * 호출 예시: setupStartScreenLoading()
 */
function setupStartScreenLoading() {
  startScreenLoadStartedAt = performance.now();

  // 스플래시 이미지입니다. 이미 캐시로 로드가 끝나 있을 수도 있습니다.
  const splashImage = select(".start-screen__image");
  if (splashImage?.complete) {
    markStartScreenTaskDone("splashImage");
  } else {
    splashImage?.addEventListener("load", () => markStartScreenTaskDone("splashImage"), { once: true });
    splashImage?.addEventListener("error", () => markStartScreenTaskDone("splashImage"), { once: true });
  }

  // 아이콘·본문 폰트입니다.
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => markStartScreenTaskDone("iconFont"));
  } else {
    markStartScreenTaskDone("iconFont");
  }

  // 배경음악입니다. 끊김 없이 재생할 수 있을 만큼 받아졌을 때 완료로 봅니다.
  const bgmAudio = getBgmAudioElement();
  if (bgmAudio && bgmAudio.readyState >= 3) {
    markStartScreenTaskDone("bgmReady");
  } else {
    bgmAudio?.addEventListener("canplaythrough", () => markStartScreenTaskDone("bgmReady"), { once: true });
    bgmAudio?.addEventListener("error", () => markStartScreenTaskDone("bgmReady"), { once: true });
  }

  // 느린 네트워크 등으로 항목 하나가 끝내 안 끝나도 화면이 멈추지 않도록 강제로 전부 완료 처리합니다.
  window.setTimeout(() => {
    START_SCREEN_TASKS.forEach((task) => markStartScreenTaskDone(task));
  }, START_SCREEN_TASK_TIMEOUT_MS);

  // 최소 노출 시간 동안 진행률이 부드럽게 차오르도록 주기적으로 갱신합니다.
  // 실제 로딩이 다 끝나면 updateStartScreenDisplay()가 알아서 타이머를 멈춥니다.
  updateStartScreenDisplay();
  startScreenTickerId = window.setInterval(updateStartScreenDisplay, START_SCREEN_TICK_MS);
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 시작 화면을 닫는다. 이때의 클릭/키 입력을 배경음악 자동재생 허용 계기로 그대로 쓴다.
 *       로딩이 끝나기 전(state.startScreenReady가 false)에는 닫지 않는다.
 * 호출 예시: dismissStartScreen()
 */
function dismissStartScreen() {
  const startScreen = select("#start-screen");
  if (!startScreen || startScreen.hidden || !state.startScreenReady) {
    return;
  }
  startScreen.classList.add("is-dismissing");
  window.setTimeout(() => {
    startScreen.hidden = true;
    startScreen.classList.remove("is-dismissing");
  }, 350);

  if (state.appSettings.musicEnabled) {
    startBackgroundMusic();
  }
}

/**
 * 입력: 없음.
 * 출력: 배경음악 audio 엘리먼트 또는 null.
 * 역할: 정적 HTML에 있는 배경음악 엘리먼트를 찾는다.
 * 호출 예시: getBgmAudioElement()?.pause()
 */
function getBgmAudioElement() {
  return select("#bgm-audio");
}

/**
 * 입력: 없음.
 * 출력: 0~1 사이 실제 재생 음량.
 * 역할: 전체 음량과 배경음 음량 두 슬라이더를 곱해 최종 음량을 만든다.
 * 호출 예시: audio.volume = computeBgmVolume()
 */
function computeBgmVolume() {
  const masterVolume = toNumber(state.appSettings.masterVolume, 60) / 100;
  const musicVolume = toNumber(state.appSettings.musicVolume, 40) / 100;
  return Math.min(1, Math.max(0, masterVolume * musicVolume));
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 배경음 켜짐 여부와 음량 설정을 지금 바로 반영한다. (명세 §10 S12)
 * 호출 예시: applyBgmSettings()
 */
function applyBgmSettings() {
  const audio = getBgmAudioElement();
  if (!audio) {
    return;
  }
  audio.volume = computeBgmVolume();
  if (state.appSettings.musicEnabled) {
    startBackgroundMusic();
  } else {
    pauseBackgroundMusic();
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 배경음이 꺼져 있지 않으면 재생한다. 브라우저 자동재생 정책으로 실패해도 조용히 넘어간다.
 * 호출 예시: startBackgroundMusic()
 */
function startBackgroundMusic() {
  const audio = getBgmAudioElement();
  if (!audio || !state.appSettings.musicEnabled) {
    return;
  }
  audio.volume = computeBgmVolume();
  audio.play().catch(() => {
    // 사용자 상호작용 전이라 자동재생이 막힌 경우입니다. 설정에서 다시 켤 수 있습니다.
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 배경음악을 멈춘다. 오디오 가이드 재생 중 겹치지 않게 할 때도 쓴다.
 * 호출 예시: pauseBackgroundMusic()
 */
function pauseBackgroundMusic() {
  getBgmAudioElement()?.pause();
}

/* ──────────────────────────────────────────────
   마이페이지 설정·권한·정보 (명세 §10 S12)
   앱 음량만 조절하며 시스템 음량을 바꾸는 것처럼 표현하지 않는다.
   ────────────────────────────────────────────── */

// 설정 항목 정의입니다. 순서와 문구가 명세 §10 S12 와 같습니다.
const APP_SETTING_GROUPS = [
  {
    title: "소리와 진동",
    // 앱 안에서만 적용된다는 점을 분명히 합니다. (명세 §10 S12)
    note: "앱에서 나는 소리만 조절해요. 기기 전체 음량은 바뀌지 않습니다.",
    items: [
      { key: "masterVolume", label: "전체 음량", type: "range" },
      { key: "musicVolume", label: "배경음", type: "range", muteKey: "musicEnabled" },
      { key: "effectVolume", label: "효과음", type: "range", muteKey: "effectEnabled" },
      { key: "vibration", label: "진동", type: "toggle" },
    ],
  },
  {
    title: "알림",
    // 알림 권한은 켜는 순간에만 요청합니다. (명세 §10 S12, §9.5)
    note: "알림을 켜는 순간에만 브라우저 권한을 요청해요.",
    items: [
      { key: "questNotification", label: "퀘스트 알림", type: "toggle", needsPermission: true },
      { key: "festivalNotification", label: "행사·축제 알림", type: "toggle", needsPermission: true },
      { key: "rewardNotification", label: "보상 알림", type: "toggle", needsPermission: true },
    ],
  },
  {
    title: "화면",
    note: "",
    items: [{ key: "reducedMotion", label: "모션 줄이기", type: "toggle" }],
  },
];

/**
 * 입력: 없음.
 * 출력: 저장된 앱 설정 객체.
 * 역할: 브라우저에 남긴 설정을 복원한다. 없으면 기본값을 쓴다. (명세 §10 S12)
 * 호출 예시: state.appSettings = readAppSettings()
 */
function readAppSettings() {
  // 기본값입니다. 소리는 중간, 알림은 꺼진 상태에서 시작합니다.
  const defaults = {
    masterVolume: 60,
    musicEnabled: true,
    musicVolume: 40,
    effectEnabled: true,
    effectVolume: 70,
    vibration: true,
    questNotification: false,
    festivalNotification: false,
    rewardNotification: false,
    reducedMotion: readStorageValue(REDUCED_MOTION_KEY) === "true",
  };

  try {
    // 저장된 설정입니다.
    const saved = JSON.parse(readStorageValue(APP_SETTINGS_KEY) || "{}");
    return { ...defaults, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch (error) {
    return defaults;
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 앱 설정을 브라우저에 저장한다.
 * 호출 예시: persistAppSettings()
 */
function persistAppSettings() {
  writeStorageValue(APP_SETTINGS_KEY, JSON.stringify(state.appSettings));
  // 모션 줄이기는 기존 키와도 맞춰 둡니다. 다른 코드가 이 키를 봅니다.
  writeStorageValue(REDUCED_MOTION_KEY, String(state.appSettings.reducedMotion));
}

/**
 * 입력: 설정 키와 새 값.
 * 출력: 설정 반영 Promise.
 * 역할: 설정 하나를 바꾸고 필요한 권한을 그때 요청한다. (명세 §10 S12)
 * 호출 예시: await changeAppSetting("questNotification", true)
 */
async function changeAppSetting(key, value) {
  // 알림을 켜는 경우에만 브라우저 권한을 요청합니다. (명세 §9.5)
  if (value === true && APP_SETTING_GROUPS[1].items.some((item) => item.key === key)) {
    // 권한 요청 결과입니다.
    const granted = await requestNotificationPermission();
    if (!granted) {
      state.settingsMessage = "알림 권한이 없어 켤 수 없어요. 브라우저 설정에서 알림을 허용해주세요.";
      renderSettings();
      return;
    }
  }

  state.appSettings = { ...state.appSettings, [key]: value };
  state.settingsMessage = "";
  persistAppSettings();

  if (key === "reducedMotion") {
    state.reducedMotion = value;
    applyReducedMotion();
  }

  if (key === "musicEnabled" || key === "musicVolume" || key === "masterVolume") {
    applyBgmSettings();
  }

  renderSettings();
}

/**
 * 입력: 없음.
 * 출력: 권한을 받았는지 여부 Promise.
 * 역할: 알림 권한을 사용자가 알림을 켜는 순간에만 요청한다. (명세 §9.5, §10 S12)
 * 호출 예시: const granted = await requestNotificationPermission()
 */
async function requestNotificationPermission() {
  if (typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }

  try {
    return (await Notification.requestPermission()) === "granted";
  } catch (error) {
    return false;
  }
}

/**
 * 입력: 없음.
 * 출력: 권한 상태 갱신 Promise.
 * 역할: 위치·카메라·알림의 현재 권한 상태를 읽는다. 요청하지는 않는다. (명세 §10 S12)
 * 호출 예시: await refreshPermissionStates()
 */
async function refreshPermissionStates() {
  // 브라우저에 물어본 권한 상태입니다.
  const next = { location: "unknown", camera: "unknown", notification: "unknown" };

  if (typeof Notification !== "undefined") {
    next.notification = Notification.permission;
  }

  if (navigator.permissions?.query) {
    for (const [key, name] of [
      ["location", "geolocation"],
      ["camera", "camera"],
    ]) {
      try {
        next[key] = (await navigator.permissions.query({ name })).state;
      } catch (error) {
        // 이 브라우저가 해당 권한 조회를 지원하지 않는 경우입니다.
        next[key] = "unknown";
      }
    }
  }

  state.permissionStates = next;
  renderSettings();
}

/**
 * 입력: 권한 상태 값.
 * 출력: 한국어 상태 문구.
 * 역할: 권한 상태를 사용자가 읽을 수 있는 말로 바꾼다. (명세 §10 S12)
 * 호출 예시: getPermissionLabel("granted")
 */
function getPermissionLabel(permissionState) {
  // 상태별 표시 문구입니다.
  const labels = {
    granted: "허용됨",
    denied: "거부됨",
    prompt: "요청 전",
    default: "요청 전",
    unknown: "확인 불가",
  };

  return labels[permissionState] || "확인 불가";
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 설정·권한·정보 영역을 그린다. (명세 §10 S12)
 * 호출 예시: renderSettings()
 */
function renderSettings() {
  // 설정 영역 컨테이너입니다.
  const panel = select("#me-settings");

  if (!panel) {
    return;
  }

  panel.replaceChildren();

  APP_SETTING_GROUPS.forEach((group) => {
    // 설정 묶음 하나입니다.
    const section = createElement("section", "setting-group");
    section.append(createElement("h4", "setting-group__title", group.title));

    group.items.forEach((item) => {
      // 설정 한 줄입니다.
      const row = createElement("div", "setting-row");
      const label = createElement("label", "setting-row__label", item.label);
      label.htmlFor = `setting-${item.key}`;
      row.append(label);

      if (item.type === "range") {
        // 음소거 여부입니다. muteKey가 없는 슬라이더(전체 음량)는 항상 켜진 것으로 봅니다.
        const isMuted = item.muteKey ? !state.appSettings[item.muteKey] : false;

        // 게이지 바 왼쪽의 음소거 버튼입니다. muteKey가 있는 항목(배경음·효과음)에만 붙입니다.
        if (item.muteKey) {
          const muteButton = createElement("button", "setting-row__mute");
          muteButton.type = "button";
          muteButton.id = `setting-${item.muteKey}`;
          muteButton.setAttribute("aria-pressed", String(!isMuted));
          muteButton.setAttribute("aria-label", isMuted ? `${item.label} 켜기` : `${item.label} 끄기`);
          muteButton.append(
            createElement("span", "px-icon px-icon--sm", isMuted ? "volume_off" : "volume_up"),
          );
          muteButton.addEventListener("click", () => {
            changeAppSetting(item.muteKey, !state.appSettings[item.muteKey]);
          });
          row.append(muteButton);
        }

        // 음량 슬라이더입니다.
        const input = document.createElement("input");
        input.type = "range";
        input.id = `setting-${item.key}`;
        input.min = "0";
        input.max = "100";
        input.value = String(state.appSettings[item.key]);
        input.disabled = isMuted;
        input.addEventListener("change", (event) => changeAppSetting(item.key, Number(event.target.value)));
        // 값 표시입니다. 슬라이더를 끌 때 즉시 갱신합니다.
        const value = createElement("span", "setting-row__value", `${state.appSettings[item.key]}`);
        input.addEventListener("input", (event) => {
          value.textContent = event.target.value;
        });
        row.append(input, value);
      } else {
        // 켜고 끄는 설정입니다.
        const input = document.createElement("input");
        input.type = "checkbox";
        input.id = `setting-${item.key}`;
        input.checked = Boolean(state.appSettings[item.key]);
        input.addEventListener("change", (event) => changeAppSetting(item.key, event.target.checked));
        row.append(input);
      }

      section.append(row);
    });

    if (group.note) {
      section.append(createElement("p", "data-note", group.note));
    }

    panel.append(section);
  });

  if (state.settingsMessage) {
    const message = createElement("p", "data-note account-warning", state.settingsMessage);
    message.setAttribute("aria-live", "polite");
    panel.append(message);
  }

  renderPermissionStates();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 위치·카메라·알림 권한 상태를 표시한다. (명세 §10 S12)
 * 호출 예시: renderPermissionStates()
 */
function renderPermissionStates() {
  // 권한 상태 영역입니다.
  const panel = select("#me-permissions");

  if (!panel) {
    return;
  }

  panel.replaceChildren();

  [
    ["위치", state.permissionStates.location, "퀘스트 추천과 완료 인증에 씁니다."],
    ["카메라", state.permissionStates.camera, "사진 인증과 꿈돌이 촬영에 씁니다."],
    ["알림", state.permissionStates.notification, "퀘스트·행사·보상 알림에 씁니다."],
  ].forEach(([name, permissionState, purpose]) => {
    // 권한 한 줄입니다.
    const row = createElement("div", "permission-row");
    const main = createElement("div", "permission-row__main");
    main.append(
      createElement("span", "permission-row__name", name),
      createElement("span", "permission-row__purpose", purpose),
    );
    row.append(main);
    row.append(
      createElement(
        "span",
        permissionState === "granted"
          ? "status-badge status-badge--done"
          : permissionState === "denied"
            ? "status-badge status-badge--locked"
            : "status-badge status-badge--available",
        getPermissionLabel(permissionState),
      ),
    );
    panel.append(row);
  });

  panel.append(
    createElement("p", "data-note", "권한은 해당 기능을 실제로 쓸 때 요청해요. 브라우저 설정에서 언제든 바꿀 수 있습니다."),
  );
}

/* ──────────────────────────────────────────────
   나의 모험 기록 (명세 §10 S13)
   마이페이지에서만 진입한다. 인증 원본 사진은 공유 카드에 넣지 않는다. (§15.2)
   ────────────────────────────────────────────── */

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 모험 기록 화면을 연다. 마이페이지에서만 부른다. (명세 §10 S13)
 * 호출 예시: openRecordSheet()
 */
function openRecordSheet() {
  state.recordSheetOpen = true;
  state.recordDetailId = "";
  state.recordReturnFocus = document.activeElement;
  renderRecordSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 모험 기록 화면을 닫고 포커스를 되돌린다.
 * 호출 예시: closeRecordSheet()
 */
function closeRecordSheet() {
  if (!state.recordSheetOpen) {
    return;
  }

  // 상세를 보고 있었다면 목록으로만 돌아갑니다.
  if (state.recordDetailId) {
    state.recordDetailId = "";
    renderRecordSheet();
    return;
  }

  state.recordSheetOpen = false;
  renderRecordSheet();

  const target = state.recordReturnFocus;
  if (target instanceof HTMLElement && target.isConnected) {
    target.focus({ preventScroll: true });
  }
  state.recordReturnFocus = null;
}

/**
 * 입력: 없음.
 * 출력: 월 → 기록 배열 형태의 묶음.
 * 역할: 완료 기록을 월별로 묶고 각 월 안에서 최신순으로 둔다. (명세 §10 S13)
 * 호출 예시: const groups = groupNotesByMonth()
 */
function groupNotesByMonth() {
  // 월 키 → 기록 목록입니다.
  const groups = new Map();

  [...state.notes]
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .forEach((note) => {
      // 이 기록이 속한 월입니다. KST 기준으로 묶습니다.
      const dateKey = normalizeDateKey(note.createdAt);
      const monthKey = dateKey ? dateKey.slice(0, 7) : "날짜 미상";
      if (!groups.has(monthKey)) {
        groups.set(monthKey, []);
      }
      groups.get(monthKey).push(note);
    });

  return groups;
}

/**
 * 입력: YYYY-MM 문자열.
 * 출력: 화면에 표시할 월 제목.
 * 역할: 월 구분선을 한국어로 보여 준다.
 * 호출 예시: formatMonthLabel("2026-06")
 */
function formatMonthLabel(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return monthKey;
  }

  return `${monthKey.slice(0, 4)}년 ${Number(monthKey.slice(5, 7))}월`;
}

/**
 * 입력: 기록 식별자.
 * 출력: 이 기록에 연결된 축제 방문 또는 null.
 * 역할: 행사형 완료는 실제 방문한 행사명과 회차를 보존한다. (명세 §10 S13, §11.1)
 * 호출 예시: findFestivalVisitForNote(note)
 */
function findFestivalVisitForNote(note) {
  // 같은 날 같은 장소에서 기록된 축제 방문입니다.
  const noteDate = normalizeDateKey(note.createdAt);

  return (
    state.festivalVisits.find(
      (visit) => normalizeDateKey(visit.visitedAt) === noteDate && visit.title && note.title.includes("축제"),
    ) || null
  );
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 월별 목록과 기록 상세를 한 시트에서 그린다. (명세 §10 S13)
 * 호출 예시: renderRecordSheet()
 */
function renderRecordSheet() {
  // 모험 기록 시트 컨테이너입니다.
  const sheet = select("#record-sheet");

  if (!sheet) {
    return;
  }

  if (!state.recordSheetOpen) {
    sheet.hidden = true;
    sheet.replaceChildren();
    delete document.body.dataset.recordSheetOpen;
    return;
  }

  sheet.hidden = false;
  document.body.dataset.recordSheetOpen = "true";
  sheet.replaceChildren();

  const scrim = createElement("div", "quest-sheet__scrim");
  scrim.addEventListener("click", closeRecordSheet);

  const panel = createElement("section", "quest-sheet__panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "record-sheet-title");

  // 현재 상세로 보고 있는 기록입니다.
  const detail = state.recordDetailId
    ? state.notes.find((note) => note.id === state.recordDetailId) || null
    : null;

  // 상단 고정 머리말입니다.
  const head = createElement("header", "quest-sheet__head px-dialog__bar");
  const titleGroup = createElement("div", "quest-sheet__title-group");
  const title = createElement("h2", "px-label", detail ? detail.title : "나의 모험 기록");
  title.id = "record-sheet-title";
  title.tabIndex = -1;
  titleGroup.append(title);

  const closeButton = createElement("button", "px-button px-button--ghost quest-sheet__close");
  closeButton.type = "button";
  closeButton.append(createElement("span", "px-sr-only", detail ? "목록으로" : "기록 닫기"));
  const closeIcon = createElement("span", "px-icon px-icon--sm", detail ? "arrow_back" : "close");
  closeIcon.setAttribute("aria-hidden", "true");
  closeButton.append(closeIcon);
  closeButton.addEventListener("click", closeRecordSheet);

  head.append(titleGroup, closeButton);
  panel.append(head);
  panel.append(detail ? createRecordDetail(detail) : createRecordList());
  sheet.append(scrim, panel);
  // 열린 시트 안에 포커스를 가둡니다. (명세 §13.3-5)
  trapFocus(panel);
  panel.querySelector("#record-sheet-title")?.focus({ preventScroll: true });
}

/**
 * 입력: 없음.
 * 출력: 월별 기록 목록 요소.
 * 역할: 완료 기록을 월·날짜 순으로 훑어볼 수 있게 한다. (명세 §10 S13)
 * 호출 예시: createRecordList()
 */
function createRecordList() {
  // 스크롤되는 본문입니다.
  const body = createElement("div", "quest-sheet__body");

  // 월별로 묶은 기록입니다.
  const groups = groupNotesByMonth();

  if (groups.size === 0) {
    const empty = createElement("div", "empty-state");
    empty.append(createElement("p", "empty-message", "아직 완료한 퀘스트가 없어요."));
    const browseButton = createElement("button", "px-button px-button--primary", "퀘스트 찾아보기");
    browseButton.type = "button";
    browseButton.addEventListener("click", () => {
      closeRecordSheet();
      setActiveView("quests");
    });
    empty.append(browseButton);
    body.append(empty);
    return body;
  }

  // 전체 완료 수와 획득 XP 요약입니다.
  const stats = createElement("div", "stat-row");
  stats.append(
    createStatCell("완료", localize(`${state.notes.length}개`, `${state.notes.length}`)),
    createStatCell("획득 XP", `${state.notes.reduce((sum, note) => sum + toNumber(note.earnedXp, 0), 0)}`),
    createStatCell("기간", localize(`${groups.size}개월`, `${groups.size} mo`)),
  );
  body.append(stats);

  groups.forEach((notes, monthKey) => {
    // 월 구분 묶음입니다.
    const section = createElement("section", "record-month");
    section.append(createElement("h3", "section-title", formatMonthLabel(monthKey)));

    notes.forEach((note) => {
      // 기록 한 줄입니다. 누르면 상세로 갑니다.
      const row = createElement("button", "quest-line");
      row.type = "button";

      const main = createElement("div", "quest-line__main");
      main.append(createElement("span", "quest-line__title", note.title));
      main.append(createElement("span", "quest-line__place", note.placeName));

      // 행사형은 실제 방문한 행사명과 회차를 함께 남깁니다. (명세 §10 S13)
      const visit = findFestivalVisitForNote(note);
      if (visit) {
        main.append(
          createElement("span", "quest-line__note event-note", `${visit.title} · ${visit.editionId} 회차 방문`),
        );
      }

      const meta = createElement("span", "quest-line__meta");
      meta.append(
        createElement("span", "px-counter", formatDate(note.createdAt)),
        createElement("span", "px-counter", `+${toNumber(note.earnedXp, 0)} XP`),
      );
      main.append(meta);

      row.append(main);
      row.addEventListener("click", () => {
        state.recordDetailId = note.id;
        renderRecordSheet();
      });
      section.append(row);
    });

    body.append(section);
  });

  return body;
}

/**
 * 입력: 기록 항목.
 * 출력: 기록 상세 요소.
 * 역할: 완료 기록의 세부 내용과 편집, 공유 카드를 제공한다. (명세 §10 S13)
 * 호출 예시: createRecordDetail(note)
 */
function createRecordDetail(note) {
  const body = createElement("div", "quest-sheet__body");

  // 언제 어디서 완료했는지입니다.
  const summary = createElement("section", "px-panel px-panel--inset");
  summary.append(createElement("span", "px-label quest-sheet__eyebrow", "완료 기록"));
  summary.append(createElement("p", "px-body", `${note.placeName} · ${formatDate(note.createdAt)}`));
  summary.append(createElement("p", "data-note", `획득 ${toNumber(note.earnedXp, 0)} XP`));
  body.append(summary);

  // 행사형이면 실제 방문한 행사명과 회차를 보존해 보여 줍니다. (명세 §10 S13, §11.1)
  const visit = findFestivalVisitForNote(note);
  if (visit) {
    const eventPanel = createElement("section", "px-panel");
    eventPanel.append(createElement("h3", "section-title", "방문한 행사"));
    eventPanel.append(createElement("p", "px-label", visit.title));
    eventPanel.append(createElement("p", "px-body", `${visit.editionId} 회차 · ${visit.venueName || "장소 미상"}`));
    body.append(eventPanel);
  }

  // 획득한 뱃지입니다.
  if ((note.badges || []).length > 0) {
    const badgePanel = createElement("section", "px-panel");
    badgePanel.append(createElement("h3", "section-title", "획득 보상"));
    const row = createElement("div", "card-summary");
    (note.badges || []).forEach((badge) => row.append(createElement("span", "px-tag", badge)));
    badgePanel.append(row);
    body.append(badgePanel);
  }

  // 인증 사진입니다. 본인에게만 보이고 공유 카드에는 넣지 않습니다. (명세 §10 S13, §15.2)
  if (note.photoRef) {
    const photoPanel = createElement("section", "px-panel");
    photoPanel.append(createElement("h3", "section-title", "인증 사진"));
    photoPanel.append(
      createElement("p", "data-note", "본인만 볼 수 있어요. 공유 카드에는 들어가지 않습니다."),
    );
    body.append(photoPanel);
  }

  // 일기·리뷰 편집입니다. (명세 §10 S13 기록 상세·편집)
  // 서버가 entry 를 주지 않은 기록도 있어 안전하게 읽습니다.
  const entry = note.entry || { type: "diary", body: "" };
  const entryPanel = createElement("section", "px-panel");
  entryPanel.append(createElement("h3", "section-title", entry.type === "review" ? "리뷰" : "일기"));

  const entryInput = document.createElement("textarea");
  entryInput.id = "record-entry-input";
  entryInput.rows = 4;
  entryInput.value = getNoteDraft(note).body;
  entryInput.setAttribute("aria-label", "기록 내용");
  entryPanel.append(entryInput);

  const saveRow = createElement("div", "account-field__controls");
  const saveButton = createElement("button", "px-button px-button--primary", "기록 저장");
  saveButton.type = "button";
  saveButton.disabled = Boolean(getNoteDraft(note).pending);
  saveButton.addEventListener("click", () => saveRecordEntry(note, entryInput.value));
  saveRow.append(saveButton);
  entryPanel.append(saveRow);
  body.append(entryPanel);

  // 시스템 공유 카드입니다. 닉네임·장소·뱃지·꿈돌이로만 구성합니다. (명세 §10 S13)
  body.append(createShareCard(note));

  if (state.recordMessage) {
    const message = createElement("p", "data-note", state.recordMessage);
    message.setAttribute("aria-live", "polite");
    body.append(message);
  }

  return body;
}

/**
 * 입력: 기록 항목.
 * 출력: 공유 카드 요소.
 * 역할: 닉네임·장소·뱃지·꿈돌이만 담은 공유 카드를 보여 준다. 인증 사진은 넣지 않는다. (명세 §10 S13, §15.2)
 * 호출 예시: createShareCard(note)
 */
function createShareCard(note) {
  const panel = createElement("section", "px-panel");
  panel.append(createElement("h3", "section-title", "공유 카드"));

  // 카드 본문입니다.
  const card = createElement("div", "share-card");

  // 대표 꿈돌이 그림입니다.
  const featured = getSelectedGgumdori();
  if (featured?.imageRef) {
    const image = document.createElement("img");
    image.className = "share-card__art";
    image.src = featured.imageRef;
    image.alt = "";
    card.append(image);
  }

  const meta = createElement("div", "share-card__meta");
  meta.append(createElement("span", "share-card__name", displayNickname(state.user.nickname) || localize("모험가", "Adventurer")));
  meta.append(createElement("span", "share-card__place", note.placeName));
  if ((note.badges || []).length > 0) {
    meta.append(createElement("span", "share-card__badge", note.badges[0]));
  }
  card.append(meta);
  panel.append(card);

  panel.append(
    createElement("p", "data-note", "닉네임·장소·뱃지·꿈돌이만 담습니다. 인증 사진은 공유되지 않아요."),
  );

  return panel;
}

/**
 * 입력: 기록 항목과 새 본문.
 * 출력: 저장 Promise.
 * 역할: 일기·리뷰 내용을 고쳐 저장한다. (명세 §10 S13)
 * 호출 예시: await saveRecordEntry(note, "오늘의 기록")
 */
async function saveRecordEntry(note, body) {
  // 저장 결과가 속한 계정과 기록 편집 초안입니다.
  const isCurrentSession = captureSession();
  const draft = getNoteDraft(note);
  if (!isCurrentSession() || draft.pending) {
    return;
  }
  draft.body = String(body || "").trim();
  await saveNoteEntry(note.id);
  if (!isCurrentSession()) {
    return;
  }
  state.recordMessage = state.noteDrafts[note.id]?.message || "";
  renderRecordSheet();
}

/**
 * 입력: 시트 패널 요소.
 * 출력: 없음.
 * 역할: 열린 시트 안에서만 Tab 이 돌도록 포커스를 가둔다. (명세 §13.3-5)
 *       시트가 사라지면 리스너도 함께 사라지므로 따로 해제하지 않는다.
 * 호출 예시: trapFocus(panel)
 */
function trapFocus(panel) {
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") {
      return;
    }

    // 시트 안에서 초점을 받을 수 있는 요소들입니다.
    const focusable = [
      ...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // 끝에서 앞으로, 처음에서 뒤로 넘어가게 감쌉니다.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

/**
 * 입력: 없음.
 * 출력: 오버레이를 하나 닫았는지 여부.
 * 역할: 뒤로가기가 화면을 넘기기 전에 열려 있는 시트를 위에서부터 하나만 닫는다. (명세 §7.4)
 * 호출 예시: if (closeTopOverlay()) return;
 */
function closeTopOverlay() {
  // 나중에 연 것이 위에 있으므로 이 순서로 검사합니다.
  if (state.photo.open) {
    closePhotoSheet();
    return true;
  }
  if (state.recordSheetOpen) {
    closeRecordSheet();
    return true;
  }
  if (state.planSheetOpen) {
    closePlanSheet();
    return true;
  }
  if (state.weatherSheetOpen) {
    closeWeatherSheet();
    return true;
  }
  if (state.catalogSheetId) {
    closeCatalogSheet();
    return true;
  }
  if (state.questSheetId) {
    closeQuestSheet();
    return true;
  }

  return false;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 전체 화면을 현재 상태 기준으로 다시 그린다.
 * 호출 예시: renderAll()
 */
function renderAll() {
  renderAppHeader();
  renderDrawerNavigation();
  renderDrawerProfile();
  renderHomeContext();
  renderProfile();
  renderHomeMetrics();
  renderRecentBadges();
  renderHomeRecommendations();
  renderRecommendationMeta();
  renderRecommendations();
  renderAdventure();
  renderQuestBoard();
  renderMapView();
  renderNotes();
  renderWeather();
  renderWeatherSheet();
  renderPlanSheet();
  renderAccountPanel();
  renderCollection();
  renderCatalogSheet();
  renderQuestSheet();
  renderActionDialog();
}

/**
 * 입력: 카테고리 코드.
 * 출력: 없음.
 * 역할: 카테고리 필터 버튼 상태와 추천 목록을 갱신한다.
 * 호출 예시: setCategory("science")
 */
function setCategory(category) {
  if (!ensureSessionReady()) {
    return;
  }

  if (!toServerCategory(category)) {
    state.recommendationMeta = {
      ...state.recommendationMeta,
      sourceStatus: "unsupported_category",
      attribution: "빵·미식과 축제·이벤트 분류는 준비 중입니다.",
    };
    renderRecommendationMeta();
    return;
  }

  state.selectedCategory = category;
  state.explorationMode === "planned"
    ? (state.plannedCategory = category)
    : (state.currentCategory = category);

  const filterButtons = document.querySelectorAll("[data-category]");
  filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === category);
  });

  loadRecommendations().catch(() => {
    renderRecommendations();
  });
}

/**
 * 입력: Geolocation API 옵션.
 * 출력: 현재 위치 Position Promise.
 * 역할: 위치 권한 요청을 Promise 흐름으로 감싸 완료 인증과 추천 기준 위치에서 함께 사용한다.
 * 호출 예시: const position = await readCurrentPosition({ enableHighAccuracy: true })
 */
function readCurrentPosition(options = {}) {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("이 브라우저에서는 위치 기능을 사용할 수 없습니다."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * 입력: 위도/경도 두 쌍.
 * 출력: 두 좌표 사이의 대략적인 거리(미터).
 * 역할: GPS 오차 좌표를 걸러내는 판정에만 쓸 근사 거리를 구한다(정밀한 지도 표시용 계산이 아님).
 * 호출 예시: const meters = approximateDistanceMeters(36.35, 127.38, 47.52, 18.96)
 */
function approximateDistanceMeters(lat1, lng1, lat2, lng2) {
  // 변수 의미: 지구 평균 반지름(미터)입니다.
  const earthRadiusMeters = 6371000;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 변수 의미: 대전 기준 좌표에서 이 거리(미터)를 넘어서면 GPS 오차로 보고 실측 위치를 거부한다.
// 대한민국 전역을 넉넉히 덮는 반경이라, 국내 사용자의 정상적인 위치는 절대 이 값을 넘지 않는다.
const PLAUSIBLE_LOCATION_RADIUS_METERS = 300000;

/**
 * 입력: 브라우저 Geolocation Position.
 * 출력: 화면 상태에 저장할 위치 객체.
 * 역할: 실측 좌표와 정확도를 추천 기준 위치 형식으로 변환한다. 대전 지역과 너무 먼 좌표는
 *       기기/네트워크 위치추정 오차로 보고 예외를 던져 호출자가 fallback 위치로 처리하게 한다.
 * 호출 예시: state.location = normalizeMeasuredLocation(position)
 */
function normalizeMeasuredLocation(position) {
  // 브라우저에서 받은 좌표 객체입니다.
  const coordinates = position.coords;

  // 위치 정확도 미터 값입니다.
  const accuracyMeters = toNumber(coordinates.accuracy, 999);

  // 변수 의미: 대전 기준 좌표와의 대략적인 거리입니다.
  const distanceFromDaejeonMeters = approximateDistanceMeters(
    coordinates.latitude,
    coordinates.longitude,
    FALLBACK_LOCATION.lat,
    FALLBACK_LOCATION.lng,
  );
  if (distanceFromDaejeonMeters > PLAUSIBLE_LOCATION_RADIUS_METERS) {
    throw new Error("위치 정보가 대전 지역과 너무 멀어 확인할 수 없습니다. 위치 서비스를 다시 확인해주세요.");
  }

  return {
    lat: coordinates.latitude,
    lng: coordinates.longitude,
    accuracyMeters,
    label: `현재 위치 기준, 정확도 ${Math.round(accuracyMeters)}m`,
    measured: true,
  };
}

/**
 * 입력: 바이트 수.
 * 출력: 화면 표시용 용량 문자열.
 * 역할: 업로드 제한 초과 메시지를 사람이 읽기 쉽게 만든다.
 * 호출 예시: const text = formatBytes(10485760)
 */
function formatBytes(bytes) {
  // 변수 의미: 숫자로 변환한 바이트 값입니다.
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) {
    return "0MB";
  }
  return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
}

/**
 * 입력: 업로드 오류 객체.
 * 출력: 사용자에게 보여줄 업로드 실패 문구.
 * 역할: Object Storage 설정 누락, 인증 만료, 네트워크 오류를 구분한다.
 * 호출 예시: const message = getEvidenceUploadFailureMessage(error)
 */
function getEvidenceUploadFailureMessage(error) {
  if (isUnauthorizedError(error)) {
    return "세션이 만료되어 사진을 업로드하지 않았습니다.";
  }
  if (Number(error?.status) === 503) {
    return error?.payload?.message || "Object Storage 또는 OCR 설정이 필요합니다.";
  }
  return error?.message || "사진 업로드에 실패했습니다.";
}

/**
 * 입력: presigned 업로드 정보와 이미지 파일.
 * 출력: 업로드 완료 Promise.
 * 역할: 앱 서버를 경유하지 않고 Object Storage로 사진 파일을 전송한다.
 * 호출 예시: await uploadEvidenceFile(upload, file)
 */
async function uploadEvidenceFile(upload, file) {
  // 변수 의미: Object Storage 업로드 응답입니다.
  const response = await fetch(upload.url, {
    method: upload.method || "PUT",
    headers: upload.headers || { "Content-Type": file.type },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Object Storage 업로드 실패: ${response.status}`);
  }
}

/**
 * 입력: 추천 항목과 업로드된 증빙 상태.
 * 출력: OCR 요청 Promise.
 * 역할: 영수증 사진을 OCR로 읽고 퀘스트 요구사항 대조 결과를 상태에 저장한다.
 * 호출 예시: await runReceiptOcr(recommendation, evidence)
 */
async function runReceiptOcr(recommendation, evidence) {
  // 이전 계정의 OCR 결과를 새 세션에 반영하지 않습니다.
  const isCurrentSession = captureSession();
  // 변수 의미: OCR 대상 퀘스트 인스턴스 ID입니다.
  const instanceId = recommendation.instanceId;
  state.evidenceUploads[instanceId] = { ...evidence, ocrStatus: "running" };
  renderAll();

  try {
    // OCR API 응답입니다.
    const payload = await fetchJson("/api/ocr/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questInstanceId: instanceId,
        objectKey: evidence.objectKey,
        contentType: evidence.contentType,
      }),
    });
    if (!isCurrentSession()) {
      return;
    }
    state.evidenceUploads[instanceId] = {
      ...evidence,
      ocrStatus: "done",
      ocrText: payload.ocr?.text || "",
      ocrLines: payload.ocr?.lines || [],
      requirementCheck: payload.requirementCheck || null,
    };
    updateSystemStatus(true, getReceiptRequirementText(payload.requirementCheck) || "OCR 확인 완료");
  } catch (error) {
    if (!isCurrentSession()) {
      return;
    }
    state.evidenceUploads[instanceId] = {
      ...evidence,
      ocrStatus: "failed",
      message: getEvidenceUploadFailureMessage(error),
    };
    updateSystemStatus(state.apiHealthy, "사진은 업로드됐고 OCR 확인은 실패했습니다.");
  } finally {
    if (isCurrentSession()) {
      renderAll();
    }
  }
}

/**
 * 입력: 추천 항목과 사용자가 선택한 이미지 파일.
 * 출력: 업로드 처리 Promise.
 * 역할: presigned URL 발급, Object Storage 직접 업로드, 선택적 OCR 확인을 순서대로 수행한다.
 * 호출 예시: await handleQuestEvidenceUpload(recommendation, file)
 */
async function handleQuestEvidenceUpload(recommendation, file) {
  if (!ensureSessionReady()) {
    return;
  }

  // URL 발급·업로드·OCR 각 단계 사이에 같은 계정인지 확인합니다.
  const isCurrentSession = captureSession();

  // 변수 의미: 업로드 대상 퀘스트 인스턴스 ID입니다.
  const instanceId = recommendation.instanceId;
  // 변수 의미: 업로드 목적입니다.
  const purpose = getEvidencePurpose(recommendation);
  // 변수 의미: 브라우저가 제공한 이미지 Content-Type입니다.
  const contentType = file.type || "image/jpeg";

  if (file.size > DEFAULT_EVIDENCE_MAX_UPLOAD_BYTES) {
    state.evidenceUploads[instanceId] = {
      status: "failed",
      fileName: file.name,
      message: `${formatBytes(DEFAULT_EVIDENCE_MAX_UPLOAD_BYTES)} 이하 이미지만 업로드할 수 있습니다.`,
    };
    renderAll();
    return;
  }

  state.evidenceUploads[instanceId] = {
    status: "uploading",
    fileName: file.name,
    contentType,
    purpose,
  };
  renderAll();

  try {
    // Object Storage 업로드 URL 발급 응답입니다.
    const upload = await fetchJson("/api/object-storage/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose,
        contentType,
        questInstanceId: instanceId,
      }),
    });

    if (!isCurrentSession()) {
      return;
    }

    if (file.size > toNumber(upload.maxUploadBytes, DEFAULT_EVIDENCE_MAX_UPLOAD_BYTES)) {
      throw new Error(`${formatBytes(upload.maxUploadBytes)} 이하 이미지만 업로드할 수 있습니다.`);
    }

    await uploadEvidenceFile(upload, file);

    if (!isCurrentSession()) {
      return;
    }

    // 변수 의미: 업로드 완료 후 완료 요청에 첨부할 증빙 상태입니다.
    const evidence = {
      status: "uploaded",
      fileName: file.name,
      contentType: upload.contentType || contentType,
      purpose,
      objectKey: upload.objectKey,
      uploadedAt: new Date().toISOString(),
    };
    state.evidenceUploads[instanceId] = evidence;
    updateSystemStatus(true, `${getEvidenceLabel(purpose)} 업로드 완료`);

    if (purpose === "quest_receipt") {
      await runReceiptOcr(recommendation, evidence);
    } else {
      renderAll();
    }
  } catch (error) {
    if (!isCurrentSession()) {
      return;
    }
    state.evidenceUploads[instanceId] = {
      status: "failed",
      fileName: file.name,
      contentType,
      purpose,
      message: getEvidenceUploadFailureMessage(error),
    };
    updateSystemStatus(state.apiHealthy, getEvidenceUploadFailureMessage(error));
    renderAll();
  }
}

/**
 * 입력: 추천 항목.
 * 출력: 완료 인증 요청 본문 Promise.
 * 역할: 장소 좌표가 아니라 사용자의 실측 GPS 좌표로 완료 요청을 만든다.
 * 호출 예시: const body = await buildCompletionBody(recommendation)
 */
async function buildCompletionBody(recommendation) {
  // GPS 대기 중 계정이 바뀌면 위치와 인증 증빙을 새 세션에서 읽지 않습니다.
  const isCurrentSession = captureSession();
  updateSystemStatus(state.apiHealthy, "현재 위치 확인 중");

  // 완료 버튼을 누른 순간의 실측 위치입니다.
  const position = await readCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });

  if (!isCurrentSession()) {
    throw new Error("completion session changed");
  }

  // 화면과 지도에 반영할 실측 위치입니다.
  const measuredLocation = normalizeMeasuredLocation(position);
  state.location = measuredLocation;
  syncNaverPositionMarker();

  // 변수 의미: 현재 퀘스트에 업로드된 사진 증빙 상태입니다.
  const evidence = state.evidenceUploads[recommendation?.instanceId || ""];
  // 변수 의미: 완료 요청에 첨부할 Object Storage 객체 키입니다.
  const objectKey = evidence?.objectKey || "";

  // 공통 축제라면 사용자가 고른 실제 행사 회차입니다. (명세 §11.1)
  const festivalTarget = recommendation?.isCommonFestival ? getSelectedFestivalTarget(recommendation) : null;

  return {
    latitude: measuredLocation.lat,
    longitude: measuredLocation.lng,
    accuracyMeters: Math.round(measuredLocation.accuracyMeters),
    // 완료에는 canonicalQuestId 와 실제 행사 정보를 함께 저장합니다. (명세 §11.1)
    canonicalQuestId: recommendation?.questId || "",
    eventId: festivalTarget?.eventId || "",
    editionId: festivalTarget?.editionId || "",
    eventTitle: festivalTarget?.title || "",
    eventVenueName: festivalTarget?.venueName || "",
    visitedAt: new Date().toISOString(),
    photoAttached: Boolean(objectKey),
    photoRef: objectKey,
    objectKey,
    contentType: evidence?.contentType || "",
    ocrText: evidence?.ocrText || "",
    storeName: "",
    checklistComplete: true,
    targetPlaceName: recommendation?.placeName || "",
  };
}

/**
 * 입력: 퀘스트 액션 이름과 API 실패 응답.
 * 출력: 사용자에게 보여줄 실패 문구.
 * 역할: 서버의 인증 거부 사유를 간결한 화면 상태 문구로 바꾼다.
 * 호출 예시: const message = getActionFailureMessage("complete", result)
 */
function getActionFailureMessage(action, actionResult) {
  // 서버가 반환한 업무 실패 사유입니다.
  const reason = actionResult?.reason || actionResult?.verification?.reason || "";

  // 완료 실패 사유별 안내 문구입니다.
  const completionMessages = {
    invalid_location: "현재 위치를 확인할 수 없어 완료하지 않았습니다.",
    low_gps_accuracy: "GPS 정확도가 80m를 넘어 완료하지 않았습니다.",
    place_cache_missing: "장소 좌표를 다시 확인하지 못해 완료하지 않았습니다.",
    outside_radius: "장소 반경 50m 밖으로 판정되어 완료하지 않았습니다.",
    already_completed: "이미 완료된 퀘스트입니다.",
    quest_not_found: "퀘스트를 찾을 수 없습니다.",
  };

  if (action === "complete") {
    return completionMessages[reason] || "GPS 완료 기준을 충족하지 못해 상태를 변경하지 않았습니다.";
  }

  return "퀘스트 요청을 처리하지 못했습니다.";
}

/**
 * 입력: 오류 객체와 퀘스트 액션 이름.
 * 출력: 사용자에게 보여줄 요청 실패 문구.
 * 역할: 네트워크·위치 권한·인증 오류별로 로컬 상태를 바꾸지 않았음을 알린다.
 * 호출 예시: const message = getRequestFailureMessage(error, "complete")
 */
function getRequestFailureMessage(error, action) {
  if (isUnauthorizedError(error)) {
    return "세션이 만료되어 상태를 변경하지 않았습니다.";
  }

  if (
    error?.name === "GeolocationPositionError" ||
    Number.isInteger(error?.code) ||
    String(error?.message || "").includes("위치")
  ) {
    return "현재 위치 권한이 필요합니다. 위치 권한을 허용한 뒤 다시 시도하세요.";
  }

  if (action === "complete") {
    return "GPS 완료 요청에 실패해 상태를 변경하지 않았습니다.";
  }

  return "요청에 실패해 상태를 변경하지 않았습니다.";
}

/**
 * 입력: 퀘스트 액션, 추천 항목, API 결과, 선택 메시지.
 * 출력: 없음.
 * 역할: 수락과 완료 버튼 처리 결과를 팝업으로 보여줄 상태를 만든다.
 * 호출 예시: showQuestActionDialog("complete", recommendation, result)
 */
function showQuestActionDialog(action, recommendation, actionResult = {}, message = "", additionalVisit = false) {
  // 변수 의미: 완료 버튼인지 여부입니다.
  const isComplete = action === "complete";
  // 변수 의미: 액션이 성공으로 처리됐는지 여부입니다.
  const succeeded = isComplete ? actionResult?.ok !== false : !actionResult?.error;
  // 변수 의미: 현재 퀘스트에 연결된 증빙 업로드 상태입니다.
  const evidence = state.evidenceUploads[recommendation?.instanceId || ""];
  // 변수 의미: 팝업에 표시할 세부 정보 목록입니다.
  const details = [
    recommendation?.questTitle || "퀘스트",
    recommendation?.placeName || "장소 정보 없음",
  ];

  if (isComplete && actionResult?.verification) {
    details.push(`GPS 판정: ${actionResult.verification.decision || "확인됨"}`);
    if (actionResult.verification.distanceMeters !== undefined) {
      details.push(`거리: ${actionResult.verification.distanceMeters}m`);
    }
  }

  if (evidence?.objectKey) {
    details.push(`${getEvidenceLabel(evidence.purpose)} 첨부 완료`);
  }

  if (evidence?.requirementCheck) {
    details.push(getReceiptRequirementText(evidence.requirementCheck));
  }

  // 추가 방문은 이미 공통 보상을 받았다는 점을 완료 후에도 알립니다. (명세 §11.2)
  if (additionalVisit && succeeded) {
    // 이번에 방문한 행사입니다. 실제 방문한 행사만 적습니다. (명세 §10 S07 행사형)
    const visitedTarget = getSelectedFestivalTarget(recommendation);
    if (visitedTarget) {
      details.push(`방문 행사: ${visitedTarget.title}`);
    }
    details.push("공통 보상은 이미 받았어요. 새 뱃지·꿈돌이·XP는 지급되지 않습니다.");
  }

  state.actionDialog = {
    title: succeeded
      ? additionalVisit
        ? "추가 방문 기록됨"
        : isComplete
          ? "퀘스트 완료 확인"
          : "퀘스트 수락 확인"
      : "퀘스트 처리 실패",
    message: message || (succeeded ? "버튼 입력이 정상 처리되었습니다." : "요청이 처리되지 않았습니다."),
    details: details.filter(Boolean),
    tone: succeeded ? "success" : "warning",
    // GPS 완료가 성공한 경우에만 보상 연출을 얹습니다.
    // 공통 축제의 추가 방문에는 보상 연출을 재생하지 않습니다. (명세 §10 S08, §11.2)
    reward: isComplete && succeeded && !additionalVisit ? resolveCompletionReward(actionResult) : null,
  };
  renderActionDialog();
}

/**
 * 입력: 액션 대상 추천 항목.
 * 출력: 보상 연출에 쓸 표시 정보.
 * 역할: 퀘스트에 1:1:1 로 묶인 rewardPair 를 연출에 그대로 넘긴다. (명세 §5.1, §10 S08)
 * 호출 예시: resolveRewardBadge(recommendation)
 */
function resolveCompletionReward(actionResult) {
  const completion = actionResult?.completion || {};
  const badges = Array.isArray(completion.badges?.earnedBadges)
    ? completion.badges.earnedBadges
    : [];
  const unlocked = Array.isArray(completion.unlockedGgumdori)
    ? completion.unlockedGgumdori
    : [];
  if (badges.length === 0 && unlocked.length === 0) {
    return null;
  }

  const badge = badges[0] || {};
  const ggumdori = unlocked[0] || {};
  return {
    name: badge.name || badge.badgeName || ggumdori.name || "새 보상",
    category: normalizeCategory(badge.categoryCode || badge.category || ggumdori.themeCategory || "default"),
    tier: toNumber(badge.tier, 1),
    badgeImageRef: badge.imageRef || badge.image_ref || "",
    ggumdoriId: ggumdori.id || ggumdori.variantId || "",
    ggumdoriName: ggumdori.name || ggumdori.variantName || "",
    ggumdoriImageRef: ggumdori.imageRef || ggumdori.image_ref || "",
    rewardXp: toNumber(completion.earnedXp, 0),
    level: toNumber(state.user.level, 0),
    levelProgressPercent: getProgressPercent(state.user.xp, state.user.nextLevelXp),
  };
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 액션 결과 팝업을 닫는다.
 * 호출 예시: closeActionDialog()
 */
function closeActionDialog() {
  state.actionDialog = null;
  renderActionDialog();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 수락과 완료 결과 팝업 DOM을 현재 상태와 동기화한다.
 * 호출 예시: renderActionDialog()
 */
function renderActionDialog() {
  // 기존 액션 팝업 요소입니다.
  const existingDialog = select("#quest-action-dialog");
  if (existingDialog) {
    existingDialog.remove();
  }

  if (!state.actionDialog) {
    return;
  }

  // 팝업 배경 요소입니다.
  const overlay = createElement("div", "action-dialog-overlay");
  overlay.id = "quest-action-dialog";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeActionDialog();
    }
  });

  // 팝업 본문 요소입니다.
  const dialog = createElement("section", `action-dialog action-dialog--${state.actionDialog.tone}`);
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "quest-action-dialog-title");

  // 팝업 제목 요소입니다.
  const title = createElement("h2", "", state.actionDialog.title);
  title.id = "quest-action-dialog-title";

  // 팝업 안내 문구 요소입니다.
  const message = createElement("p", "", state.actionDialog.message);
  // 팝업 세부 정보 목록입니다.
  const detailList = createElement("ul", "action-dialog-details");
  state.actionDialog.details.forEach((detail) => {
    detailList.append(createElement("li", "", detail));
  });

  // 팝업 닫기 버튼입니다.
  const closeButton = createElement("button", "primary-action", "확인");
  closeButton.type = "button";
  closeButton.addEventListener("click", closeActionDialog);

  dialog.append(title, message, detailList);

  // GPS 인증 성공 연출입니다. 노드를 붙이는 순간 900ms 연출이 시작됩니다.
  if (state.actionDialog.reward) {
    dialog.prepend(createRewardFx(state.actionDialog.reward));
    playRewardFlash();

    // 보상 화면에는 도감에서 보기를 함께 둡니다. 900ms 에 함께 나타납니다. (명세 §10 S08)
    const rewardActions = createElement("div", "reward-actions");
    const catalogButton = createElement("button", "secondary-action", "도감에서 보기");
    catalogButton.type = "button";
    catalogButton.addEventListener("click", () => {
      // 방금 얻은 꿈돌이를 도감에서 바로 열어 줍니다.
      const earnedGgumdoriId = state.actionDialog?.reward?.ggumdoriId || "";
      closeActionDialog();
      setActiveView("collection");
      if (earnedGgumdoriId) {
        openCatalogSheet(earnedGgumdoriId);
      }
    });
    rewardActions.append(catalogButton, closeButton);
    dialog.append(rewardActions);
  } else {
    dialog.append(closeButton);
  }

  overlay.append(dialog);
  document.body.append(overlay);
  closeButton.focus({ preventScroll: true });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 사용자 기기 위치를 가져와 추천 기준 좌표를 갱신한다.
 * 호출 예시: requestLocation()
 */
function requestLocation() {
  if (!ensureSessionReady()) {
    return;
  }

  readCurrentPosition({ enableHighAccuracy: true, timeout: 7000, maximumAge: 300000 })
    .then((position) => {
      state.location = normalizeMeasuredLocation(position);
      syncNaverPositionMarker();
      recenterNaverMapOnLocation(state.location);
      renderRecommendationMeta();
      loadRecommendations();
    })
    .catch(() => {
      state.location = { ...FALLBACK_LOCATION, label: "위치 확인 불가, 대전광역시청 기준" };
      syncNaverPositionMarker();
      recenterNaverMapOnLocation(state.location);
      renderRecommendationMeta();
      loadRecommendations();
    });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: TAP-TO-START 로딩 화면이 떠 있는 동안 미리 위치를 요청해 둔다. 홈 화면에 도착한
 *       뒤에야 위치를 요청하면 기본 좌표가 잠깐 보였다가 실측 위치로 바뀌는 게 눈에 띄므로,
 *       로딩바가 사라지기 전에 끝내 그 전환 자체가 보이지 않게 한다. 세션 준비 여부와 무관하게
 *       항상 시도한다(ensureSessionReady()는 미동의 사용자를 동의 화면으로 강제 이동시키는
 *       부작용이 있어 로딩 중 호출에 부적합, 위치 요청 자체는 로그인 여부와 무관함).
 * 호출 예시: prefetchLocation()
 */
function prefetchLocation() {
  readCurrentPosition({ enableHighAccuracy: true, timeout: 7000, maximumAge: 300000 })
    .then((position) => {
      state.location = normalizeMeasuredLocation(position);
      syncNaverPositionMarker();
    })
    .catch(() => {
      state.location = { ...FALLBACK_LOCATION, label: "위치 확인 불가, 대전광역시청 기준" };
      syncNaverPositionMarker();
    })
    .finally(() => {
      renderRecommendationMeta();
      loadRecommendations();
      markStartScreenTaskDone("geolocation");
    });
}

/**
 * 입력: 강제 새로고침 여부.
 * 출력: 추천 목록 로드 Promise.
 * 역할: 추천 API를 호출하고 실패 시 목업 데이터를 사용한다.
 * 호출 예시: await loadRecommendations(true)
 */
async function loadRecommendations(forceRefresh = false) {
  const mode = state.explorationMode;
  const location = getRecommendationLocation();
  const serverCategory = toServerCategory(state.selectedCategory);
  const requestId = ++state.requestVersions.recommendation;
  const sessionVersion = state.sessionVersion;

  if (!serverCategory) {
    state.recommendations = [];
    state.dataSource = "api";
    state.recommendationMeta = {
      sourceStatus: "unsupported_category",
      cacheHit: false,
      attribution: "현재 서버에서 이 분류를 준비 중입니다.",
      fetchedAt: "",
      expiresAt: "",
    };
    renderRecommendationMeta();
    renderHomeMetrics();
    renderHomeRecommendations();
    renderRecommendations();
    renderAdventure();
    renderQuestBoard();
    renderMapView();
    return;
  }

  const query = new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    category: serverCategory,
    mode: getApiRecommendationMode(),
    lang: state.uiLanguage,
  });
  if (forceRefresh) {
    query.set("refresh", "1");
  }

  try {
    const payload = await fetchJson(`/api/recommendations?${query.toString()}`);
    if (!isCurrentRequest("recommendation", requestId, sessionVersion, mode)) {
      return;
    }
    state.recommendations = unwrapList(payload).map(normalizeRecommendation);
    state.dataSource = "api";
    state.recommendationMeta = normalizeRecommendationMeta(payload);
  } catch (error) {
    if (!isCurrentRequest("recommendation", requestId, sessionVersion, mode)) {
      return;
    }
    state.recommendations = [...FALLBACK_RECOMMENDATIONS];
    state.dataSource = "fallback";
    state.recommendationMeta = {
      sourceStatus: "fallback:client_error",
      cacheHit: false,
      attribution: "관광정보 제공: 한국관광공사(TourAPI)",
      fetchedAt: "",
      expiresAt: "",
    };
  }

  renderRecommendationMeta();
  renderHomeMetrics();
  renderHomeRecommendations();
  renderRecommendations();
  renderAdventure();
  renderQuestBoard();
  renderMapView();
}

/**
 * 입력: 퀘스트 인스턴스 식별자와 액션 이름.
 * 출력: 액션 처리 Promise.
 * 역할: 퀘스트 수락 또는 완료 API가 성공한 경우에만 로컬 상태를 갱신한다.
 * 호출 예시: await handleQuestAction("mock-nature-001", "accept")
 */
async function handleQuestAction(instanceId, action) {
  if (!ensureSessionReady()) {
    return;
  }
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;

  // 액션에 따라 호출할 API 경로입니다.
  const path = `/api/quests/${encodeURIComponent(instanceId)}/${action}`;

  // 액션 대상 추천 항목입니다.
  const recommendation = state.recommendations.find((item) => item.instanceId === instanceId);

  state.pendingQuestActions[instanceId] = action;
  renderAll();

  try {
    // API 요청 옵션입니다.
    const requestOptions = { method: "POST" };

    if (action === "complete") {
      // 실측 GPS 기반 완료 인증 본문입니다.
      const completionBody = await buildCompletionBody(recommendation);
      if (sessionVersion !== state.sessionVersion || accessToken !== state.accessToken) {
        return;
      }
      requestOptions.headers = { "Content-Type": "application/json" };
      requestOptions.body = JSON.stringify(completionBody);
    }

    // 앱 서버에서 받은 액션 처리 결과입니다.
    const actionResult = await fetchJson(path, requestOptions);
    if (sessionVersion !== state.sessionVersion || accessToken !== state.accessToken) {
      return;
    }
    if (action === "complete" && actionResult.ok === false) {
      state.apiHealthy = true;
      // 변수 의미: 완료 실패 안내 문구입니다.
      const failureMessage = getActionFailureMessage(action, actionResult);
      updateSystemStatus(true, failureMessage);
      showQuestActionDialog(action, recommendation, actionResult, failureMessage);
      return;
    }

    // 이번 완료가 공통 축제의 추가 방문인지 여부입니다. (명세 §11.2)
    const additionalVisit = action === "complete" && isAdditionalFestivalVisit(recommendation);

    // 실제 방문한 행사만 기록합니다. 방문하지 않은 행사는 담지 않습니다. (명세 §11.1)
    if (action === "complete" && recommendation?.isCommonFestival) {
      recordFestivalVisit(recommendation, getSelectedFestivalTarget(recommendation));
    }

    // 액션 성공 후 반영할 상태입니다.
    const nextStatus = action === "complete" ? "completed" : "accepted";

    state.apiHealthy = true;
    state.questStatuses[instanceId] = nextStatus;
    persistQuestStatuses();

    if (action === "complete") {
      await Promise.allSettled([loadUser(), loadBadges(), loadNotes(), loadGgumdori()]);
      await loadCatalog();
    }
    if (sessionVersion !== state.sessionVersion || accessToken !== state.accessToken) {
      return;
    }

    // 변수 의미: 액션 성공 안내 문구입니다. 성공 문구에는 실제 방문한 행사만 적습니다. (명세 §10 S07 행사형)
    const successMessage = additionalVisit
      ? "추가 방문으로 기록했어요"
      : action === "complete"
        ? "GPS 기준 완료됨"
        : "퀘스트 수락됨";
    updateSystemStatus(true, successMessage);
    showQuestActionDialog(action, recommendation, actionResult, successMessage, additionalVisit);
  } catch (error) {
    if (
      sessionVersion === state.sessionVersion &&
      accessToken === state.accessToken &&
      !isUnauthorizedError(error)
    ) {
      // 위치 권한 실패는 API 연결 상태를 바꾸지 않는다.
      const isLocationError =
        error?.name === "GeolocationPositionError" ||
        Number.isInteger(error?.code) ||
        String(error?.message || "").includes("위치");
      state.apiHealthy = isLocationError ? state.apiHealthy : false;
      // 변수 의미: 요청 실패 안내 문구입니다.
      const failureMessage = getRequestFailureMessage(error, action);
      updateSystemStatus(state.apiHealthy, failureMessage);
      showQuestActionDialog(action, recommendation, { ok: false, error }, failureMessage);
    }
  } finally {
    if (sessionVersion === state.sessionVersion && accessToken === state.accessToken) {
      delete state.pendingQuestActions[instanceId];
      renderAll();
    }
  }
}

/**
 * 입력: 사용자가 고른 서버 관심사 목록.
 * 출력: 저장 Promise.
 * 역할: 기존 6개 관심사를 /api/me/preferences의 평면 계약으로 저장합니다.
 * 호출 예시: await savePreferences()
 */
async function savePreferences() {
  const categories = state.interestDraft.filter((category) => INTEREST_CATEGORIES.includes(category));
  const requestId = ++state.requestVersions.preference;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  state.interestMessage = "관심사를 저장하는 중입니다.";

  try {
    const payload = await fetchJson("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories }),
    });
    if (
      !isCurrentRequest("preference", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    state.preference = normalizePreference(payload);
    state.interestDraft = [...state.preference.categories];
    state.interestMessage = "관심사를 저장했어요.";
  } catch (error) {
    if (
      !isCurrentRequest("preference", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    state.interestMessage = "관심사를 저장하지 못했어요.";
  }
  renderAccountPanel();
}

/**
 * 입력: 없음.
 * 출력: 대전 전체 관광지 로드 Promise.
 * 역할: GPS 좌표 없이 기존 citywide 관광지 API를 호출합니다.
 * 호출 예시: await loadAttractions()
 */
async function loadAttractions() {
  const requestId = ++state.requestVersions.attraction;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  // 서버가 저장된 관심사 전체로 정렬하도록 특정 첫 관심사로 제한하지 않습니다.
  const category = "all";
  state.attractionMessage = "관광지를 불러오는 중입니다.";

  try {
    const payload = await fetchJson(
      `/api/places/recommendations?category=${encodeURIComponent(category)}&lang=${encodeURIComponent(state.uiLanguage)}`,
    );
    if (
      !isCurrentRequest("attraction", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    state.attractions = unwrapList(payload).map((item) => {
      const place = item.place || item;
      return {
        ...item,
        placeName: String(place.title || place.placeName || place.name || place.address || "관광지"),
        lat: Number(place.latitude ?? place.lat),
        lng: Number(place.longitude ?? place.lng),
        category: place.categoryCode || place.category || item.category || category,
      };
    });
    state.attractionLimit = 5;
    state.attractionMessage =
      state.attractions.length > 0 ? `${state.attractions.length}곳을 찾았어요.` : "조건에 맞는 관광지가 없어요.";
  } catch (error) {
    if (
      !isCurrentRequest("attraction", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    state.attractions = [];
    state.attractionMessage = "관광지를 불러오지 못했어요.";
  }
  renderAccountPanel();
}

/**
 * 입력: 없음.
 * 출력: 사용자 정보 로드 Promise.
 * 역할: /api/me를 호출하고 실패 시 기본 사용자 정보를 유지한다.
 * 호출 예시: await loadUser()
 */
async function loadUser() {
  const requestId = ++state.requestVersions.user;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;

  try {
    const payload = await fetchJson("/api/me");
    if (
      !isCurrentRequest("user", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    const user = payload.data || payload.user || payload;
    const level = user.level || user.levelProgress || {};
    const stats = user.stats || {};

    state.user = {
      nickname: user.nickname || user.name || FALLBACK_USER.nickname,
      level: toNumber(user.currentLevel || level.currentLevel || level.level, FALLBACK_USER.level),
      xp: toNumber(user.xp ?? user.currentXp ?? level.currentXp ?? level.xp ?? level.totalXp, FALLBACK_USER.xp),
      nextLevelXp: toNumber(
        user.nextLevelXp || level.nextLevelRequiredXp || level.nextLevelXp,
        FALLBACK_USER.nextLevelXp,
      ),
      completedQuestCount: toNumber(
        user.completedQuestCount || stats.completedQuestCount,
        FALLBACK_USER.completedQuestCount,
      ),
      badgeCount: toNumber(user.badgeCount || stats.earnedBadgeCount, FALLBACK_USER.badgeCount),
      selectedGgumdoriName: user.selectedGgumdoriName || FALLBACK_USER.selectedGgumdoriName,
      accountType: user.accountType === "social" ? "social" : "demo",
      email: String(user.email || ""),
      provider: String(user.provider || ""),
    };
    state.selectedGgumdoriId = String(user.selectedGgumdoriId || state.selectedGgumdoriId || "");
    state.preference = normalizePreference(user.preference || user.preferences || {});
    state.interestDraft = [...state.preference.categories];
  } catch (error) {
    if (
      !isCurrentRequest("user", requestId, sessionVersion) ||
      accessToken !== state.accessToken
    ) {
      return;
    }
    state.user = { ...FALLBACK_USER };
  }
}

/**
 * 입력: 없음.
 * 출력: 뱃지 목록 로드 Promise.
 * 역할: /api/badges를 호출하고 실패 시 기본 뱃지 목록을 사용한다.
 * 호출 예시: await loadBadges()
 */
async function loadBadges() {
  const requestId = ++state.requestVersions.badges;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  try {
    const payload = await fetchJson("/api/badges");
    if (!isCurrentRequest("badges", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    state.badges = unwrapList(payload).map(normalizeBadge);
  } catch (error) {
    if (!isCurrentRequest("badges", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    state.badges = IS_DESIGN_PREVIEW ? [...FALLBACK_BADGES] : [];
  }
}

/**
 * 입력: 없음.
 * 출력: 수첩 기록 로드 Promise.
 * 역할: /api/notes와 각 사진의 다운로드 URL을 호출하고 API의 빈 목록도 그대로 유지한다.
 * 호출 예시: await loadNotes()
 */
async function loadNotes() {
  const requestId = ++state.requestVersions.notes;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  try {
    const payload = await fetchJson("/api/notes");
    if (!isCurrentRequest("notes", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    const notes = unwrapList(payload).map(normalizeNote);
    const previousDrafts = state.noteDrafts;

    state.notes = notes;
    state.notesSource = "api";
    state.notePhotos = {};
    state.noteDrafts = Object.fromEntries(
      notes.map((note) => {
        const previousDraft = previousDrafts[note.id];
        if (previousDraft?.dirty || previousDraft?.pending) {
          return [note.id, previousDraft];
        }

        return [
          note.id,
          {
            ...createNoteDraft(note),
            isOpen: Boolean(previousDraft?.isOpen),
          },
        ];
      }),
    );

    const photoRequests = notes
      .filter((note) => note.photoRef)
      .map((note) => requestNotePhoto(note));
    await Promise.allSettled(photoRequests);
  } catch (error) {
    if (!isCurrentRequest("notes", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    state.notes = IS_DESIGN_PREVIEW ? [...FALLBACK_NOTES] : [];
    state.notesSource = IS_DESIGN_PREVIEW ? "fallback" : "api";
    state.notePhotos = {};
    state.noteDrafts = {};
  }
}

/**
 * 입력: 없음.
 * 출력: 꿈돌이 목록 로드 Promise.
 * 역할: /api/ggumdori를 호출하고 실패 시 기본 꿈돌이 도감을 사용한다.
 * 호출 예시: await loadGgumdori()
 */
async function loadGgumdori() {
  const requestId = ++state.requestVersions.ggumdori;
  const sessionVersion = state.sessionVersion;
  const accessToken = state.accessToken;
  try {
    const payload = await fetchJson("/api/ggumdori");
    if (!isCurrentRequest("ggumdori", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    state.ggumdori = unwrapList(payload).map(normalizeGgumdori);
    state.selectedGgumdoriId = payload.selectedVariantId || state.selectedGgumdoriId;
  } catch (error) {
    if (!isCurrentRequest("ggumdori", requestId, sessionVersion) || accessToken !== state.accessToken) {
      return;
    }
    state.ggumdori = IS_DESIGN_PREVIEW ? [...FALLBACK_GGUMDORI] : [];
  }
}

/**
 * 입력: 없음.
 * 출력: 지도 설정 로드 Promise.
 * 역할: /api/naver-map/config를 호출하되 비밀 값 없이 설정 여부만 확인한다.
 * 호출 예시: await loadMapConfig()
 */
async function loadMapConfig() {
  try {
    // NAVER 지도 설정 API 응답입니다.
    const payload = await fetchJson("/api/naver-map/config");
    state.naverMapConfig = normalizeNaverMapConfig(payload);
    state.naverMapConfigured = state.naverMapConfig.dynamicMapConfigured;
  } catch (error) {
    state.naverMapConfigured = false;
    state.naverMapConfig = {
      keyId: "",
      dynamicMapConfigured: false,
      restApiConfigured: false,
    };
  }
}

/**
 * 입력: 없음.
 * 출력: 헬스체크 Promise.
 * 역할: /api/health로 앱 서버 연결 가능 여부를 확인한다.
 * 호출 예시: await loadHealth()
 */
async function loadHealth() {
  try {
    await fetchJson("/api/health");
    state.apiHealthy = true;
  } catch (error) {
    state.apiHealthy = false;
  }

  updateSystemStatus(state.apiHealthy, state.apiHealthy ? "API 연결됨" : "목업 모드");
}

/**
 * 입력: 강제 새로고침 여부.
 * 출력: 초기 데이터 로드 Promise.
 * 역할: 화면에 필요한 API를 병렬 호출하고 실패 항목은 fallback으로 채운다.
 * 호출 예시: await loadInitialData(true)
 */
async function loadInitialData(forceRefresh = false) {
  // 이전 로그인에서 시작된 초기화의 후속 요청을 중단합니다.
  const isCurrentSession = captureSession();
  await Promise.allSettled([
    loadHealth(), loadUser(), loadBadges(), loadNotes(), loadGgumdori(), loadMapConfig(), loadAuthProviders(),
  ]);
  if (!isCurrentSession()) {
    return;
  }
  await loadRecommendations(forceRefresh);
  if (!isCurrentSession()) {
    return;
  }
  // 도감은 서버의 꿈돌이 해금 상태와 뱃지 진행도에서 만듭니다.
  await loadCatalog();
  if (!isCurrentSession()) {
    return;
  }
  // 날씨 연동 준비 상태를 표시하되 지도와 추천은 막지 않습니다.
  loadWeather();
  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 사용자 입력 이벤트를 등록한다.
 * 호출 예시: bindEvents()
 */
function bindEvents() {
  // 이전 화면으로 돌아가는 버튼입니다.
  const backButton = select("#app-back-button");
  if (backButton) {
    backButton.addEventListener("click", goToPreviousView);
  }

  // TAP-TO-START 시작 화면입니다. 클릭이나 Enter/Space로 닫습니다.
  const startScreen = select("#start-screen");
  if (startScreen) {
    startScreen.addEventListener("click", dismissStartScreen);
    startScreen.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dismissStartScreen();
      }
    });
  }

  // 위치 권한 요청 버튼입니다.
  const locationButton = select("#use-location-button");

  // 지도 탭의 위치 권한 요청 버튼입니다.
  const mapLocationButton = select("#map-location-button");

  // 새로고침 버튼입니다.
  const refreshButton = select("#refresh-button");

  // demo-social 로그인 버튼입니다.
  const demoLoginButton = select("#demo-login-button");

  // 네이버 로그인 버튼입니다.
  const naverLoginButton = select("#naver-login-button");

  // 구글 로그인 버튼입니다.
  const googleLoginButton = select("#google-login-button");

  if (locationButton) {
    locationButton.addEventListener("click", requestLocation);
  }

  if (mapLocationButton) {
    mapLocationButton.addEventListener("click", requestLocation);
  }

  // 화면 언어 선택 드롭다운입니다. 시작 전 동의 화면과 드로어 메뉴 둘 다에 있습니다.
  ["#onboarding-language-select", "#ui-language-select"].forEach((selector) => {
    const languageSelect = select(selector);
    if (!languageSelect) {
      return;
    }
    languageSelect.value = state.uiLanguage;
    languageSelect.addEventListener("change", () => {
      handleUiLanguageChange(languageSelect.value);
    });
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      if (ensureSessionReady()) {
        loadInitialData(true);
      }
    });
  }

  if (demoLoginButton) {
    demoLoginButton.addEventListener("click", () => {
      handleDemoLogin();
    });
  }

  if (naverLoginButton) {
    naverLoginButton.addEventListener("click", () => {
      handleOAuthLogin("naver");
    });
  }

  if (googleLoginButton) {
    googleLoginButton.addEventListener("click", () => {
      handleOAuthLogin("google");
    });
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      setOAuthLoginPending("", false);
      setConsentMessage("");
    }
  });

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      setCategory(button.dataset.category || "all");
    });
  });

  document.querySelectorAll("[data-adventure-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adventureSort = button.dataset.adventureSort === "started" ? "started" : "distance";
      state.adventureSortPinned = true;
      renderAdventure();
    });
  });

  document.addEventListener("click", (event) => {
    // 실제 클릭 대상 요소입니다.
    const target = event.target instanceof Element ? event.target : null;

    if (!target) {
      return;
    }

    // 도감 카드입니다. 누르면 도감 상세를 엽니다. (명세 §10 S09·S10)
    const catalogTarget = target.closest("[data-catalog-target]");
    if (catalogTarget) {
      openCatalogSheet(catalogTarget.dataset.catalogTarget || "");
      return;
    }

    // 퀘스트 카드입니다. 본문을 누르면 공용 상세 시트를 엽니다. (명세 §10 S04)
    const questTarget = target.closest("[data-quest-target]");
    if (questTarget) {
      openQuestSheet(questTarget.dataset.questTarget || "");
      return;
    }

    // 화면 전환 버튼입니다.
    const viewTarget = target.closest("[data-view-target]");
    if (!viewTarget) {
      return;
    }

    // 드로어에서 메뉴를 고를 때는 히스토리를 되감지 않습니다.
    // history.back() 은 비동기라 아래 setActiveView 가 replaceState 로 바꾼 해시를
    // 이전 값으로 되돌리고, 그 hashchange 가 화면을 홈으로 덮어씁니다.
    // 드로어가 쌓아 둔 항목은 setActiveView 의 replaceState 가 목적지 항목으로 바꿔 씁니다.
    closeDrawer(true);
    setActiveView(viewTarget.dataset.viewTarget || "home");
  });

  window.addEventListener("hashchange", () => {
    // 해시가 가리키는 화면입니다.
    const nextView = readInitialView();
    // 이미 그 화면이면 다시 그리지 않습니다. 히스토리 이동 중 화면이 되돌아가는 것을 막습니다.
    if (nextView === state.activeView) {
      return;
    }
    setActiveView(nextView, false);
  });

  bindDrawerEvents();
  bindHomeContextEvents();
  bindSettingEvents();

  window.addEventListener("keydown", (event) => {
    // 다른 시트 위에 연 드로어는 현재 화면의 최상위 모달입니다.
    if (event.key === "Escape" && isDrawerOpen()) {
      closeDrawer();
      return;
    }
    if (event.key === "Escape" && state.actionDialog) {
      closeActionDialog();
      return;
    }

    // 보상 모달 다음으로 퀘스트 상세 시트를 닫습니다. (명세 §7.4)
    if (event.key === "Escape" && state.recordSheetOpen) {
      closeRecordSheet();
      return;
    }

    if (event.key === "Escape" && state.photo.open) {
      closePhotoSheet();
      return;
    }

    if (event.key === "Escape" && state.weatherSheetOpen) {
      closeWeatherSheet();
      return;
    }

    if (event.key === "Escape" && state.planSheetOpen) {
      closePlanSheet();
      return;
    }

    if (event.key === "Escape" && state.catalogSheetId) {
      closeCatalogSheet();
      return;
    }

    if (event.key === "Escape" && state.questSheetId) {
      closeQuestSheet();
      return;
    }

    if (event.key === "Escape" && state.placeDetailSheet) {
      closePlaceDetailSheet();
      return;
    }

    if (event.key === "Tab") {
      trapDrawerFocus(event);
    }
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 우측 책갈피 손잡이, 닫기 버튼, 배경 탭, 가장자리 스와이프, 뒤로가기를 연결한다. (명세 §7.2)
 * 호출 예시: bindDrawerEvents()
 */
function bindDrawerEvents() {
  select("#bookmark-handle")?.addEventListener("click", openDrawer);
  select("#drawer-close")?.addEventListener("click", () => closeDrawer());
  select("#drawer-scrim")?.addEventListener("click", () => closeDrawer());

  // 뒤로가기는 열린 드로어를 먼저 닫습니다. (명세 §7.4)
  window.addEventListener("popstate", () => {
    if (isDrawerOpen()) {
      closeDrawer(true);
      return;
    }
    // 뒤로가기는 최상위 오버레이 → 열린 드로어 → 이전 화면 순으로 닫습니다. (명세 §7.4)
    if (closeTopOverlay()) {
      // 시트는 히스토리 항목을 쌓지 않으므로 되감긴 항목을 되돌려 보던 화면을 유지합니다.
      // 해시를 원래대로 돌려놓으면 뒤이어 오는 hashchange 도 같은 화면이라 아무 일도 하지 않습니다.
      window.history.pushState(null, "", `#view-${state.activeView}`);
      return;
    }
    setActiveView(readInitialView(), false);
  });

  // 스와이프 인식을 오른쪽 가장자리 24px 안에서 시작한 제스처로만 제한해
  // 지도 드래그·OS 뒤로가기 제스처와 충돌을 줄입니다. (명세 §7.2)
  const EDGE_WIDTH = 24;
  const SWIPE_MIN = 40;

  // 제스처 시작 좌표입니다.
  let touchStartX = 0;
  let touchStartY = 0;
  // 이번 제스처가 드로어 대상인지 여부입니다.
  let isEdgeGesture = false;

  document.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        isEdgeGesture = false;
        return;
      }

      const touch = event.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      // 열려 있으면 드로어 안에서 시작한 오른쪽 스와이프를 닫기로 받습니다.
      isEdgeGesture = isDrawerOpen()
        ? Boolean(event.target instanceof Element && event.target.closest("#app-drawer"))
        : touch.clientX >= window.innerWidth - EDGE_WIDTH;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      if (!isEdgeGesture) {
        return;
      }
      isEdgeGesture = false;

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      // 가로 이동량과 세로 이동량입니다. 세로가 크면 스크롤로 봅니다.
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;
      if (Math.abs(deltaX) < SWIPE_MIN || Math.abs(deltaY) > Math.abs(deltaX)) {
        return;
      }

      if (!isDrawerOpen() && deltaX < 0) {
        openDrawer();
        return;
      }
      if (isDrawerOpen() && deltaX > 0) {
        closeDrawer();
      }
    },
    { passive: true },
  );
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈의 현위치·계획 모드 토글과 3단 시트 손잡이를 연결한다. (명세 §6, §10 S03)
 * 호출 예시: bindHomeContextEvents()
 */
function bindHomeContextEvents() {
  document.querySelectorAll("[data-context-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setExplorationMode(button.dataset.contextMode || "current");
    });
  });

  select("#home-sheet-grip")?.addEventListener("click", cycleHomeSheetSnap);

  select("#home-plan-date")?.addEventListener("change", (event) => {
    state.plannedDate = event.target.value || "";
    persistPlanContext();
    renderHomeContext();
    renderRecommendations();
    loadWeather(true);
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 마이페이지 설정 항목을 연결하고 저장된 값을 화면에 반영한다. (명세 §12)
 * 호출 예시: bindSettingEvents()
 */
function bindSettingEvents() {
  applyReducedMotion();

  // 모험 기록은 마이페이지에서만 들어갑니다. (명세 §10 S13)
  select("#me-record-open")?.addEventListener("click", openRecordSheet);

  // 권한 상태는 화면을 열 때 한 번 읽습니다. 여기서 권한을 요청하지는 않습니다. (명세 §9.5)
  refreshPermissionStates();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 앱 모션 줄이기 설정을 body 속성으로 내려 CSS가 연출을 멈추게 한다.
 * 호출 예시: applyReducedMotion()
 */
function applyReducedMotion() {
  document.body.dataset.reducedMotion = String(state.reducedMotion);
}

/**
 * 입력: "current" 또는 "planned".
 * 출력: 없음.
 * 역할: 탐색 기준 위치를 명시적으로 전환한다. (명세 §6.1)
 * 호출 예시: setExplorationMode("planned")
 */
function setExplorationMode(mode) {
  const nextMode = mode === "planned" ? "planned" : "current";
  if (state.explorationMode === nextMode) {
    return;
  }

  state.explorationMode === "planned"
    ? (state.plannedCategory = state.selectedCategory)
    : (state.currentCategory = state.selectedCategory);
  state.explorationMode = nextMode;
  state.selectedCategory = nextMode === "planned" ? state.plannedCategory : state.currentCategory;
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === state.selectedCategory);
  });
  state.requestVersions.recommendation += 1;

  if (nextMode === "planned") {
    const saved = readPlanContext();
    if (saved?.label && Number.isFinite(Number(saved.lat)) && Number.isFinite(Number(saved.lng))) {
      state.plannedLocation = { lat: Number(saved.lat), lng: Number(saved.lng), label: saved.label, measured: false };
    }
    state.plannedDate = saved?.date || state.plannedDate || toKstDateKey(new Date());
  }

  renderHomeContext();
  renderRecommendations();
  loadRecommendations();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 시트를 접힘·중간·전체 순으로 순환시킨다. (명세 §10 S03)
 * 호출 예시: cycleHomeSheetSnap()
 */
function cycleHomeSheetSnap() {
  // 3스냅 순환 순서입니다.
  const order = ["collapsed", "mid", "full"];
  // 다음 스냅 위치입니다.
  const next = order[(order.indexOf(state.homeSheetSnap) + 1) % order.length];

  state.homeSheetSnap = next;
  renderHomeSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 시트의 현재 스냅을 DOM에 반영한다.
 * 호출 예시: renderHomeSheet()
 */
function renderHomeSheet() {
  // 홈 3단 시트입니다.
  const sheet = select("#home-sheet");

  if (!sheet) {
    return;
  }

  sheet.dataset.snap = state.homeSheetSnap;

  // 스냅 상태를 스크린리더에도 알립니다.
  const grip = select("#home-sheet-grip");
  if (grip) {
    // 현재 스냅의 한국어 이름입니다.
    const label = { collapsed: "접힘", mid: "중간", full: "전체" }[state.homeSheetSnap] || "중간";
    grip.setAttribute("aria-label", `시트 높이 변경 (현재 ${label})`);
  }
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 홈 상단의 탐색 컨텍스트 표시를 현재 상태로 갱신한다. (명세 §6)
 * 호출 예시: renderHomeContext()
 */
function renderHomeContext() {
  // 계획 모드인지 여부입니다.
  const isPlanned = state.explorationMode === "planned";

  // 탐색 모드를 body 에 내려 화면 전체가 같은 색 규칙을 따르게 합니다. (명세 §6.3)
  document.body.dataset.explorationMode = state.explorationMode;

  document.querySelectorAll("[data-context-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.contextMode === state.explorationMode));
  });

  // 계획 위치·날짜 입력 줄입니다. 현위치 모드에서는 감춥니다.
  const planControls = select("#home-plan-controls");
  if (planControls) {
    planControls.hidden = !isPlanned;
  }

  // 현재 기준 위치 이름입니다.
  const placeText = select("#home-place-text");
  if (placeText) {
    placeText.textContent = getRecommendationLocation().label || "대전광역시청";
  }

  // GPS 상태 표시입니다. 계획 모드에서는 실제 측위가 아님을 명시합니다.
  const gpsState = select("#home-gps-state");
  if (gpsState) {
    gpsState.textContent = isPlanned ? "계획 위치" : state.location.measured ? "GPS ON" : "기본 좌표";
  }

  // 계획 좌표를 고르는 동안 현위치 측위를 요청하는 버튼은 숨깁니다.
  ["#use-location-button", "#map-location-button"].forEach((selector) => {
    const button = select(selector);
    if (button) {
      button.hidden = isPlanned;
    }
  });

  renderHomeSheet();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 앱을 시작하고 첫 화면을 fallback 데이터로 즉시 채운 뒤 API를 갱신한다.
 * 호출 예시: initializeApp()
 */
function initializeApp() {
  registerServiceWorker();
  configureHostedPreviewLogin();
  // OAuth callback code를 token으로 교환 중인지 여부입니다.
  const oauthRedirectPending = consumeOAuthRedirect();
  bindEvents();
  loadAuthProviders().finally(() => markStartScreenTaskDone("authProviders"));
  prefetchLocation();
  setupStartScreenLoading();
  setActiveView(state.activeView, false);
  // 실제 연결 모드는 서버의 보유 기록을 받기 전까지 보상과 수첩을 비워 둡니다.
  if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
    state.catalog = buildFallbackCatalog();
  } else {
    state.badges = [];
    state.ggumdori = [];
    state.notes = [];
    state.catalog = buildServerCatalog();
  }
  renderAll();
  setupUiLanguageObserver();
  applyUiLanguage(document.body);
  // 음량을 먼저 맞추고, TAP-TO-START를 누르기 전에도 재생을 시도합니다.
  // 브라우저 자동재생 정책상 사용자 입력 기록이 쌓이기 전에는 대부분 막히지만(조용히
  // 실패하고 넘어감), 재방문 등으로 이미 허용된 경우라면 탭 전에도 바로 들립니다.
  // 막히는 경우엔 TAP-TO-START 클릭이 그대로 재생을 시작하는 사용자 입력이 됩니다.
  const bgmAudio = getBgmAudioElement();
  if (bgmAudio) {
    bgmAudio.volume = computeBgmVolume();
  }
  startBackgroundMusic();
  if (!oauthRedirectPending && ensureSessionReady()) {
    loadInitialData();
  }
}

initializeApp();
