// 사용자 모바일 웹/PWA의 화면 상태, API 호출, 목업 fallback 렌더링을 담당하는 파일입니다.

// API 요청이 실패했을 때 화면을 채우는 기본 사용자 정보입니다.
const FALLBACK_USER = {
  nickname: "대전 탐험가",
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
};

// 화면에서 선택할 수 있는 관광 카테고리 이름입니다.
const CATEGORY_LABELS = {
  all: "전체",
  default: "기본",
  nature: "자연",
  science: "과학",
  downtown: "원도심",
  market: "상권",
  mobility: "이동",
  hotspring: "온천",
  nightview: "야경",
};

// 변수 의미: 관심사 저장과 관광지 탐색에서 지원하는 카테고리입니다.
const INTEREST_CATEGORIES = ["nature", "science", "downtown", "market", "mobility", "nightview"];

// 변수 의미: 지도 연결이나 GPS 없이 선택할 수 있는 대전 여행 기준점입니다.
const PLANNING_PRESETS = [
  { lat: 36.3504, lng: 127.3845, label: "대전광역시청" },
  { lat: 36.3325, lng: 127.4343, label: "대전역" },
  { lat: 36.3742, lng: 127.3781, label: "국립중앙과학관" },
  { lat: 36.3670, lng: 127.3888, label: "한밭수목원" },
  { lat: 36.3274, lng: 127.4272, label: "은행동·성심당 거리" },
  { lat: 36.3554, lng: 127.3449, label: "유성온천" },
  { lat: 36.4746, lng: 127.4738, label: "대청호 오백리길" },
];

// 하단 탭과 헤더에서 사용하는 화면 메타데이터입니다.
const VIEW_META = {
  home: { title: "모험가 홈", eyebrow: "QUESTBOOK", icon: "✦", label: "홈", navIcon: "⌂" },
  map: { title: "탐험 지도", eyebrow: "MAP", icon: "⌖", label: "지도", navIcon: "⌖" },
  quests: { title: "퀘스트 목록", eyebrow: "QUEST", icon: "✓", label: "퀘스트", navIcon: "✓" },
  notes: { title: "탐험 노트", eyebrow: "NOTE", icon: "▤", label: "수첩", navIcon: "▤" },
  badges: { title: "뱃지 수첩", eyebrow: "BADGE", icon: "●", label: "뱃지", navIcon: "●" },
  customize: { title: "꿈돌이 꾸미기", eyebrow: "CUSTOM", icon: "✦", label: "꾸미기", navIcon: "✦" },
};

// 하단 탭의 표시 순서입니다.
const NAVIGATION_ITEMS = ["home", "map", "quests", "customize", "notes"];

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
    placeName: "국립중앙과학관",
    category: "science",
    distanceMeters: 1800,
    questTitle: "과학 키워드 3개 수집",
    questDescription: "전시관을 둘러본 뒤 기억에 남는 과학 키워드 3개를 수첩에 남깁니다.",
    rewardXp: 160,
    badgeName: "과학 탐험가",
    verificationType: "GPS 방문",
    score: 94,
    status: "recommended",
  },
  {
    instanceId: "mock-market-001",
    placeName: "성심당 본점 거리",
    category: "market",
    distanceMeters: 3200,
    questTitle: "원도심 빵지순례",
    questDescription: "중앙로 주변 상권을 걸으며 대표 메뉴나 간판을 사진으로 기록합니다.",
    rewardXp: 140,
    badgeName: "빵지순례자",
    verificationType: "사진 인증",
    score: 88,
    status: "recommended",
  },
  {
    instanceId: "mock-nature-001",
    placeName: "한밭수목원",
    category: "nature",
    distanceMeters: 900,
    questTitle: "초록 탐험 루트",
    questDescription: "수목원 산책로에서 오늘 본 식물이나 풍경을 한 줄 메모로 남깁니다.",
    rewardXp: 120,
    badgeName: "초록 탐험가",
    verificationType: "GPS 방문",
    score: 91,
    status: "accepted",
  },
  {
    instanceId: "mock-night-001",
    placeName: "엑스포다리",
    category: "nightview",
    distanceMeters: 2400,
    questTitle: "대전 야경 수집",
    questDescription: "해가 진 뒤 엑스포다리 주변 야경을 감상하고 방문 기록을 남깁니다.",
    rewardXp: 150,
    badgeName: "전망 수집가",
    verificationType: "시간대+GPS",
    score: 83,
    status: "recommended",
  },
];

// API 실패 시 뱃지 화면을 채우는 기본 뱃지 목록입니다.
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
  { id: "default-1", name: "기본 꿈돌이", themeCategory: "default", unlocked: true, condition: "기본 지급", imageRef: "/assets/ggumdori/default-1.svg" },
  { id: "science-1", name: "안경 꿈돌이", themeCategory: "science", unlocked: true, condition: "science Lv.1", imageRef: "/assets/ggumdori/science-1.svg" },
  { id: "science-2", name: "플라스크 꿈돌이", themeCategory: "science", unlocked: false, condition: "science Lv.2", imageRef: "/assets/ggumdori/science-2.svg" },
  { id: "market-2", name: "제빵 꿈돌이", themeCategory: "market", unlocked: true, condition: "market Lv.2", imageRef: "/assets/ggumdori/market-2.svg" },
  { id: "nature-2", name: "숲 탐험 꿈돌이", themeCategory: "nature", unlocked: true, condition: "nature Lv.2", imageRef: "/assets/ggumdori/nature-2.svg" },
  { id: "mobility-1", name: "타슈 꿈돌이", themeCategory: "mobility", unlocked: false, condition: "mobility Lv.1", imageRef: "/assets/ggumdori/mobility-1.svg" },
  { id: "hotspring-1", name: "온천 꿈돌이", themeCategory: "hotspring", unlocked: false, condition: "유성온천 방문", imageRef: "/assets/ggumdori/hotspring-1.svg" },
  { id: "nightview-2", name: "야경 꿈돌이", themeCategory: "nightview", unlocked: false, condition: "nightview Lv.2", imageRef: "/assets/ggumdori/nightview-2.svg" },
];

// 브라우저에 저장할 퀘스트 상태 키입니다.
const QUEST_STATUS_KEY = "questbook:user-web:quest-status";

// 브라우저에 저장할 선택 꿈돌이 키입니다.
const SELECTED_GGUMDORI_KEY = "questbook:user-web:selected-ggumdori";

// 브라우저에 저장할 baseline access token 키입니다.
const ACCESS_TOKEN_KEY = "questbook:user-web:access-token";

// 브라우저 세션에 저장할 OAuth callback nonce 키입니다.
const OAUTH_NONCE_KEY = "questbook:user-web:oauth-nonce";

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
  dataSource: "fallback",
  recommendationMeta: {
    sourceStatus: "fallback:not_loaded",
    cacheHit: false,
    attribution: "관광정보 제공: 한국관광공사(TourAPI)",
    fetchedAt: "",
    expiresAt: "",
  },
  selectedCategory: "all",
  location: { ...FALLBACK_LOCATION },
  recommendationMode: "nearby", // 변수 의미: 주변 또는 여행 계획 추천 모드입니다.
  plannedLocation: { ...PLANNING_PRESETS[0] }, // 변수 의미: 실측 GPS와 독립적인 여행 계획 기준점입니다.
  planningInputLocationKey: "", // 변수 의미: 좌표 입력에 마지막으로 반영한 기준점입니다.
  preference: { categories: [], isConfigured: false }, // 변수 의미: 서버에 저장된 관심사입니다.
  interestDraft: [], // 변수 의미: 아직 저장하지 않은 관심사 선택입니다.
  interestDirty: false, // 변수 의미: 관심사를 편집하고 있는지 여부입니다.
  preferencePending: false, // 변수 의미: 관심사를 저장하는 중인지 여부입니다.
  preferenceMessage: "", // 변수 의미: 관심사 저장 결과 안내입니다.
  sessionVersion: 0, // 변수 의미: 로그아웃 전 요청을 구분하는 세션 세대입니다.
  preferenceRequestId: 0, // 변수 의미: 이전 선호도 응답을 무시하기 위한 요청 순번입니다.
  userRequestId: 0, // 변수 의미: 이전 사용자 응답을 무시하기 위한 요청 순번입니다.
  recommendationRequestId: 0, // 변수 의미: 추천 조회 순번입니다.
  recommendationPending: false, // 변수 의미: 추천 조회 진행 여부입니다.
  locationRequestId: 0, // 변수 의미: GPS와 계획점 변경 순서를 구분합니다.
  planningMessage: "", // 변수 의미: 계획 위치 선택 결과입니다.
  addressResults: [], // 변수 의미: 주소 검색 결과입니다.
  addressRequestId: 0, // 변수 의미: 이전 주소 검색 응답을 무시하는 순번입니다.
  addressPending: false, // 변수 의미: 주소 검색 진행 여부입니다.
  attractions: [], // 변수 의미: 퀘스트를 생성하지 않은 대전 관광지 목록입니다.
  attractionCategory: "all", // 변수 의미: 대전 관광지 목록의 단일 필터입니다.
  attractionRequestId: 0, // 변수 의미: 대전 관광지 요청 순번입니다.
  attractionPending: false, // 변수 의미: 대전 관광지 조회 진행 여부입니다.
  attractionMessage: "", // 변수 의미: 대전 관광지 데이터 출처 또는 오류 안내입니다.
  user: { ...FALLBACK_USER },
  recommendations: [...FALLBACK_RECOMMENDATIONS],
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
  customizerPreviewId: readSelectedGgumdoriId(),
  customizerCategory: "all",
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
 * 출력: URL 해시에서 읽은 초기 화면 ID.
 * 역할: 새로고침해도 사용자가 보던 하단 탭을 최대한 유지한다.
 * 호출 예시: const view = readInitialView()
 */
