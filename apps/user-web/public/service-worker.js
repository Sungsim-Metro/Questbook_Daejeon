// 사용자 모바일 웹/PWA의 정적 자산과 추천 API 응답 캐시를 관리하는 서비스워커입니다.

// 정적 자산 캐시 이름입니다.
const STATIC_CACHE_NAME = "questbook-user-web-static-v3";

// 추천 API 런타임 캐시 이름입니다.
const RECOMMENDATION_CACHE_NAME = "questbook-user-web-recommendations-v1";

// 설치 시 미리 저장할 정적 자산 경로입니다.
const STATIC_ASSETS = [
  "./index.html",
  "./manifest.webmanifest",
  "./service-worker.js",
  "../src/app.js",
  "../src/styles.css",
  "./assets/ggumdori/science-1.svg",
  "./assets/ggumdori/science-2.svg",
  "./assets/ggumdori/market-2.svg",
  "./assets/ggumdori/nature-2.svg",
  "./assets/ggumdori/mobility-1.svg",
  "./assets/ggumdori/nightview-2.svg",
];

/**
 * 입력: 서비스워커 install 이벤트.
 * 출력: 없음.
 * 역할: 정적 자산을 미리 캐시에 저장한다.
 * 호출 예시: 브라우저가 서비스워커를 설치할 때 자동 호출한다.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

/**
 * 입력: 서비스워커 activate 이벤트.
 * 출력: 없음.
 * 역할: 현재 버전이 아닌 캐시를 정리하고 즉시 클라이언트를 제어한다.
 * 호출 예시: 새 서비스워커가 활성화될 때 자동 호출한다.
 */
self.addEventListener("activate", (event) => {
  // 현재 서비스워커가 유지할 캐시 이름 목록입니다.
  const allowedCacheNames = [STATIC_CACHE_NAME, RECOMMENDATION_CACHE_NAME];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !allowedCacheNames.includes(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * 입력: Fetch API 요청 객체.
 * 출력: 추천 API 요청 여부.
 * 역할: 마지막 추천 결과를 런타임 캐시에 둘 요청인지 판정한다.
 * 호출 예시: isRecommendationRequest(event.request)
 */
function isRecommendationRequest(request) {
  // 요청 URL을 분석하기 위한 URL 객체입니다.
  const requestUrl = new URL(request.url);

  return request.method === "GET" && requestUrl.pathname === "/api/recommendations";
}

/**
 * 입력: Fetch API 요청 객체.
 * 출력: Response Promise.
 * 역할: 추천 API는 네트워크 우선으로 호출하고 실패 시 마지막 캐시를 반환한다.
 * 호출 예시: event.respondWith(handleRecommendationRequest(event.request))
 */
async function handleRecommendationRequest(request) {
  // 추천 API 응답을 저장할 런타임 캐시입니다.
  const cache = await caches.open(RECOMMENDATION_CACHE_NAME);

  try {
    // 앱 서버에서 받은 최신 추천 응답입니다.
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // 네트워크 실패 시 사용할 마지막 추천 응답입니다.
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

/**
 * 입력: Fetch API 요청 객체.
 * 출력: Response Promise.
 * 역할: 정적 자산은 캐시 우선으로 응답하고 없으면 네트워크를 사용한다.
 * 호출 예시: event.respondWith(handleStaticRequest(event.request))
 */
async function handleStaticRequest(request) {
  // 정적 자산 캐시에서 찾은 응답입니다.
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  return fetch(request);
}

/**
 * 입력: 서비스워커 fetch 이벤트.
 * 출력: 없음.
 * 역할: 추천 API와 정적 자산 요청에 적절한 캐시 전략을 적용한다.
 * 호출 예시: 브라우저가 네트워크 요청을 보낼 때 자동 호출한다.
 */
self.addEventListener("fetch", (event) => {
  if (isRecommendationRequest(event.request)) {
    event.respondWith(handleRecommendationRequest(event.request));
    return;
  }

  if (event.request.method === "GET") {
    event.respondWith(handleStaticRequest(event.request));
  }
});
