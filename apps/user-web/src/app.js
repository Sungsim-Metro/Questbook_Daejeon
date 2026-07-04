// 사용자 모바일 웹/PWA의 화면 상태, API 호출, 목업 fallback 렌더링을 담당하는 파일입니다.

// API 요청이 실패했을 때 화면을 채우는 기본 사용자 정보입니다.
const FALLBACK_USER = {
  nickname: "대전 탐험가",
  level: 3,
  xp: 1240,
  nextLevelXp: 1800,
  completedQuestCount: 8,
  badgeCount: 5,
  selectedGgumdoriName: "안경 꿈돌이",
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
  nature: "자연",
  science: "과학",
  downtown: "원도심",
  market: "상권",
  mobility: "이동",
  nightview: "야경",
};

// 하단 탭과 헤더에서 사용하는 화면 메타데이터입니다.
const VIEW_META = {
  home: { title: "모험가 홈", eyebrow: "QUESTBOOK", icon: "✦", label: "홈", navIcon: "⌂" },
  map: { title: "탐험 지도", eyebrow: "MAP", icon: "⌖", label: "지도", navIcon: "⌖" },
  quests: { title: "퀘스트 목록", eyebrow: "QUEST", icon: "✓", label: "퀘스트", navIcon: "✓" },
  notes: { title: "탐험 노트", eyebrow: "NOTE", icon: "▤", label: "수첩", navIcon: "▤" },
  badges: { title: "뱃지 수첩", eyebrow: "BADGE", icon: "●", label: "뱃지", navIcon: "●" },
};

// 하단 탭의 표시 순서입니다.
const NAVIGATION_ITEMS = ["home", "map", "quests", "notes", "badges"];

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
  { id: "science-1", name: "안경 꿈돌이", themeCategory: "science", unlocked: true, condition: "science Lv.1", imageRef: "/assets/ggumdori/science-1.svg" },
  { id: "science-2", name: "플라스크 꿈돌이", themeCategory: "science", unlocked: false, condition: "science Lv.2", imageRef: "/assets/ggumdori/science-2.svg" },
  { id: "market-2", name: "제빵 꿈돌이", themeCategory: "market", unlocked: true, condition: "market Lv.2", imageRef: "/assets/ggumdori/market-2.svg" },
  { id: "nature-2", name: "숲 탐험 꿈돌이", themeCategory: "nature", unlocked: true, condition: "nature Lv.2", imageRef: "/assets/ggumdori/nature-2.svg" },
  { id: "mobility-1", name: "타슈 꿈돌이", themeCategory: "mobility", unlocked: false, condition: "mobility Lv.1", imageRef: "/assets/ggumdori/mobility-1.svg" },
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