function readInitialView() {
  // URL 해시에서 #view- 접두사를 제거한 화면 ID입니다.
  const viewFromHash = window.location.hash.replace(/^#view-/, "");

  return VIEW_META[viewFromHash] ? viewFromHash : "home";
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
  state.preferenceRequestId += 1;
  state.locationRequestId += 1;
  state.addressRequestId += 1;
  state.preference = normalizePreference();
  state.interestDraft = [];
  state.interestDirty = false;
  state.preferencePending = false;
  state.preferenceMessage = "";
  state.recommendations = [];
  state.attractions = [];
  state.plannedLocation = { ...PLANNING_PRESETS[0] };
  state.planningInputLocationKey = "";
  state.location = { ...FALLBACK_LOCATION };
  state.recommendationMode = "nearby";
  state.addressResults = [];
  state.addressPending = false;
  state.attractionPending = false;
  state.recommendationPending = false;
  state.notes = [];
  state.notesSource = "api";
  state.notePhotos = {};
  state.noteDrafts = {};
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
  // 변수 의미: 요청을 보낸 세션이며 다른 계정으로 바뀐 뒤에는 만료시키지 않습니다.
  const requestToken = state.accessToken;
  const requestVersion = state.sessionVersion;
  // API 요청에 보낼 헤더입니다.
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (state.accessToken) {
    headers.Authorization = `Bearer ${state.accessToken}`;
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
    if (isUnauthorizedError(error) && isCurrentSession(requestToken, requestVersion)) {
      resetExpiredSession();
    }
    throw error;
  }

  return response.json();
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
  // 하단 탭 메뉴입니다.
  const bottomNavigation = select("#bottom-nav");

  if (panel) {
    panel.hidden = !isVisible;
  }
  if (appViews) {
    appViews.hidden = isVisible;
  }
  if (bottomNavigation) {
    bottomNavigation.hidden = isVisible;
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
  setConsentMessage("");
  updateSystemStatus(false, "체험 모드");
  renderAll();
  loadRecommendations();
  loadAttractions();
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

  if (!ageInput?.checked || !privacyInput?.checked || !locationInput?.checked) {
    setConsentMessage("세 항목을 모두 확인해야 추천 기능을 사용할 수 있습니다.");
    return;
  }

  if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
    startLocalDemoSession();
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
    state.accessToken = payload.accessToken;
    writeStorageValue(ACCESS_TOKEN_KEY, payload.accessToken);
    setConsentPanelVisible(false);
    setConsentMessage("");
    await loadInitialData();
  } catch (error) {
    setConsentMessage("로그인 처리에 실패했습니다. 잠시 뒤 다시 시도하세요.");
  }
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

  if (!ageInput?.checked || !privacyInput?.checked || !locationInput?.checked) {
    setConsentMessage("세 항목을 모두 확인해야 로그인할 수 있습니다.");
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
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(false);
    setConsentMessage("");
    await loadInitialData();
  } catch (error) {
    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    removeSessionValue(OAUTH_NONCE_KEY);
    setConsentPanelVisible(true);
    setConsentMessage("로그인 검증에 실패했습니다. 다시 시도하세요.");
  }
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
    state.accessToken = "";
    removeStorageValue(ACCESS_TOKEN_KEY);
    removeSessionValue(OAUTH_NONCE_KEY);
    history.replaceState(null, "", window.location.pathname + window.location.search);
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

  if (state.dataSource === "error") {
    return "연결 실패";
  }
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

  if (state.dataSource === "error") {
    return "추천을 불러오지 못했습니다. 추천 설정을 확인하고 새로고침해 주세요.";
  }

  if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
    return "화면 체험용 예시 퀘스트입니다. 위치·관심사에 따른 실제 추천은 앱 서버 연결 후 제공됩니다.";
  }

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
    "fallback:not_configured": "TOURAPI_SERVICE_KEY가 없어 대전 fallback 장소 데이터로 표시합니다.",
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

  return {
    instanceId: instanceId || createClientId("recommendation"),
    placeName: item.placeName || item.title || place.name || place.title || quest.placeReference?.placeName || "추천 장소",
    placeLatitude: toNumber(item.latitude ?? place.latitude, getRecommendationLocation().lat),
    placeLongitude: toNumber(item.longitude ?? place.longitude, getRecommendationLocation().lng),
    category: item.category || item.categoryCode || quest.categoryCode || place.categoryCode || "all",
    distanceMeters: toNumber(item.distanceMeters || item.distance || place.distanceMeters, 0),
    questTitle: item.questTitle || quest.title || item.title || "방문 퀘스트",
    questDescription: item.questDescription || item.description || quest.description || "장소를 방문하고 수첩에 기록을 남깁니다.",
    rewardXp: toNumber(item.rewardXp || quest.rewardXp, 100),
    badgeName: item.badgeName || item.badge?.name || "탐험 뱃지",
    verificationType: item.verificationType || quest.verificationType || "GPS 방문",
    score: toNumber(item.score || item.recommendationScore, 0),
    status: item.status || quest.status || "recommended",
  };
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
    recommended: "추천됨",
    accepted: "진행 중",
    in_progress: "진행 중",
    completed: "완료",
    done: "완료",
  };

  return labels[status] || "추천됨";
}

/**
 * 입력: 퀘스트 상태 문자열.
 * 출력: 상태 태그 CSS 클래스.
 * 역할: 상태별 색상 표현을 통일한다.
 * 호출 예시: getQuestStatusClass("completed")
 */
