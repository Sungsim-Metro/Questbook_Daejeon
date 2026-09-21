// 사용자 모바일 웹/PWA의 캐시를 관리하는 서비스워커입니다. (명세 §14.2)
//
// 원칙
//   - 앱 셸·핵심 CSS/JS·기본 꿈돌이·필수 아이콘만 precache 한다.
//   - 공개된 꿈돌이·뱃지는 별도 runtime cache 로 지연 로드하고, 고정 배열에 나열하지 않는다.
//   - runtime cache 는 용량 상한과 오래된 항목 제거 정책을 둔다.
//   - 토큰·인증 응답·OAuth callback·비공개 사진·presigned URL 은 Cache Storage 에 넣지 않는다.
//   - 릴리스 버전 하나로 캐시 이름과 정적 자산 버전을 원자적으로 올린다.

// 이 릴리스의 버전입니다. 아래 캐시 이름과 자산 주소가 모두 이 값을 씁니다.
const RELEASE_VERSION = "20260921-merged-69";

// 앱 셸 캐시입니다.
const STATIC_CACHE_NAME = `questbook-static-${RELEASE_VERSION}`;

// 도감 이미지처럼 나중에 늘어나는 자산의 캐시입니다.
const RUNTIME_CACHE_NAME = `questbook-runtime-${RELEASE_VERSION}`;

// runtime cache 에 둘 최대 항목 수입니다. 넘으면 오래된 것부터 지웁니다. (명세 §14.2)
const RUNTIME_CACHE_LIMIT = 80;

// 설치 시 미리 저장할 앱 셸입니다. 도감 이미지는 여기 넣지 않습니다. (명세 §14.2)
const STATIC_ASSETS = [
  "./index.html",
  "./manifest.webmanifest",
  `../src/app.js?v=${RELEASE_VERSION}`,
  `../src/styles.css?v=${RELEASE_VERSION}`,
  `../src/stitch-theme.css?v=${RELEASE_VERSION}`,
  `../src/reward-fx.css?v=${RELEASE_VERSION}`,
  `../src/scroll-fab.js?v=${RELEASE_VERSION}`,
  // app.js 가 그냥 import 하므로 요청 주소에 ?v= 가 붙지 않습니다. 쿼리 없이 담습니다.
  "../src/reward-fx.js",
  // 완료 연출이 300ms 에 바로 쓰는 스프라이트입니다. 첫 완료에서 늦으면 안 됩니다.
  "./assets/fx/dumdori_cheer_96x96_4f.png",
  // TAP-TO-START 시작 화면은 앱을 열 때마다 가장 먼저 보이므로 미리 담아 둡니다.
  // 배경음악 mp3는 preload="none"이라 재생 시점에만 받으면 되므로 여기 넣지 않습니다.
  "./assets/splash/start-screen.png",
];

/**
 * 입력: 캐시 이름과 자산 경로 목록.
 * 출력: 저장 Promise.
 * 역할: 하나가 404 여도 설치 전체를 실패시키지 않고 개별로 담는다. (명세 §14.2)
 *       cache.addAll 은 원자적이라 지운 레거시 자산 하나가 남으면 PWA 가 통째로 죽는다.
 * 호출 예시: await cacheEachSafely(cache, STATIC_ASSETS)
 */
async function cacheEachSafely(cache, assets) {
  // 담지 못한 자산들입니다. 설치는 계속 진행합니다.
  const failed = [];

  await Promise.all(
    assets.map(async (asset) => {
      try {
        await cache.add(asset);
      } catch (error) {
        failed.push(asset);
      }
    }),
  );

  if (failed.length > 0) {
    console.warn("[sw] precache 실패(설치는 계속):", failed);
  }
}

/**
 * 입력: 없음.
 * 출력: 정리 Promise.
 * 역할: runtime cache 가 상한을 넘으면 오래된 항목부터 지운다. (명세 §14.2)
 * 호출 예시: await trimRuntimeCache()
 */