// 화면 전체의 현재 상태입니다.
const state = {
  apiHealthy: false,
  activeView: readInitialView(),
  dataSource: "fallback",
  selectedCategory: "all",
  location: { ...FALLBACK_LOCATION },
  user: { ...FALLBACK_USER },
  recommendations: [...FALLBACK_RECOMMENDATIONS],
  badges: [...FALLBACK_BADGES],
  notes: [...FALLBACK_NOTES],
  ggumdori: [...FALLBACK_GGUMDORI],
  questStatuses: readStoredQuestStatuses(),
  selectedGgumdoriId: readSelectedGgumdoriId(),
  selectedMapInstanceId: FALLBACK_RECOMMENDATIONS[0]?.instanceId || "",
  accessToken: readStorageValue(ACCESS_TOKEN_KEY),
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
  return readStorageValue(SELECTED_GGUMDORI_KEY) || "science-1";
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
  removeStorageValue(ACCESS_TOKEN_KEY);
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
    if (isUnauthorizedError(error) && state.accessToken) {
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
    placeLatitude: toNumber(item.latitude || place.latitude, state.location.lat),
    placeLongitude: toNumber(item.longitude || place.longitude, state.location.lng),
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

  return {
    id: String(note.id || note.noteId || createClientId("note")),
    title: note.title || note.questTitle || "퀘스트 완료 기록",
    placeName: note.placeName || note.placeReference?.placeName || "대전 관광지",
    createdAt: note.createdAt || note.completedAt || new Date().toISOString(),
    earnedXp: toNumber(note.earnedXp, 0),
    badges: Array.isArray(note.badges) ? note.badges.map((badge) => badge.name || badge) : [],
    memo: note.memo || note.summary || "완료한 퀘스트가 수첩에 기록되었습니다.",
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

  navigator.serviceWorker.register("./service-worker.js").catch(() => {
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

  profileText.append(name, meta, selectedName);
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
    ["📍", state.location.label.replace(" 기준", ""), "현재 위치 후보"],
    ["🏷️", `${earnedBadges.length}개`, "획득 뱃지"],
    ["🗺️", `${state.recommendations.length}개`, "주변 퀘스트"],
    ["🎁", state.dataSource === "api" ? "API" : "Fallback", "추천 데이터"],
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
    mapCopy.textContent = `${state.location.label} · ${state.location.lat.toFixed(4)}, ${state.location.lng.toFixed(4)} · ${mapStatus}`;
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
    homeDataNote.textContent =
      state.dataSource === "api"
        ? "관광정보 제공: 한국관광공사(TourAPI). 현재 추천은 앱 API 응답입니다."
        : "TourAPI 키가 없거나 호출에 실패해 대전 fallback 장소 데이터로 표시합니다.";
  }
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
  acceptButton.disabled = questStatus === "accepted" || questStatus === "in_progress" || questStatus === "completed";
  completeButton.disabled = questStatus === "completed" || questStatus === "done";
  acceptButton.addEventListener("click", () => handleQuestAction(recommendation.instanceId, "accept"));
  completeButton.addEventListener("click", () => handleQuestAction(recommendation.instanceId, "complete"));
  actions.append(acceptButton, completeButton);

  // 현재 상태 태그입니다.
  const statusTag = createElement("span", getQuestStatusClass(questStatus), getQuestStatusLabel(questStatus));

  card.append(topline, statusTag, title, place, description, rewardRow, actions);
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
    list.append(createElement("p", "empty-message", "이 카테고리의 추천 퀘스트가 아직 없습니다."));
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
  // 위도 목록입니다.
  const latitudes = places.map((item) => item.placeLatitude).concat(state.location.lat);
  // 경도 목록입니다.
  const longitudes = places.map((item) => item.placeLongitude).concat(state.location.lng);
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
  currentLocationMarker.title = state.location.label;
  currentLocationMarker.style.left = `${toMapPercent(state.location.lng, minLongitude, maxLongitude)}%`;
  currentLocationMarker.style.top = `${toMapPercent(state.location.lat, minLatitude, maxLatitude, true)}%`;
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

  // 지도 중심 좌표입니다.
  const center = new window.naver.maps.LatLng(state.location.lat, state.location.lng);
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
  const position = new window.naver.maps.LatLng(state.location.lat, state.location.lng);

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
  const places = state.recommendations.length > 0 ? state.recommendations : [...FALLBACK_RECOMMENDATIONS];

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

  state.notes.forEach((note) => {
    // 수첩 기록 카드 요소입니다.
    const card = createElement("article", "note-card");
    // 수첩 아이콘 요소입니다.
    const icon = createElement("span", "note-icon", "▤");
    // 수첩 텍스트 묶음입니다.
    const copy = createElement("div", "note-copy");
    const topline = createElement("div", "note-topline");
    topline.append(createElement("span", "note-date", formatDate(note.createdAt)), createElement("span", "category-tag", `${note.earnedXp} XP`));

    const title = createElement("h3", "", note.title);
    const place = createElement("p", "card-place", note.placeName);
    const memo = createElement("p", "card-description", note.memo);
    const badges = createElement("div", "note-badges");

    note.badges.forEach((badge) => {
      badges.append(createElement("span", "", String(badge)));
    });

    copy.append(topline, title, place, memo, badges);
    card.append(icon, copy);
    list.append(card);
  });
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
 * 역할: 전체 화면을 현재 상태 기준으로 다시 그린다.
 * 호출 예시: renderAll()
 */
function renderAll() {
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

  return {
    latitude: measuredLocation.lat,
    longitude: measuredLocation.lng,
    accuracyMeters: Math.round(measuredLocation.accuracyMeters),
    photoAttached: false,
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
    low_gps_accuracy: "GPS 정확도가 낮아 완료하지 않았습니다.",
    place_cache_missing: "장소 좌표를 다시 확인하지 못해 완료하지 않았습니다.",
    outside_radius: "장소 반경 밖으로 판정되어 완료하지 않았습니다.",
    photo_required: "사진 인증이 필요한 퀘스트입니다. 사진 업로드 UI 연결 후 완료할 수 있습니다.",
    store_name_not_matched: "영수증 또는 간판 상호명이 일치하지 않아 완료하지 않았습니다.",
    checklist_incomplete: "체크리스트가 완료되지 않아 퀘스트를 완료하지 않았습니다.",
    already_completed: "이미 완료된 퀘스트입니다.",
    quest_not_found: "퀘스트를 찾을 수 없습니다.",
  };

  if (action === "complete") {
    return completionMessages[reason] || "완료 조건을 충족하지 못해 상태를 변경하지 않았습니다.";
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
    return "완료 요청에 실패해 상태를 변경하지 않았습니다.";
  }

  return "요청에 실패해 상태를 변경하지 않았습니다.";
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
      renderRecommendationMeta();
      loadRecommendations();
    })
    .catch(() => {
      state.location = { ...FALLBACK_LOCATION, label: "위치 권한 거부, 대전광역시청 기준" };
      renderRecommendationMeta();
      loadRecommendations();
    });
}

/**
 * 입력: 강제 새로고침 여부.
 * 출력: 추천 목록 로드 Promise.
 * 역할: 추천 API를 호출하고 실패 시 목업 데이터를 사용한다.
 * 호출 예시: await loadRecommendations(true)
 */
async function loadRecommendations(forceRefresh = false) {
  // 추천 API에 보낼 쿼리 문자열입니다.
  const query = new URLSearchParams({
    lat: String(state.location.lat),
    lng: String(state.location.lng),
    category: state.selectedCategory,
  });
  if (forceRefresh) {
    query.set("refresh", "1");
  }

  try {
    // 추천 API의 JSON 응답입니다.
    const payload = await fetchJson(`/api/recommendations?${query.toString()}`);
    // 정규화한 추천 목록입니다.
    const recommendations = unwrapList(payload).map(normalizeRecommendation);

    if (recommendations.length === 0) {
      throw new Error("추천 결과 없음");
    }

    state.recommendations = recommendations;
    state.dataSource = "api";
  } catch (error) {
    state.recommendations = [...FALLBACK_RECOMMENDATIONS];
    state.dataSource = "fallback";
  }

  renderRecommendationMeta();
  renderHomeMetrics();
  renderHomeRecommendations();
  renderRecommendations();
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

  // 액션에 따라 호출할 API 경로입니다.
  const path = `/api/quests/${encodeURIComponent(instanceId)}/${action}`;

  // 액션 대상 추천 항목입니다.
  const recommendation = state.recommendations.find((item) => item.instanceId === instanceId);

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
      updateSystemStatus(true, getActionFailureMessage(action, actionResult));
      renderAll();
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

    updateSystemStatus(true, action === "complete" ? "완료 처리됨" : "퀘스트 수락됨");
  } catch (error) {
    if (!isUnauthorizedError(error)) {
      // 위치 권한 실패는 API 연결 상태를 바꾸지 않는다.
      const isLocationError =
        error?.name === "GeolocationPositionError" ||
        Number.isInteger(error?.code) ||
        String(error?.message || "").includes("위치");
      state.apiHealthy = isLocationError ? state.apiHealthy : false;
      updateSystemStatus(state.apiHealthy, getRequestFailureMessage(error, action));
    }
  }

  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 사용자 정보 로드 Promise.
 * 역할: /api/me를 호출하고 실패 시 기본 사용자 정보를 유지한다.
 * 호출 예시: await loadUser()
 */
async function loadUser() {
  try {
    // 사용자 API 응답입니다.
    const payload = await fetchJson("/api/me");
    // 사용자 응답이 data로 래핑된 경우의 실제 본문입니다.
    const user = payload.data || payload.user || payload;

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
 * 역할: /api/notes를 호출하고 실패 시 기본 수첩 기록을 사용한다.
 * 호출 예시: await loadNotes()
 */
async function loadNotes() {
  try {
    // 수첩 API 응답입니다.
    const payload = await fetchJson("/api/notes");
    // 정규화한 수첩 기록 목록입니다.
    const notes = unwrapList(payload).map(normalizeNote);

    state.notes = notes.length > 0 ? notes : [...FALLBACK_NOTES];
  } catch (error) {
    state.notes = [...FALLBACK_NOTES];
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
  await Promise.allSettled([loadHealth(), loadUser(), loadBadges(), loadNotes(), loadGgumdori(), loadMapConfig()]);
  await loadRecommendations(forceRefresh);
  renderAll();
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 사용자 입력 이벤트를 등록한다.
 * 호출 예시: bindEvents()
 */
function bindEvents() {
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
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 앱을 시작하고 첫 화면을 fallback 데이터로 즉시 채운 뒤 API를 갱신한다.
 * 호출 예시: initializeApp()
 */
function initializeApp() {
  registerServiceWorker();
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