function getQuestStatusClass(status) {
  if (status === "completed" || status === "done") {
    return "status-tag status-tag--done";
  }

  if (status === "accepted" || status === "in_progress") {
    return "status-tag status-tag--accepted";
  }

  return "status-tag";
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
    script.src = `${NAVER_MAPS_SDK_URL}?ncpKeyId=${encodeURIComponent(keyId)}`;
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
    content: `<div class="naver-position-marker" aria-label="${state.recommendationMode === "planning" ? "계획 위치" : "추천 기준 위치"}"><span></span></div>`,
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
    .register("./service-worker.js?v=20260906-2", { updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {
      updateSystemStatus(false, "서비스워커 등록 실패");
    });
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

  // 헤더 아이콘 요소입니다.
  const iconElement = select("[data-app-icon]");
  // 헤더 상단 라벨 요소입니다.
  const eyebrowElement = select("[data-app-eyebrow]");
  // 헤더 제목 요소입니다.
  const titleElement = select("[data-app-title]");
  // 사용자 레벨 표시 요소입니다.
  const levelElement = select("#header-level");

  if (iconElement) {
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
 * 역할: 하단 탭 메뉴를 렌더링하고 현재 화면을 강조한다.
 * 호출 예시: renderBottomNavigation()
 */
function renderBottomNavigation() {
  // 하단 탭 컨테이너입니다.
  const navigation = select("#bottom-nav");

  if (!navigation) {
    return;
  }

  navigation.replaceChildren();

  NAVIGATION_ITEMS.forEach((viewId) => {
    // 하단 탭 하나의 메타데이터입니다.
    const meta = VIEW_META[viewId];
    // 현재 탭이 활성 상태인지 여부입니다.
    const isActive = state.activeView === viewId;
    // 하단 탭 버튼입니다.
    const button = createElement("button", `nav-link${isActive ? " is-active" : ""}`.trim());
    button.type = "button";
    button.dataset.viewTarget = viewId;
    button.setAttribute("aria-current", isActive ? "page" : "false");
    button.append(createElement("span", "", meta.navIcon), createElement("span", "", meta.label));
    navigation.append(button);
  });
}

/**
 * 입력: 전환할 화면 ID와 URL 해시 갱신 여부.
 * 출력: 없음.
 * 역할: 단일 PWA 안에서 홈, 지도, 퀘스트, 수첩, 뱃지를 페이지처럼 전환한다.
 * 호출 예시: setActiveView("quests")
 */
function setActiveView(viewId, shouldUpdateHash = true) {
  if (!VIEW_META[viewId]) {
    return;
  }

  state.activeView = viewId;

  // 모든 화면 패널입니다.
  const panels = document.querySelectorAll("[data-view-panel]");
  panels.forEach((panel) => {
    // 현재 패널이 활성 화면인지 여부입니다.
    const isActive = panel.dataset.viewPanel === viewId;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  renderAppHeader();
  renderBottomNavigation();

  if (shouldUpdateHash) {
    window.history.replaceState(null, "", `#view-${viewId}`);
  }

  // 모바일 화면 전환 시 스크롤을 상단으로 돌린다.
  const main = select("#main-content");
  if (main) {
    main.scrollTop = 0;
  }
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
  const name = createElement("p", "profile-name", state.user.nickname || FALLBACK_USER.nickname);
  const meta = createElement(
    "p",
    "profile-meta",
    `Lv.${toNumber(state.user.level, 1)} · ${toNumber(state.user.xp).toLocaleString("ko-KR")} XP`,
  );
  const selectedName = createElement(
    "span",
    "selected-ggumdori-name",
    `${selectedGgumdori?.name || state.user.selectedGgumdoriName || "기본 꿈돌이"} 선택 중`,
  );
  const customizeLink = createElement("button", "profile-customize-link", "꿈돌이 바꾸기 →");
  customizeLink.type = "button";
  customizeLink.dataset.viewTarget = "customize";

  profileText.append(name, meta, selectedName, customizeLink);
  main.append(avatar, profileText);

  // 레벨 진행률 설명입니다.
  const progressCaption = createElement("div", "progress-caption");
  progressCaption.append(
    createElement("span", "", `Lv.${toNumber(state.user.level, 1) + 1}까지`),
    createElement("span", "", `${Math.round(progressPercent)}%`),
  );

  // 레벨 진행 막대입니다.
  const progressTrack = createElement("div", "progress-bar");
  const progressFill = createElement("span", "progress-fill");
  progressFill.style.width = `${progressPercent}%`;
  progressTrack.append(progressFill);

  // 사용자 활동 통계 행입니다.
  const statRow = createElement("div", "stat-row");
  [
    ["XP", `${toNumber(state.user.xp).toLocaleString("ko-KR")}`],
    ["완료", `${toNumber(state.user.completedQuestCount)}개`],
    ["뱃지", `${toNumber(state.user.badgeCount)}개`],
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
    ["📍", getRecommendationLocation().label.replace(" 기준", ""), state.recommendationMode === "planning" ? "계획 기준점" : "추천 기준점"],
    ["🏷️", `${earnedBadges.length}개`, "획득 뱃지"],
    ["🗺️", `${state.recommendations.length}개`, "추천 퀘스트"],
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
    list.append(createElement("p", "empty-message", state.recommendationPending ? "선택한 기준으로 퀘스트를 불러오고 있습니다." : "표시할 추천 퀘스트가 없습니다."));
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
    // 변수 의미: 현재 모드에서 사용하는 추천 기준점입니다.
    const location = getRecommendationLocation();
    const mapStatus = state.naverMapConfigured ? "NAVER Dynamic Map 연결 준비" : "목업 지도 표시";
    mapCopy.textContent = `${state.recommendationMode === "planning" ? "계획 위치" : "추천 기준"}: ${location.label} · ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)} · ${mapStatus}`;
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
 * 입력: 추천 항목.
 * 출력: 추천 카드 HTMLElement.
 * 역할: 추천 관광지와 연결 퀘스트를 카드로 만든다.
 * 호출 예시: createRecommendationCard(recommendation)
 */
function createRecommendationCard(recommendation) {
  // 현재 추천 항목의 진행 상태입니다.
  const questStatus = getQuestStatus(recommendation.instanceId, recommendation.status);

  // 현재 추천 항목에서 처리 중인 액션입니다.
  const pendingAction = state.pendingQuestActions[recommendation.instanceId] || "";

  // 현재 추천 항목의 버튼을 잠글지 여부입니다.
  const isActionPending = Boolean(pendingAction);

  // 추천 카드를 감싸는 요소입니다.
  const card = createElement("article", "recommendation-card");

  // 카드 상단 메타 영역입니다.
  const topline = createElement("div", "card-topline");
  topline.append(
    createElement("span", "category-tag", CATEGORY_LABELS[recommendation.category] || "추천"),
    createElement("span", "distance-tag", formatDistance(recommendation.distanceMeters)),
  );

  // 카드 제목과 장소 정보입니다.
  const title = createElement("h3", "card-title", recommendation.questTitle);
  const place = createElement("p", "card-place", recommendation.placeName);
  const description = createElement("p", "card-description", recommendation.questDescription);

  // 보상과 인증 정보를 표시하는 행입니다.
  const rewardRow = createElement("div", "reward-row");
  rewardRow.append(
    createElement("span", "", `${recommendation.rewardXp} XP`),
    createElement("span", "", recommendation.badgeName),
    createElement("span", "", recommendation.verificationType),
    createElement("span", "", `추천점수 ${Math.round(recommendation.score)}`),
  );

  // 카드 버튼 영역입니다.
  const actions = createElement("div", "card-actions");
  const acceptButton = createElement("button", "card-action card-action--secondary", "수락");
  const completeButton = createElement("button", "card-action card-action--primary", "완료");

  acceptButton.type = "button";
  completeButton.type = "button";
  acceptButton.disabled =
    isActionPending ||
    questStatus === "accepted" ||
    questStatus === "in_progress" ||
    questStatus === "completed" ||
    questStatus === "done";
  completeButton.disabled = isActionPending || questStatus === "completed" || questStatus === "done";
  acceptButton.textContent = pendingAction === "accept" ? "수락 중" : "수락";
  completeButton.textContent = pendingAction === "complete" ? "확인 중" : "완료";
  acceptButton.classList.toggle("is-pending", pendingAction === "accept");
  completeButton.classList.toggle("is-pending", pendingAction === "complete");
  acceptButton.setAttribute("aria-busy", pendingAction === "accept" ? "true" : "false");
  completeButton.setAttribute("aria-busy", pendingAction === "complete" ? "true" : "false");
  acceptButton.addEventListener("click", () => handleQuestAction(recommendation.instanceId, "accept"));
  completeButton.addEventListener("click", () => handleQuestAction(recommendation.instanceId, "complete"));
  actions.append(acceptButton, completeButton);

  // 사진 또는 영수증 증빙 업로드 패널입니다.
  const evidencePanel = createEvidencePanel(recommendation, isActionPending);

  // 현재 상태 태그입니다.
  const statusTag = createElement("span", getQuestStatusClass(questStatus), getQuestStatusLabel(questStatus));

  card.append(topline, statusTag, title, place, description, rewardRow, evidencePanel, actions);
  return card;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 선택한 카테고리에 맞는 추천 목록을 렌더링한다.
 * 호출 예시: renderRecommendations()
 */
function renderRecommendations() {
  // 추천 카드 목록 컨테이너입니다.
  const list = select("#recommendation-list");

  if (!list) {
    return;
  }

  // 현재 카테고리로 필터링한 추천 목록입니다.
  const filteredRecommendations =
    state.selectedCategory === "all"
      ? state.recommendations
      : state.recommendations.filter((item) => item.category === state.selectedCategory);

  list.replaceChildren();

  if (filteredRecommendations.length === 0) {
    list.append(createElement("p", "empty-message", state.recommendationPending ? "선택한 기준으로 퀘스트를 불러오고 있습니다." : "이 카테고리의 추천 퀘스트가 아직 없습니다."));
    return;
  }

  filteredRecommendations.forEach((recommendation) => {
    list.append(createRecommendationCard(recommendation));
  });
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

  // 퀘스트 상태 그룹 정의입니다.
  const groups = [
    { key: "recommended", title: "추천됨" },
    { key: "accepted", title: "진행 중" },
    { key: "completed", title: "완료" },
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
  // 변수 의미: 지도에 표시할 추천 기준 좌표입니다.
  const location = getRecommendationLocation();
  // 위도 목록입니다.
  const latitudes = places.map((item) => item.placeLatitude).concat(location.lat);
  // 경도 목록입니다.
  const longitudes = places.map((item) => item.placeLongitude).concat(location.lng);
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
  currentLocationMarker.title = location.label;
  currentLocationMarker.style.left = `${toMapPercent(location.lng, minLongitude, maxLongitude)}%`;
  currentLocationMarker.style.top = `${toMapPercent(location.lat, minLatitude, maxLatitude, true)}%`;
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

  // 변수 의미: 지도 SDK 대기 중 변경될 수 있는 추천 조회 및 세션입니다.
  const requestId = state.recommendationRequestId;
  const token = state.accessToken;
  const version = state.sessionVersion;
  await loadNaverMapsSdk(state.naverMapConfig.keyId);
  if (requestId !== state.recommendationRequestId || !isCurrentSession(token, version)) return;

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
    window.naver.maps.Event.addListener(state.naverMapInstance, "click", (event) => {
      if (state.recommendationMode === "planning" && event.coord) {
        setPlanningLocation({ lat: event.coord.lat(), lng: event.coord.lng(), label: "지도에서 선택한 위치" });
      }
    });
  } else {
    state.naverMapInstance.setCenter(center);
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
    state.naverPositionMarker.setIcon(buildNaverPositionMarkerIcon());
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
      selectMapPlace(place.instanceId);
      state.naverMapInstance.setCenter(toNaverLatLng(place));
      state.naverMapInstance.setZoom(NAVER_MAP_FOCUSED_ZOOM);
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

  if (state.naverMapInstance && hasNaverMaps()) {
    // 선택한 추천 장소입니다.
    const selectedPlace = state.recommendations.find((item) => item.instanceId === instanceId);
    if (selectedPlace) {
      state.naverMapInstance.setCenter(toNaverLatLng(selectedPlace));
      state.naverMapInstance.setZoom(NAVER_MAP_FOCUSED_ZOOM);
    }
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
  if (places.length === 0) {
    list.append(createElement("p", "empty-message", state.recommendationPending ? "퀘스트를 불러오고 있습니다." : "이 기준점에서 표시할 퀘스트가 없습니다."));
  }

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
  }

  if (state.naverMapConfig.dynamicMapConfigured && state.naverMapConfig.keyId && state.naverMapLoadState !== "failed") {
    renderNaverMapView(canvas, places).catch(() => {
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
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 뱃지 진행도를 카드 그리드로 렌더링한다.
 * 호출 예시: renderBadges()
 */
function renderBadges() {
  // 뱃지 그리드 컨테이너입니다.
  const grid = select("#badge-grid");

  if (!grid) {
    return;
  }

  grid.replaceChildren();

  // 대표 뱃지 아이콘 요소입니다.
  const featuredIcon = select("#featured-badge-icon");
  // 대표 뱃지 설명 요소입니다.
  const featuredCopy = select("#featured-badge-copy");
  // 대표로 표시할 최근 획득 뱃지입니다.
  const featuredBadge = getEarnedBadges()[0] || state.badges[0];

  if (featuredIcon && featuredBadge) {
    featuredIcon.textContent = getCategoryIcon(featuredBadge.category);
  }

  if (featuredCopy && featuredBadge) {
    featuredCopy.textContent = `${featuredBadge.name} Lv.${featuredBadge.tier} · ${featuredBadge.progressXp} XP`;
  }

  state.badges.forEach((badge) => {
    // 뱃지 진행률입니다.
    const progressPercent = getProgressPercent(badge.progressXp, badge.requiredXp);

    // 뱃지 카드 요소입니다.
    const card = createElement("article", "badge-card");
    const topline = createElement("div", "badge-topline");
    topline.append(
      createElement("span", "category-tag", CATEGORY_LABELS[badge.category] || "기타"),
      createElement("span", badge.earnedAt ? "status-tag status-tag--done" : "status-tag", badge.earnedAt ? "획득" : "진행"),
    );

    const title = createElement("h3", "", `${getCategoryIcon(badge.category)} ${badge.name} Lv.${badge.tier}`);
    const label = createElement("div", "badge-progress-label");
    label.append(
      createElement("span", "", `${badge.progressXp} XP`),
      createElement("span", "", `${badge.requiredXp} XP`),
    );

    const track = createElement("div", "progress-track");
    const fill = createElement("span", "progress-fill");
    fill.style.width = `${progressPercent}%`;
    track.append(fill);

    card.append(topline, title, label, track);
    grid.append(card);
  });
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

    if (currentPhoto?.requestId !== requestId) {
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
    if (isUnauthorizedError(error) || currentPhoto?.requestId !== requestId) {
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
    if (shouldRender && state.accessToken) {
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
    // 서버가 반환한 최신 수첩 기록입니다.
    const updatedRawNote = payload.note || payload.data;
    if (!updatedRawNote || typeof updatedRawNote !== "object") {
      throw new Error("missing updated note");
    }
    // 화면 구조로 정규화한 최신 수첩 기록입니다.
    const updatedNote = normalizeNote(updatedRawNote);
    state.notes = state.notes.map((item) => (item.id === noteId ? updatedNote : item));
    state.noteDrafts[noteId] = {
      ...createNoteDraft(updatedNote),
      isOpen: true,
      message: "일기·리뷰 기록을 저장했습니다.",
      tone: "success",
    };
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return;
    }

    draft.pending = false;
    draft.message = Number(error?.status) === 404
      ? "이 수첩 기록을 찾을 수 없습니다. 목록을 새로고침하세요."
      : "기록을 저장하지 못했습니다. 잠시 뒤 다시 시도하세요.";
    draft.tone = "error";
  } finally {
    if (state.accessToken) {
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

/**
 * 입력: 꿈돌이 항목.
 * 출력: 도감 카드 HTMLElement.
 * 역할: 해금 여부와 선택 버튼을 가진 꿈돌이 카드를 만든다.
 * 호출 예시: createGgumdoriCard(item)
 */
function createGgumdoriCard(item) {
  // 꿈돌이 카드 요소입니다.
  const card = createElement("article", `ggumdori-card ${item.unlocked ? "" : "is-locked"}`.trim());

  // 꿈돌이 카드 상단 영역입니다.
  const topline = createElement("div", "ggumdori-topline");
  topline.append(
    createElement("span", "category-tag", CATEGORY_LABELS[item.themeCategory] || "테마"),
    createElement("span", item.unlocked ? "status-tag status-tag--done" : "status-tag", item.unlocked ? "해금" : "잠김"),
  );

  const figure = createElement("div", "ggumdori-figure");
  if (item.imageRef) {
    // 꿈돌이 완성 이미지를 표시하는 요소입니다.
    const image = document.createElement("img");
    image.src = item.imageRef;
    image.alt = item.unlocked ? item.name : `${item.name} 잠김`;
    image.loading = "lazy";
    configureGgumdoriArtwork(image, "ggumdori-card-art");
    figure.append(image);
  } else {
    figure.textContent = item.unlocked ? item.name.slice(0, 1) : "?";
  }
  const title = createElement("h3", "", item.name);
  const condition = createElement("p", "card-description", `조건: ${item.condition}`);
  const button = createElement("button", "ggumdori-select", state.selectedGgumdoriId === item.id ? "선택됨" : "표시 꿈돌이로 선택");

  button.type = "button";
  button.disabled = !item.unlocked || state.selectedGgumdoriId === item.id;
  button.addEventListener("click", () => {
    state.selectedGgumdoriId = item.id;
    state.customizerPreviewId = item.id;
    writeStorageValue(SELECTED_GGUMDORI_KEY, item.id);
    renderAll();
  });

  card.append(topline, figure, title, condition, button);
  return card;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 꿈돌이 도감 그리드를 렌더링한다.
 * 호출 예시: renderGgumdori()
 */
function renderGgumdori() {
  // 꿈돌이 그리드 컨테이너입니다.
  const grid = select("#ggumdori-grid");

  if (!grid) {
    return;
  }

  grid.replaceChildren();
  state.ggumdori.forEach((item) => grid.append(createGgumdoriCard(item)));
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 보유한 꿈돌이 테마를 미리 보고 장착하는 게임형 꾸미기 화면을 그린다.
 * 호출 예시: renderCustomizer()
 */
function renderCustomizer() {
  const character = select("#customizer-character");
  const grid = select("#customizer-item-grid");
  const equipButton = select("#customizer-equip-button");

  if (!character || !grid || !equipButton) {
    return;
  }

  let previewItem = state.ggumdori.find((item) => item.id === state.customizerPreviewId);
  if (!previewItem) {
    previewItem = getSelectedGgumdori();
    state.customizerPreviewId = previewItem?.id || "";
  }

  character.replaceChildren();
  if (previewItem?.imageRef) {
    const image = document.createElement("img");
    image.src = previewItem.imageRef;
    image.alt = `${previewItem.name} 미리보기`;
    character.append(image);
  }

  const stageLabel = select("#customizer-stage-label");
  const itemName = select("#customizer-item-name");
  const itemCondition = select("#customizer-item-condition");
  const collectionCount = select("#customizer-collection-count");
  const unlockedCount = state.ggumdori.filter((item) => item.unlocked).length;

  if (stageLabel) stageLabel.textContent = previewItem?.name || "꿈돌이";
  if (itemName) itemName.textContent = previewItem?.name || "꿈돌이";
  if (itemCondition) itemCondition.textContent = previewItem?.condition || "획득 조건 확인";
  if (collectionCount) collectionCount.textContent = `획득 ${unlockedCount}/${state.ggumdori.length}`;

  const filteredItems = state.ggumdori.filter(
    (item) => state.customizerCategory === "all" || item.themeCategory === state.customizerCategory,
  );

  grid.replaceChildren();
  filteredItems.forEach((item) => {
    const tile = createElement("button", `customizer-item${item.id === previewItem?.id ? " is-previewing" : ""}${item.id === state.selectedGgumdoriId ? " is-equipped" : ""}${item.unlocked ? "" : " is-locked"}`);
    tile.type = "button";
    tile.setAttribute("role", "listitem");
    tile.setAttribute("aria-label", item.unlocked ? `${item.name} 미리보기` : `${item.name}, ${item.condition} 달성 시 해금`);
    tile.disabled = !item.unlocked;

    const thumb = createElement("span", "customizer-item-thumb");
    if (item.imageRef) {
      const image = document.createElement("img");
      image.src = item.imageRef;
      image.alt = "";
      image.loading = "lazy";
      configureGgumdoriArtwork(image, "customizer-item-art");
      thumb.append(image);
    }

    const status = createElement("span", "customizer-item-status", item.unlocked ? (item.id === state.selectedGgumdoriId ? "장착" : "보유") : "잠김");
    const name = createElement("span", "customizer-item-label", item.name.replace(" 꿈돌이", ""));
    tile.append(thumb, status, name);
    tile.addEventListener("click", () => {
      state.customizerPreviewId = item.id;
      renderCustomizer();
      const feedback = select("#customizer-feedback");
      if (feedback) feedback.textContent = `${item.name} 모습을 미리 보는 중이에요.`;
    });
    grid.append(tile);
  });

  const isEquipped = previewItem?.id === state.selectedGgumdoriId;
  equipButton.disabled = !previewItem?.unlocked || isEquipped;
  equipButton.textContent = isEquipped ? "현재 장착 중" : "이 모습으로 장착";

  document.querySelectorAll("[data-customize-category]").forEach((button) => {
    const isActive = button.dataset.customizeCategory === state.customizerCategory;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 전체 화면을 현재 상태 기준으로 다시 그린다.
 * 호출 예시: renderAll()
 */
function renderAll() {
  renderPlanningSettings();
  renderAttractions();
  renderAppHeader();
  renderBottomNavigation();
  renderProfile();
  renderHomeMetrics();
  renderRecentBadges();
  renderHomeRecommendations();
  renderRecommendationMeta();
  renderRecommendations();
  renderQuestBoard();
  renderMapView();
  renderBadges();
  renderNotes();
  renderGgumdori();
  renderCustomizer();
  renderActionDialog();
}

/**
 * 입력: 없음. 출력: 추천 기준 좌표와 이름.
 * 역할: 실측 위치와 계획 위치를 모드에 따라 구분합니다.
 * 호출 예시: const location = getRecommendationLocation()
 */
function getRecommendationLocation() {
  return state.recommendationMode === "planning" ? state.plannedLocation : state.location;
}

/**
 * 입력: 요청 시작 시 토큰과 세션 세대. 출력: 현재 사용자와 같은지 여부.
 * 역할: 로그아웃 또는 계정 전환 이전의 응답 반영을 막습니다.
 * 호출 예시: if (!isCurrentSession(token, version)) return
 */
function isCurrentSession(token, version) {
  return Boolean(token) && state.accessToken === token && state.sessionVersion === version;
}

/**
 * 입력: 서버의 선호도 객체. 출력: 검증된 관심사와 저장 여부.
 * 역할: 지원하지 않는 카테고리를 제외하고 서버 선호도를 정규화합니다.
 * 호출 예시: state.preference = normalizePreference(payload.preference)
 */
function normalizePreference(preference = {}) {
  return {
    ...preference,
    categories: Array.isArray(preference.categories)
      ? [...new Set(preference.categories.filter((category) => INTEREST_CATEGORIES.includes(category)))]
      : [],
    isConfigured: Boolean(preference.isConfigured),
  };
}

/**
 * 입력: 없음. 출력: 관심사 저장 Promise.
 * 역할: 선택을 서버에 저장한 후 추천을 갱신하며 실패한 선택을 저장 완료로 표시하지 않습니다.
 * 호출 예시: await savePreferences()
 */
async function savePreferences() {
  if (!ensureSessionReady() || state.preferencePending) return;
  // 변수 의미: 이 저장 요청이 속한 사용자, 세션, 요청 순번입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.preferenceRequestId;
  // 변수 의미: 저장 버튼을 누른 순간의 관심사입니다.
  const categories = [...state.interestDraft];
  state.preferencePending = true;
  state.preferenceMessage = "관심사를 저장하고 있습니다.";
  renderPlanningSettings();
  try {
    // 변수 의미: 서버 저장 결과 또는 서버 저장이 없는 미리보기 값입니다.
    const payload = IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW
      ? { preference: { categories, isConfigured: true } }
      : await fetchJson("/api/me/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories }),
      });
    if (!isCurrentSession(token, version) || requestId !== state.preferenceRequestId) return;
    state.preference = normalizePreference(payload.preference);
    state.interestDraft = [...state.preference.categories];
    state.interestDirty = false;
    state.preferenceMessage = IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW
      ? "미리보기에서만 적용했습니다. 계정에는 저장되지 않습니다."
      : "관심사를 저장했습니다. 추천에 반영했어요.";
    await Promise.allSettled([loadRecommendations(), loadAttractions()]);
  } catch (error) {
    if (!isCurrentSession(token, version) || requestId !== state.preferenceRequestId) return;
    state.preferenceMessage = "관심사 저장에 실패했습니다. 선택을 확인한 뒤 다시 저장해 주세요.";
  } finally {
    if (isCurrentSession(token, version) && requestId === state.preferenceRequestId) {
      state.preferencePending = false;
      renderPlanningSettings();
    }
  }
}

/**
 * 입력: nearby 또는 planning. 출력: 없음.
 * 역할: GPS 권한을 자동 요청하지 않고 추천 기준을 전환합니다.
 * 호출 예시: setRecommendationMode("planning")
 */
function setRecommendationMode(mode) {
  if (!ensureSessionReady() || !["nearby", "planning"].includes(mode)) return;
  state.locationRequestId += 1;
  state.recommendationMode = mode;
  state.planningMessage = mode === "planning" ? "계획할 지역을 고르면 주변 퀘스트를 볼 수 있어요." : "내 위치로 추천 버튼을 누르면 GPS 위치를 사용합니다.";
  renderPlanningSettings();
  loadRecommendations();
}

/**
 * 입력: 위도·경도·이름을 가진 위치와 퀘스트 화면 이동 여부. 출력: 유효한 적용 여부.
 * 역할: 지도, 주소, 거점, 좌표 입력을 같은 여행 계획 상태로 적용합니다.
 * 호출 예시: setPlanningLocation({lat:36.35,lng:127.38,label:"여행 시작점"}, true)
 */
function setPlanningLocation(location, openQuests = false) {
  // 변수 의미: 검증할 숫자 좌표입니다.
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (location.lat === "" || location.lng === "" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    state.planningMessage = "위도는 -90~90, 경도는 -180~180 사이의 숫자로 입력해 주세요.";
    renderPlanningSettings();
    return false;
  }
  if (!ensureSessionReady()) return false;
  state.locationRequestId += 1;
  state.addressRequestId += 1;
  state.addressPending = false;
  state.recommendationMode = "planning";
  state.plannedLocation = { lat, lng, label: String(location.label || "선택한 계획 위치") };
  state.planningInputLocationKey = "";
  state.planningMessage = `${state.plannedLocation.label} 주변 퀘스트를 조회합니다. 완료 인증은 현장 GPS가 필요합니다.`;
  state.addressResults = [];
  renderPlanningSettings();
  loadRecommendations();
  if (openQuests) setActiveView("quests");
  return true;
}

/**
 * 입력: 없음. 출력: 주소 검색 Promise.
 * 역할: 기존 지도 서버 프록시로 주소를 검색하며 지도 장애에는 대체 입력을 안내합니다.
 * 호출 예시: await searchPlanningAddress()
 */
async function searchPlanningAddress() {
  if (!ensureSessionReady()) return;
  // 변수 의미: 사용자가 입력한 검색어입니다.
  const query = select("#planning-address")?.value.trim() || "";
  if (!query) {
    state.planningMessage = "도로명이나 지번 주소를 입력해 주세요.";
    renderPlanningSettings();
    return;
  }
  // 변수 의미: 현재 사용자와 주소 검색 순번입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.addressRequestId;
  state.addressPending = true;
  state.addressResults = [];
  state.planningMessage = "주소를 검색하고 있습니다.";
  renderPlanningSettings();
  try {
    // 변수 의미: NAVER 주소 검색 프록시 응답입니다.
    const payload = await fetchJson(`/api/naver-map/geocode?${new URLSearchParams({ query })}`);
    if (!isCurrentSession(token, version) || requestId !== state.addressRequestId) return;
    state.addressResults = (payload.addresses || []).map((address) => ({
      lat: Number(address.y), lng: Number(address.x), label: address.roadAddress || address.jibunAddress || query,
    })).filter((location) => Number.isFinite(location.lat) && Number.isFinite(location.lng));
    state.planningMessage = state.addressResults.length ? "추천 기준으로 사용할 주소를 선택해 주세요." : "주소 검색 결과가 없습니다. 주요 지점이나 좌표 입력을 이용해 주세요.";
  } catch (error) {
    if (!isCurrentSession(token, version) || requestId !== state.addressRequestId) return;
    state.planningMessage = "주소 검색에 연결할 수 없습니다. 주요 지점이나 좌표 입력으로 계속할 수 있어요.";
  } finally {
    if (isCurrentSession(token, version) && requestId === state.addressRequestId) {
      state.addressPending = false;
      renderPlanningSettings();
    }
  }
}

/**
 * 입력: 없음. 출력: 없음.
 * 역할: 관심사, 모드, 기준점 요약을 모든 관련 화면에 동기화합니다.
 * 호출 예시: renderPlanningSettings()
 */
function renderPlanningSettings() {
  document.querySelectorAll("[data-interest-category]").forEach((input) => {
    input.checked = state.interestDraft.includes(input.dataset.interestCategory);
    input.disabled = state.preferencePending;
  });
  // 변수 의미: 관심사 안내와 저장 버튼입니다.
  const guidance = select("#interest-guidance");
  const message = select("#interest-message");
  const saveButton = select("#save-interests-button");
  if (guidance) guidance.textContent = state.preference.isConfigured
    ? "관심사를 여러 개 고를 수 있어요. 선택 없이 저장하면 모든 주제를 탐색합니다."
    : "첫 여행인가요? 좋아하는 주제를 골라 보세요. 선택 없이도 시작할 수 있어요.";
  if (message) message.textContent = state.preferenceMessage;
  if (saveButton) {
    saveButton.disabled = state.preferencePending;
    saveButton.textContent = state.preferencePending ? "저장 중…" : "관심사 저장";
    saveButton.setAttribute("aria-busy", String(state.preferencePending));
  }
  document.querySelectorAll("[data-recommendation-mode]").forEach((button) => {
    // 변수 의미: 현재 추천 모드와 버튼의 선택 상태입니다.
    const selected = button.dataset.recommendationMode === state.recommendationMode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  // 변수 의미: 모드별 입력 패널과 안내문입니다.
  const planning = select("#planning-controls");
  const nearby = select("#nearby-guidance");
  const planningMessage = select("#planning-message");
  const searchButton = select("#planning-search-button");
  if (planning) planning.hidden = state.recommendationMode !== "planning";
  if (nearby) nearby.hidden = state.recommendationMode === "planning";
  if (planningMessage) planningMessage.textContent = state.planningMessage;
  if (searchButton) {
    searchButton.disabled = state.addressPending;
    searchButton.textContent = state.addressPending ? "검색 중…" : "주소 검색";
  }
  // 변수 의미: 현재 추천 기준과 모드 요약입니다.
  const location = getRecommendationLocation();
  const summary = `${state.recommendationMode === "planning" ? "여행 계획" : "내 주변"} · ${location.label}`;
  document.querySelectorAll("[data-recommendation-summary]").forEach((element) => { element.textContent = summary; });
  // 변수 의미: 선택한 기준점에 맞게 동기화할 좌표 입력입니다.
  const latitude = select("#planning-latitude");
  const longitude = select("#planning-longitude");
  // 변수 의미: 실제 기준점이 달라진 경우에만 입력을 갱신해 작성 중인 좌표를 보존합니다.
  const locationKey = `${state.plannedLocation.lat}:${state.plannedLocation.lng}`;
  if (state.planningInputLocationKey !== locationKey) {
    if (latitude) latitude.value = String(state.plannedLocation.lat);
    if (longitude) longitude.value = String(state.plannedLocation.lng);
    state.planningInputLocationKey = locationKey;
  }
  // 변수 의미: 현재 기준점에 해당하는 주요 지점 선택입니다.
  const preset = select("#planning-preset");
  const presetIndex = PLANNING_PRESETS.findIndex((item) => item.lat === state.plannedLocation.lat && item.lng === state.plannedLocation.lng);
  if (preset) preset.value = presetIndex < 0 ? "" : String(presetIndex);
  // 변수 의미: 검색 결과를 선택 버튼으로 표시하는 컨테이너입니다.
  const results = select("#planning-address-results");
  if (results) {
    results.replaceChildren();
    state.addressResults.forEach((address) => {
      // 변수 의미: 해당 주소를 추천 기준점으로 적용하는 버튼입니다.
      const button = createElement("button", "map-secondary-button planning-address-result", address.label);
      button.type = "button";
      button.addEventListener("click", () => setPlanningLocation(address));
      results.append(button);
    });
  }
  // 변수 의미: 지도의 계획 선택 도움말과 화면 제목입니다.
  const mapHint = select("#map-planning-hint");
  const mapTitle = select("#map-title");
  if (mapHint) mapHint.textContent = state.recommendationMode === "planning"
    ? "NAVER 지도 빈 곳을 누르면 계획 위치가 바뀝니다. 지도 연결이 없으면 추천 설정의 주요 지점·좌표 입력을 사용하세요."
    : "여행 전에 다른 지역을 살펴보려면 추천 설정에서 여행 계획 모드를 선택하세요.";
  if (mapTitle) mapTitle.textContent = state.recommendationMode === "planning" ? "계획 위치 주변 퀘스트" : "내 주변 퀘스트";
}

/**
 * 입력: 강제 새로고침 여부. 출력: 대전 관광지 조회 Promise.
 * 역할: 좌표 없이 관심사 기반 관광지를 조회하고 이전 세션 응답은 무시합니다.
 * 호출 예시: await loadAttractions(true)
 */
async function loadAttractions(forceRefresh = false) {
  // 변수 의미: 조회가 속한 사용자와 요청 순번입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.attractionRequestId;
  // 변수 의미: GPS를 포함하지 않는 대전 전체 조회 조건입니다.
  const query = new URLSearchParams({ category: state.attractionCategory });
  if (forceRefresh) query.set("refresh", "1");
  state.attractionPending = true;
  state.attractionMessage = "대전 관광지를 불러오고 있습니다.";
  renderAttractions();
  try {
    if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
      state.attractions = [];
      state.attractionMessage = "미리보기에서는 대전 전체 관광지를 조회하지 않습니다. 앱 서버에 연결하면 관심사 추천을 볼 수 있어요.";
      return;
    }
    // 변수 의미: 퀘스트 인스턴스를 만들지 않는 관광지 API 응답입니다.
    const payload = await fetchJson(`/api/places/recommendations?${query}`);
    if (!isCurrentSession(token, version) || requestId !== state.attractionRequestId) return;
    state.attractions = Array.isArray(payload.recommendations) ? payload.recommendations : [];
    // 변수 의미: 대전 관광지의 원천 상태와 부분 조회 안내입니다.
    const sourceStatus = String(payload.cache?.sourceStatus || "");
    const attribution = payload.attribution || "관광정보 제공: 한국관광공사(TourAPI)";
    state.attractionMessage = sourceStatus.startsWith("fallback:")
      ? `${attribution} · 관광정보 연결을 사용할 수 없어 예시 장소를 표시합니다.`
      : `${attribution}${sourceStatus.includes("partial") ? " · 일부 관광지를 먼저 불러왔습니다." : ""} · 현재 위치와 관계없이 관심사를 기준으로 추천합니다.`;
  } catch (error) {
    if (!isCurrentSession(token, version) || requestId !== state.attractionRequestId) return;
    state.attractions = [];
    state.attractionMessage = "대전 관광지를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요.";
  } finally {
    if (isCurrentSession(token, version) && requestId === state.attractionRequestId) {
      state.attractionPending = false;
      renderAttractions();
    }
  }
}

/**
 * 입력: 없음. 출력: 없음.
 * 역할: 거리와 퀘스트 보상 없이 대전 전체 관광지와 관심사 추천 이유를 표시합니다.
 * 호출 예시: renderAttractions()
 */
function renderAttractions() {
  // 변수 의미: 관광지 카드 목록, 출처 안내, 새로고침 버튼입니다.
  const list = select("#attraction-list");
  const message = select("#attraction-message");
  const refresh = select("#refresh-attractions-button");
  if (message) message.textContent = state.attractionMessage;
  if (refresh) refresh.disabled = state.attractionPending;
  if (!list) return;
  list.setAttribute("aria-busy", String(state.attractionPending));
  list.replaceChildren();
  if (state.attractionPending) {
    list.append(createElement("p", "empty-message", "관심사에 맞는 대전 관광지를 찾고 있어요."));
    return;
  }
  if (state.attractions.length === 0) {
    list.append(createElement("p", "empty-message", "표시할 관광지가 없습니다. 다른 카테고리를 선택하거나 다시 불러와 주세요."));
    return;
  }
  state.attractions.forEach((item) => {
    // 변수 의미: 서버가 반환한 관광지와 표시할 카드입니다.
    const place = item.place || {};
    const card = createElement("article", "attraction-card");
    const category = place.categoryCode || place.category || "all";
    const title = createElement("h3", "card-title", place.name || place.title || "대전 관광지");
    const reason = createElement("p", "attraction-reason", item.reason || "대전에서 둘러볼 수 있는 관광지예요.");
    const button = createElement("button", "secondary-action", "이 장소 주변 퀘스트 보기");
    const latitude = place.latitude ?? place.lat;
    const longitude = place.longitude ?? place.lng;
    button.type = "button";
    button.disabled = latitude == null || longitude == null || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude));
    button.addEventListener("click", () => setPlanningLocation({ lat: latitude, lng: longitude, label: title.textContent }, true));
    card.append(createElement("span", "category-tag", `${getCategoryIcon(category)} ${CATEGORY_LABELS[category] || "관광"}`), title);
    if (place.address) card.append(createElement("p", "card-place", place.address));
    card.append(reason, button);
    list.append(card);
  });
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

  state.selectedCategory = category;

  // 모든 카테고리 필터 버튼입니다.
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
 * 입력: 브라우저 Geolocation Position.
 * 출력: 화면 상태에 저장할 위치 객체.
 * 역할: 실측 좌표와 정확도를 추천 기준 위치 형식으로 변환한다.
 * 호출 예시: state.location = normalizeMeasuredLocation(position)
 */
function normalizeMeasuredLocation(position) {
  // 브라우저에서 받은 좌표 객체입니다.
  const coordinates = position.coords;

  // 위치 정확도 미터 값입니다.
  const accuracyMeters = toNumber(coordinates.accuracy, 999);

  return {
    lat: coordinates.latitude,
    lng: coordinates.longitude,
    accuracyMeters,
    label: `현재 위치 기준, 정확도 ${Math.round(accuracyMeters)}m`,
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

    state.evidenceUploads[instanceId] = {
      ...evidence,
      ocrStatus: "done",
      ocrText: payload.ocr?.text || "",
      ocrLines: payload.ocr?.lines || [],
      requirementCheck: payload.requirementCheck || null,
    };
    updateSystemStatus(true, getReceiptRequirementText(payload.requirementCheck) || "OCR 확인 완료");
  } catch (error) {
    state.evidenceUploads[instanceId] = {
      ...evidence,
      ocrStatus: "failed",
      message: getEvidenceUploadFailureMessage(error),
    };
    updateSystemStatus(state.apiHealthy, "사진은 업로드됐고 OCR 확인은 실패했습니다.");
  } finally {
    renderAll();
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

    if (file.size > toNumber(upload.maxUploadBytes, DEFAULT_EVIDENCE_MAX_UPLOAD_BYTES)) {
      throw new Error(`${formatBytes(upload.maxUploadBytes)} 이하 이미지만 업로드할 수 있습니다.`);
    }

    await uploadEvidenceFile(upload, file);

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
  updateSystemStatus(state.apiHealthy, "현재 위치 확인 중");

  // 완료 버튼을 누른 순간의 실측 위치입니다.
  const position = await readCurrentPosition({
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });

  // 화면과 지도에 반영할 실측 위치입니다.
  const measuredLocation = normalizeMeasuredLocation(position);
  state.location = measuredLocation;
  syncNaverPositionMarker();

  // 변수 의미: 현재 퀘스트에 업로드된 사진 증빙 상태입니다.
  const evidence = state.evidenceUploads[recommendation?.instanceId || ""];
  // 변수 의미: 완료 요청에 첨부할 Object Storage 객체 키입니다.
  const objectKey = evidence?.objectKey || "";

  return {
    latitude: measuredLocation.lat,
    longitude: measuredLocation.lng,
    accuracyMeters: Math.round(measuredLocation.accuracyMeters),
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
function showQuestActionDialog(action, recommendation, actionResult = {}, message = "") {
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

  state.actionDialog = {
    title: succeeded ? (isComplete ? "퀘스트 완료 확인" : "퀘스트 수락 확인") : "퀘스트 처리 실패",
    message: message || (succeeded ? "버튼 입력이 정상 처리되었습니다." : "요청이 처리되지 않았습니다."),
    details: details.filter(Boolean),
    tone: succeeded ? "success" : "warning",
  };
  renderActionDialog();
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

  dialog.append(title, message, detailList, closeButton);
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
  if (!ensureSessionReady()) return;
  // 변수 의미: GPS 요청이 속한 세션과 위치 변경 순번입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.locationRequestId;
  state.planningMessage = "현재 위치를 확인하고 있습니다.";
  renderPlanningSettings();
  readCurrentPosition({ enableHighAccuracy: true, timeout: 7000, maximumAge: 300000 })
    .then((position) => {
      if (!isCurrentSession(token, version) || requestId !== state.locationRequestId) return;
      state.location = normalizeMeasuredLocation(position);
      state.recommendationMode = "nearby";
      state.planningMessage = "현재 위치를 추천 기준으로 적용했습니다.";
      renderPlanningSettings();
      loadRecommendations();
    })
    .catch(() => {
      if (!isCurrentSession(token, version) || requestId !== state.locationRequestId) return;
      state.planningMessage = "현재 위치를 확인하지 못했습니다. 기존 기준점을 유지합니다. 여행 계획 모드는 GPS 없이 사용할 수 있어요.";
      renderPlanningSettings();
      updateSystemStatus(state.apiHealthy, "위치 확인 실패 · 계획 모드 사용 가능");
    });
}

/**
 * 입력: 강제 새로고침 여부.
 * 출력: 추천 목록 로드 Promise.
 * 역할: 추천 API를 호출하며 정상 빈 결과와 연결 실패를 구분합니다.
 * 호출 예시: await loadRecommendations(true)
 */
async function loadRecommendations(forceRefresh = false) {
  // 변수 의미: 응답이 현재 사용자와 추천 조건의 것인지 판별하는 정보입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.recommendationRequestId;
  // 변수 의미: 현재 추천 기준점과 API 쿼리입니다.
  const location = getRecommendationLocation();
  const query = new URLSearchParams({
    lat: String(location.lat), lng: String(location.lng), category: state.selectedCategory,
    mode: state.recommendationMode,
  });
  if (forceRefresh) query.set("refresh", "1");
  state.recommendationPending = true;
  state.recommendations = [];
  renderHomeRecommendations();
  renderHomeMetrics();
  renderQuestBoard();
  renderRecommendations();
  renderMapView();
  try {
    if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
      state.recommendations = FALLBACK_RECOMMENDATIONS.map(normalizeRecommendation);
      state.dataSource = "fallback";
      return;
    }
    // 변수 의미: 추천 API의 JSON 응답이며 빈 배열도 정상 결과입니다.
    const payload = await fetchJson(`/api/recommendations?${query}`);
    if (!isCurrentSession(token, version) || requestId !== state.recommendationRequestId) return;
    state.recommendations = unwrapList(payload).map(normalizeRecommendation);
    state.dataSource = "api";
    state.recommendationMeta = normalizeRecommendationMeta(payload);
  } catch (error) {
    if (!isCurrentSession(token, version) || requestId !== state.recommendationRequestId) return;
    state.recommendations = [];
    state.dataSource = "error";
  } finally {
    if (isCurrentSession(token, version) && requestId === state.recommendationRequestId) {
      state.recommendationPending = false;
      renderPlanningSettings();
      renderRecommendationMeta();
      renderHomeMetrics();
      renderHomeRecommendations();
      renderRecommendations();
      renderQuestBoard();
      renderMapView();
    }
  }
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
      requestOptions.headers = { "Content-Type": "application/json" };
      requestOptions.body = JSON.stringify(completionBody);
    }

    // 앱 서버에서 받은 액션 처리 결과입니다.
    const actionResult = await fetchJson(path, requestOptions);
    if (action === "complete" && actionResult.ok === false) {
      state.apiHealthy = true;
      // 변수 의미: 완료 실패 안내 문구입니다.
      const failureMessage = getActionFailureMessage(action, actionResult);
      updateSystemStatus(true, failureMessage);
      showQuestActionDialog(action, recommendation, actionResult, failureMessage);
      return;
    }

    // 액션 성공 후 반영할 상태입니다.
    const nextStatus = action === "complete" ? "completed" : "accepted";

    state.apiHealthy = true;
    state.questStatuses[instanceId] = nextStatus;
    persistQuestStatuses();

    if (action === "complete") {
      await Promise.allSettled([loadUser(), loadBadges(), loadNotes(), loadGgumdori()]);
    }

    // 변수 의미: 액션 성공 안내 문구입니다.
    const successMessage = action === "complete" ? "GPS 기준 완료됨" : "퀘스트 수락됨";
    updateSystemStatus(true, successMessage);
    showQuestActionDialog(action, recommendation, actionResult, successMessage);
  } catch (error) {
    if (!isUnauthorizedError(error)) {
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
    delete state.pendingQuestActions[instanceId];
    renderAll();
  }
}

/**
 * 입력: 없음.
 * 출력: 사용자 정보 로드 Promise.
 * 역할: /api/me를 호출하고 실패 시 기본 사용자 정보를 유지한다.
 * 호출 예시: await loadUser()
 */
async function loadUser() {
  // 변수 의미: 사용자와 선호도 요청의 순서를 검증할 시작 상태입니다.
  const token = state.accessToken;
  const version = state.sessionVersion;
  const requestId = ++state.userRequestId;
  const preferenceId = state.preferenceRequestId;
  try {
    // 사용자 API 응답입니다.
    const payload = await fetchJson("/api/me");
    // 사용자 응답이 data로 래핑된 경우의 실제 본문입니다.
    const user = payload.data || payload.user || payload;
    if (!isCurrentSession(token, version) || requestId !== state.userRequestId) return;
    if (preferenceId === state.preferenceRequestId && !state.preferencePending) {
      state.preference = normalizePreference(user.preference);
      if (!state.interestDirty) state.interestDraft = [...state.preference.categories];
    }

    // 레벨 진행도 응답 객체입니다.
    const level = user.level || user.levelProgress || {};

    // 사용자 통계 응답 객체입니다.
    const stats = user.stats || {};

    state.user = {
      nickname: user.nickname || user.name || FALLBACK_USER.nickname,
      level: toNumber(user.currentLevel || level.currentLevel || level.level, FALLBACK_USER.level),
      xp: toNumber(user.xp || user.currentXp || level.currentXp || level.xp || level.totalXp, FALLBACK_USER.xp),
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
    };
  } catch (error) {
    if (!isCurrentSession(token, version) || requestId !== state.userRequestId) return;
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
  try {
    // 뱃지 API 응답입니다.
    const payload = await fetchJson("/api/badges");
    // 정규화한 뱃지 목록입니다.
    const badges = unwrapList(payload).map(normalizeBadge);

    state.badges = badges.length > 0 ? badges : [...FALLBACK_BADGES];
  } catch (error) {
    state.badges = [...FALLBACK_BADGES];
  }
}

/**
 * 입력: 없음.
 * 출력: 수첩 기록 로드 Promise.
 * 역할: /api/notes와 각 사진의 다운로드 URL을 호출하고 API의 빈 목록도 그대로 유지한다.
 * 호출 예시: await loadNotes()
 */
async function loadNotes() {
  try {
    // 수첩 API 응답입니다.
    const payload = await fetchJson("/api/notes");
    // 정규화한 수첩 기록 목록입니다.
    const notes = unwrapList(payload).map(normalizeNote);
    // 새 서버 응답과 병합하기 전의 편집 상태입니다.
    const previousDrafts = state.noteDrafts;

    state.notes = notes;
    state.notesSource = "api";
    state.notePhotos = {};
    state.noteDrafts = Object.fromEntries(
      notes.map((note) => {
        // 사용자가 아직 저장하지 않은 입력이 있는 기존 편집 상태입니다.
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

    // 사진이 있는 완료 기록마다 현재 사용자용 presigned GET URL을 발급합니다.
    const photoRequests = notes
      .filter((note) => note.photoRef)
      .map((note) => requestNotePhoto(note));
    await Promise.allSettled(photoRequests);
  } catch (error) {
    state.notes = [...FALLBACK_NOTES];
    state.notesSource = "fallback";
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
  try {
    // 꿈돌이 API 응답입니다.
    const payload = await fetchJson("/api/ggumdori");
    // 정규화한 꿈돌이 목록입니다.
    const ggumdori = unwrapList(payload).map(normalizeGgumdori);

    state.ggumdori = ggumdori.length > 0 ? ggumdori : [...FALLBACK_GGUMDORI];
    state.selectedGgumdoriId = payload.selectedVariantId || state.selectedGgumdoriId;
  } catch (error) {
    state.ggumdori = [...FALLBACK_GGUMDORI];
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
  if (IS_DESIGN_PREVIEW || IS_HOSTED_STATIC_PREVIEW) {
    await Promise.allSettled([loadRecommendations(forceRefresh), loadAttractions(forceRefresh)]);
    updateSystemStatus(false, "화면 체험 모드");
    renderAll();
    return;
  }
  await Promise.allSettled([loadHealth(), loadUser(), loadBadges(), loadNotes(), loadGgumdori(), loadMapConfig()]);
  if (!state.accessToken) return;
  await Promise.allSettled([loadRecommendations(forceRefresh), loadAttractions(forceRefresh)]);
  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 사용자 입력 이벤트를 등록한다.
 * 호출 예시: bindEvents()
 */
function bindEvents() {
  bindPlanningEvents();
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

  document.querySelectorAll("[data-customize-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.customizerCategory = button.dataset.customizeCategory || "all";
      renderCustomizer();
    });
  });

  const equipButton = select("#customizer-equip-button");
  if (equipButton) {
    equipButton.addEventListener("click", () => {
      const previewItem = state.ggumdori.find((item) => item.id === state.customizerPreviewId);
      if (!previewItem?.unlocked) return;

      state.selectedGgumdoriId = previewItem.id;
      writeStorageValue(SELECTED_GGUMDORI_KEY, previewItem.id);
      renderProfile();
      renderGgumdori();
      renderCustomizer();

      const feedback = select("#customizer-feedback");
      if (feedback) feedback.textContent = `${previewItem.name} 장착 완료! 홈 화면에도 적용됐어요.`;
    });
  }

  document.addEventListener("click", (event) => {
    // 실제 클릭 대상 요소입니다.
    const target = event.target instanceof Element ? event.target : null;

    if (!target) {
      return;
    }

    // 화면 전환 버튼입니다.
    const viewTarget = target.closest("[data-view-target]");
    if (!viewTarget) {
      return;
    }

    setActiveView(viewTarget.dataset.viewTarget || "home");
  });

  window.addEventListener("hashchange", () => {
    setActiveView(readInitialView(), false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.actionDialog) {
      closeActionDialog();
    }
  });
}

/**
 * 입력: 없음. 출력: 없음.
 * 역할: 관심사, 여행 위치 선택, 대전 관광지 입력을 기존 화면 이벤트에 연결합니다.
 * 호출 예시: bindPlanningEvents()
 */
function bindPlanningEvents() {
  document.querySelectorAll("[data-interest-category]").forEach((input) => {
    input.addEventListener("change", () => {
      state.interestDraft = [...document.querySelectorAll("[data-interest-category]:checked")].map((item) => item.dataset.interestCategory);
      state.interestDirty = true;
      state.preferenceMessage = "선택한 관심사를 저장하면 추천에 반영됩니다.";
      renderPlanningSettings();
    });
  });
  select("#save-interests-button")?.addEventListener("click", savePreferences);
  document.querySelectorAll("[data-recommendation-mode]").forEach((button) => {
    button.addEventListener("click", () => setRecommendationMode(button.dataset.recommendationMode));
  });
  // 변수 의미: 주요 여행 지점을 고르는 셀렉트입니다.
  const preset = select("#planning-preset");
  if (preset) {
    PLANNING_PRESETS.forEach((location, index) => {
      // 변수 의미: GPS 없이 선택할 수 있는 여행 기준점 옵션입니다.
      const option = createElement("option", "", location.label);
      option.value = String(index);
      preset.append(option);
    });
    preset.addEventListener("change", () => {
      if (preset.value !== "" && PLANNING_PRESETS[Number(preset.value)]) setPlanningLocation(PLANNING_PRESETS[Number(preset.value)]);
    });
  }
  select("#planning-address-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    searchPlanningAddress();
  });
  select("#planning-coordinate-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    setPlanningLocation({ lat: select("#planning-latitude").value, lng: select("#planning-longitude").value, label: "직접 지정한 위치" });
  });
  document.querySelectorAll("[data-open-planning-settings]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveView("home");
      select("#recommendation-settings-title")?.focus({ preventScroll: true });
      select("#recommendation-settings")?.scrollIntoView({ block: "start" });
    });
  });
  select("#attraction-category")?.addEventListener("change", (event) => {
    state.attractionCategory = event.target.value;
    loadAttractions();
  });
  select("#refresh-attractions-button")?.addEventListener("click", () => loadAttractions(true));
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
  setActiveView(state.activeView, false);
  renderAll();
  if (!oauthRedirectPending && ensureSessionReady()) {
    loadInitialData();
  }
}

initializeApp();