async function trimRuntimeCache() {
  // 지연 로드 자산 캐시입니다.
  const cache = await caches.open(RUNTIME_CACHE_NAME);
  // 저장 순서대로 나열된 요청 목록입니다. 앞쪽이 오래된 항목입니다.
  const keys = await cache.keys();

  if (keys.length <= RUNTIME_CACHE_LIMIT) {
    return;
  }

  await Promise.all(keys.slice(0, keys.length - RUNTIME_CACHE_LIMIT).map((key) => cache.delete(key)));
}

/**
 * 입력: 요청 URL 객체.
 * 출력: 캐시에 담아도 되는지 여부.
 * 역할: 토큰·인증 응답·비공개 사진·presigned URL 을 Cache Storage 에서 배제한다. (명세 §14.2)
 * 호출 예시: if (!isCacheable(url)) return;
 */
function isCacheable(url) {
  // 다른 출처는 담지 않습니다. presigned URL 과 외부 SDK 가 여기 걸립니다.
  if (url.origin !== self.location.origin) {
    return false;
  }
  // API 응답은 캐시 대상 정적 경로와 분명히 분리합니다.
  if (url.pathname.startsWith("/api/")) {
    return false;
  }
  // OAuth callback 과 인증 경로입니다.
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/oauth/")) {
    return false;
  }
  // 서명이 붙은 주소는 만료되므로 담지 않습니다.
  if (url.searchParams.has("X-Amz-Signature") || url.searchParams.has("signature") || url.searchParams.has("token")) {
    return false;
  }
  // 비공개 인증 사진입니다.
  if (url.pathname.startsWith("/evidence/") || url.pathname.startsWith("/private/")) {
    return false;
  }

  return true;
}

/**
 * 입력: 요청 URL 객체.
 * 출력: 지연 로드 자산인지 여부.
 * 역할: 도감 꿈돌이와 뱃지를 별도 runtime cache 로 보낸다. 고정 배열에 나열하지 않는다. (명세 §14.2)
 * 호출 예시: if (isRuntimeAsset(url)) { ... }
 */
function isRuntimeAsset(url) {
  return url.pathname.includes("/assets/ggumdori/") || url.pathname.includes("/assets/badge/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cacheEachSafely(cache, STATIC_ASSETS)),
  );
  // 대기 중인 새 서비스워커는 사용자가 안내를 받고 수락할 때 활성화합니다. (명세 §14.1)
});

self.addEventListener("activate", (event) => {
  // 이번 릴리스가 유지할 캐시 이름입니다.
  const allowed = [STATIC_CACHE_NAME, RUNTIME_CACHE_NAME];

  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !allowed.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/**
 * 입력: 요청 객체.
 * 출력: Response Promise.
 * 역할: 도감 이미지를 캐시 우선으로 돌려주고 없을 때만 받아 온다. 대표 꿈돌이의 오프라인 재사용을 보장한다. (명세 §14.2, §5.4)
 * 호출 예시: event.respondWith(handleRuntimeAsset(request))
 */
async function handleRuntimeAsset(request) {
  // 이미 받아 둔 이미지입니다.
  const cached = await caches.match(request, { cacheName: RUNTIME_CACHE_NAME });

  if (cached) {
    return cached;
  }

  // 처음 보는 이미지입니다. 받아서 담아 둡니다.
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE_NAME);
    await cache.put(request, response.clone());
    await trimRuntimeCache();
  }
  return response;
}

/**
 * 입력: 요청 객체.
 * 출력: Response Promise.
 * 역할: 앱 셸은 네트워크를 우선하고 실패하면 캐시로 돌려준다.
 * 호출 예시: event.respondWith(handleShellRequest(request))
 */
async function handleShellRequest(request) {
  try {
    // 네트워크 응답입니다.
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // 오프라인입니다. 담아 둔 것으로 대신합니다.
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    if (request.mode === "navigate") {
      const shell = await caches.match("./index.html");
      if (shell) {
        return shell;
      }
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  // 요청 주소입니다.
  const url = new URL(event.request.url);

  if (!isCacheable(url)) {
    return;
  }

  event.respondWith(isRuntimeAsset(url) ? handleRuntimeAsset(event.request) : handleShellRequest(event.request));
});

// 사용자가 새 버전 안내를 수락하면 대기 중인 워커를 즉시 올립니다. (명세 §14.1)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
