// 여행 계획, 관심사 저장, 비동기 응답 격리를 브라우저 외부에서 검증합니다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// 변수 의미: 실제 브라우저 앱 소스이며 자동 시작만 생략합니다.
const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8").replace(/initializeApp\(\);\s*$/, "");

/** 입력: 없음. 출력: 격리 실행 환경. 역할: 실제 앱 함수의 상태 변경을 검증합니다. 호출 예시: const app = createApp(). */
function createApp() {
  // 변수 의미: 실제 화면 전환 함수가 갱신할 브라우저 주소 상태입니다.
  const location = { search: "", hash: "", hostname: "localhost" };
  // 변수 의미: 화면 출력 없이 앱 동작을 실행하는 컨텍스트입니다.
  const context = vm.createContext({
    URLSearchParams, console, setTimeout, clearTimeout,
    window: {
      location,
      history: { replaceState(_state, _title, url) { location.hash = url; } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    },
    document: { body: { dataset: {}, classList: { toggle() {} } }, querySelector: () => null, querySelectorAll: () => [] },
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => ({ recommendations: [] }) }),
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.accessToken = 'user-a';
    globalThis.actualRenderMapView = renderMapView;
    globalThis.actualRenderPlanningSettings = renderPlanningSettings;
    globalThis.actualRenderAttractions = renderAttractions;
    renderAll = renderRecommendationMeta = renderHomeMetrics = renderHomeRecommendations =
      renderRecommendations = renderQuestBoard = renderMapView = renderPlanningSettings =
      renderAttractions = updateSystemStatus = syncNaverPositionMarker = () => {};
  `, context);
  return { context, run: (code) => vm.runInContext(code, context) };
}

/** 입력: 없음. 출력: 해제 가능한 Promise. 역할: 요청 완료 순서를 제어합니다. 호출 예시: const pending = deferred(). */
function deferred() {
  // 변수 의미: 테스트에서 외부로 노출할 Promise 해제 함수입니다.
  let resolve;
  // 변수 의미: 테스트에서 수동 완료하는 Promise입니다.
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("계획 추천은 GPS 없이 선택 좌표와 모드를 전송한다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  // 변수 의미: 실제 추천 호출 경로입니다.
  let path;
  app.context.fetch = async (url) => { path = url; return { ok: true, json: async () => ({ recommendations: [] }) }; };
  app.run("state.recommendationMode = 'planning'; state.plannedLocation = {lat:36.32,lng:127.42,label:'대전역'};");
  await app.run("loadRecommendations()");
  assert.match(path, /mode=planning/);
  assert.match(path, /lat=36.32/);
  assert.equal(app.run("state.recommendations.length"), 0);
});

test("완료 인증은 실측 GPS만 사용하고 계획 위치를 유지한다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  app.run("state.recommendationMode = 'planning'; state.plannedLocation = {lat:36.32,lng:127.42,label:'대전역'}; readCurrentPosition = async () => ({coords:{latitude:36.35,longitude:127.38,accuracy:8}});");
  // 변수 의미: 실제 완료 인증 요청 본문입니다.
  const result = await app.run("buildCompletionBody({instanceId:'quest-a'})");
  assert.equal(result.latitude, 36.35);
  assert.equal(app.run("getRecommendationLocation().lat"), 36.32);
  assert.equal(app.run("state.location.lat"), 36.35);
});

test("늦게 도착한 이전 추천 응답을 무시한다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  // 변수 의미: 이전 추천 응답의 대기 제어입니다.
  const old = deferred();
  app.context.fetch = () => old.promise;
  // 변수 의미: 먼저 시작한 추천 작업입니다.
  const first = app.run("loadRecommendations()");
  app.context.fetch = async () => ({ ok: true, json: async () => ({ recommendations: [{instanceId:'new',placeName:'새 장소'}] }) });
  await app.run("loadRecommendations()");
  old.resolve({ ok: true, json: async () => ({ recommendations: [{instanceId:'old',placeName:'이전 장소'}] }) });
  await first;
  assert.equal(app.run("state.recommendations[0].instanceId"), "new");
});

test("관심사 저장 실패는 저장된 값과 최초 설정 상태를 바꾸지 않는다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  app.run("state.preference = {categories:['nature'],isConfigured:false}; state.interestDraft = ['science'];");
  app.context.fetch = async () => { throw new Error("offline"); };
  await app.run("savePreferences()");
  assert.equal(app.run("state.preference.categories.join(',')"), "nature");
  assert.equal(app.run("state.preference.isConfigured"), false);
  assert.match(app.run("state.preferenceMessage"), /실패/);
});

test("이전 사용자 응답이 관심사 저장 결과를 덮어쓰지 않는다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  // 변수 의미: 이전 사용자 조회 응답입니다.
  const old = deferred();
  app.context.fetch = () => old.promise;
  // 변수 의미: 관심사 저장보다 먼저 시작한 사용자 조회입니다.
  const userRequest = app.run("loadUser()");
  app.run("state.interestDraft = [];");
  app.context.fetch = async () => ({ ok: true, json: async () => ({preference:{categories:[],isConfigured:true},recommendations:[]}) });
  await app.run("savePreferences()");
  old.resolve({ ok:true,json:async()=>({user:{nickname:'이전 사용자 정보',preference:{categories:['nature'],isConfigured:false}}}) });
  await userRequest;
  assert.equal(app.run("state.preference.categories.length"), 0);
  assert.equal(app.run("state.preference.isConfigured"), true);
});

test("계정 변경 후 도착한 관광지 응답은 표시하지 않는다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  app.run("state.recommendationMode = 'planning';");
  // 변수 의미: 이전 계정의 관광지 요청 응답입니다.
  const old = deferred();
  app.context.fetch = () => old.promise;
  // 변수 의미: 먼저 시작한 관광지 작업입니다.
  const first = app.run("loadAttractions()");
  app.run("state.accessToken = 'user-b'; state.attractions = [];");
  old.resolve({ok:true,json:async()=>({recommendations:[{place:{name:'이전 계정 추천'}}]})});
  await first;
  assert.equal(app.run("state.attractions.length"), 0);
});

test("대전 전체 관광지 요청은 GPS 좌표를 보내지 않는다", async () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  app.run("state.recommendationMode = 'planning';");
  // 변수 의미: 실제 관광지 호출 경로입니다.
  let path;
  app.context.fetch = async (url) => { path = url; return {ok:true,json:async()=>({recommendations:[]})}; };
  await app.run("loadAttractions()");
  assert.match(path, /^\/api\/places\/recommendations\?/);
  assert.doesNotMatch(path, /lat=|lng=/);
  assert.equal(app.run("state.attractions.length"), 0);
});

test("잘못된 좌표를 적용하지 않는다", () => {
  // 변수 의미: 현재 테스트의 앱 실행 환경입니다.
  const app = createApp();
  assert.equal(app.run("setPlanningLocation({lat:NaN,lng:127,label:'잘못된 좌표'})"), false);
  assert.equal(app.run("setPlanningLocation({lat:91,lng:127,label:'범위 초과'})"), false);
});

test("관심사 저장 실패 뒤에도 이미 진행 중이던 추천은 정상 완료된다", async () => {
  // 변수 의미: 앱 환경과 진행 중인 추천 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.fetch = () => pending.promise;
  // 변수 의미: 저장 시도 이전의 관심사로 시작한 추천 조회입니다.
  const request = app.run("loadRecommendations()");
  app.context.fetch = async () => { throw new Error("offline"); };
  await app.run("savePreferences()");
  pending.resolve({ok:true,json:async()=>({recommendations:[{instanceId:'existing',placeName:'기존 관심사 추천'}]})});
  await request;
  assert.equal(app.run("state.recommendationPending"), false);
  assert.equal(app.run("state.recommendations[0].instanceId"), "existing");
});

test("이전 계정 요청의 401은 새 계정 세션을 만료시키지 않는다", async () => {
  // 변수 의미: 앱 환경과 이전 계정 요청의 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.fetch = () => pending.promise;
  // 변수 의미: 사용자 전환 전에 전송한 API 요청입니다.
  const request = app.run("fetchJson('/api/me')");
  app.run("state.accessToken = 'user-b';");
  pending.resolve({ok:false,status:401,clone:()=>({json:async()=>({error:'expired'})})});
  await assert.rejects(request, /401/);
  assert.equal(app.run("state.accessToken"), "user-b");
});

test("빈 지도 결과에 예시 퀘스트 마커를 넣지 않는다", () => {
  // 변수 의미: 앱 환경과 최소 지도 요소입니다.
  const app = createApp();
  const element = {replaceChildren(){},append(){},setAttribute(){},classList:{add(){},remove(){}}};
  app.context.document.querySelector = () => element;
  app.context.document.createElement = () => ({...element});
  app.run("state.recommendations=[]; globalThis.markerCount=-1; renderMockMapView=(_canvas,places)=>{markerCount=places.length}; actualRenderMapView();");
  assert.equal(app.run("markerCount"), 0);
});

test("로그아웃 이전의 같은 토큰 응답도 다음 세션에 반영하지 않는다", async () => {
  // 변수 의미: 앱 환경과 이전 세션의 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.fetch = () => pending.promise;
  // 변수 의미: 로그아웃 전에 시작한 관심사 조회입니다.
  const request = app.run("loadUser()");
  app.run("resetLoggedOutNavigation = renderNotes = () => {}; resetExpiredSession(); state.accessToken='user-a';");
  pending.resolve({ok:true,json:async()=>({user:{preference:{categories:['science'],isConfigured:true}}})});
  await request;
  assert.equal(app.run("state.preference.categories.length"), 0);
});

test("추천 응답 렌더는 작성 중인 계획 좌표를 덮어쓰지 않는다", () => {
  // 변수 의미: 앱 환경과 사용자가 편집하는 좌표 입력입니다.
  const app = createApp();
  const latitude = { value: "" };
  const longitude = { value: "" };
  app.context.document.querySelector = (selector) => ({"#planning-latitude":latitude,"#planning-longitude":longitude})[selector] || null;
  app.run("actualRenderPlanningSettings()");
  latitude.value = "36.50";
  longitude.value = "127.45";
  app.context.document.activeElement = longitude;
  app.run("actualRenderPlanningSettings()");
  assert.equal(latitude.value, "36.50");
  assert.equal(longitude.value, "127.45");
});

test("계획점 선택 이후 도착한 GPS 응답은 모드를 되돌리지 않는다", async () => {
  // 변수 의미: 앱 환경과 사용자 위치 권한 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.pendingPosition = pending.promise;
  app.run("readCurrentPosition=()=>pendingPosition; requestLocation(); setPlanningLocation({lat:36.32,lng:127.42,label:'대전역'});");
  pending.resolve({coords:{latitude:36.35,longitude:127.38,accuracy:8}});
  await pending.promise;
  await Promise.resolve();
  assert.equal(app.run("state.recommendationMode"), "planning");
  assert.equal(app.run("getRecommendationLocation().lat"), 36.32);
});

test("기본 탐험 모드의 초기 조회는 대전 전체 관광지를 요청하지 않는다", async () => {
  // 변수 의미: 기본 모드에서 시작하는 앱 환경과 외부 API 호출 경로입니다.
  const app = createApp();
  const paths = [];
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  await app.run("loadInitialData()");
  assert.equal(app.run("state.recommendationMode"), "nearby");
  assert.equal(app.run("state.activeView"), "home");
  assert.ok(paths.some((path) => path.startsWith("/api/recommendations?") && path.includes("mode=nearby")));
  assert.equal(paths.filter((path) => path.startsWith("/api/places/recommendations?")).length, 0);
});

test("탐험 모드에서는 관광지 조회를 직접 요청해도 API를 호출하지 않는다", async () => {
  // 변수 의미: 앱 환경과 탐험 모드에서 발생한 외부 요청 목록입니다.
  const app = createApp();
  const paths = [];
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  await app.run("loadAttractions(true)");
  assert.deepEqual(paths, []);
  assert.equal(app.run("state.attractionPending"), false);
});

test("탐험 모드의 관심사 저장은 주변 퀘스트만 갱신한다", async () => {
  // 변수 의미: 앱 환경과 저장 후 발생하는 외부 요청 목록입니다.
  const app = createApp();
  const paths = [];
  app.context.fetch = async (url) => {
    paths.push(url);
    return {
      ok: true,
      json: async () => ({ preference: { categories: ["science"], isConfigured: true }, recommendations: [] }),
    };
  };
  app.run("state.interestDraft = ['science'];");
  await app.run("savePreferences()");
  assert.equal(app.run("state.preference.categories.join(',')"), "science");
  assert.ok(paths.includes("/api/me/preferences"));
  assert.ok(paths.some((path) => path.startsWith("/api/recommendations?") && path.includes("mode=nearby")));
  assert.equal(paths.filter((path) => path.startsWith("/api/places/recommendations?")).length, 0);
});

test("모드 전환은 전용 화면으로 이동하고 복귀 시 실측 위치를 유지한다", () => {
  // 변수 의미: 실측 위치와 여행 기준점이 서로 다른 앱 환경입니다.
  const app = createApp();
  app.run("state.location = {lat:36.35,lng:127.38,label:'현재 위치'}; state.plannedLocation = {lat:36.32,lng:127.42,label:'대전역'}; setActiveView('map'); setRecommendationMode('planning');");
  assert.equal(app.run("state.activeView"), "planning");
  assert.equal(app.context.window.location.hash, "#view-planning");
  assert.equal(app.run("getRecommendationLocation().lat"), 36.32);
  app.run("setRecommendationMode('nearby');");
  assert.equal(app.run("state.activeView"), "home");
  assert.equal(app.context.window.location.hash, "#view-home");
  assert.equal(app.run("getRecommendationLocation().lat"), 36.35);
  assert.equal(app.run("getRecommendationLocation().lng"), 127.38);
  assert.equal(app.run("state.plannedLocation.lat"), 36.32);
});

test("홈과 계획 화면 직접 이동은 현재 모드에 맞게 정규화한다", () => {
  // 변수 의미: 실제 화면 전환 로직을 호출하는 앱 환경입니다.
  const app = createApp();
  app.run("setActiveView('map'); setActiveView('planning');");
  assert.equal(app.run("state.activeView"), "home");
  app.run("state.recommendationMode = 'planning'; setActiveView('home');");
  assert.equal(app.run("state.activeView"), "planning");
  assert.equal(app.context.document.body.dataset.activeView, "planning");
  assert.equal(app.context.window.location.hash, "#view-planning");
});

test("탐험 모드로 돌아온 뒤 도착한 관광지 응답은 반영하지 않는다", async () => {
  // 변수 의미: 앱 환경과 계획 모드에서 시작한 관광지 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.run("state.recommendationMode = 'planning';");
  app.context.fetch = (url) => url.startsWith("/api/places/recommendations?")
    ? pending.promise
    : Promise.resolve({ ok: true, json: async () => ({ recommendations: [] }) });
  // 변수 의미: 탐험 모드로 복귀하기 전에 시작한 요청입니다.
  const request = app.run("loadAttractions()");
  app.run("setRecommendationMode('nearby');");
  // 변수 의미: 이전 요청 응답을 기다리지 않고 해제해야 하는 관광지 대기 상태입니다.
  const pendingAfterSwitch = app.run("state.attractionPending");
  pending.resolve({ ok: true, json: async () => ({ recommendations: [{ place: { name: "이전 계획 관광지" } }] }) });
  await request;
  assert.equal(pendingAfterSwitch, false);
  assert.equal(app.run("state.attractions.length"), 0);
  assert.equal(app.run("state.attractionPending"), false);
  assert.equal(app.run("state.recommendationMode"), "nearby");
});

test("탐험 모드로 돌아오면 주소 검색 대기를 해제하고 지연 결과를 무시한다", async () => {
  // 변수 의미: 앱 환경과 계획 모드에서 시작한 주소 검색 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.run("state.recommendationMode = 'planning';");
  app.context.document.querySelector = (selector) => selector === "#planning-address" ? { value: "대전역" } : null;
  app.context.fetch = (url) => url.startsWith("/api/naver-map/geocode?")
    ? pending.promise
    : Promise.resolve({ ok: true, json: async () => ({ recommendations: [] }) });
  // 변수 의미: 모드 전환보다 먼저 시작한 주소 검색 작업입니다.
  const request = app.run("searchPlanningAddress()");
  app.run("setRecommendationMode('nearby');");
  // 변수 의미: 서버가 아직 응답하지 않았을 때의 검색 대기 상태입니다.
  const pendingAfterSwitch = app.run("state.addressPending");
  pending.resolve({ ok: true, json: async () => ({ addresses: [{ x: "127.42", y: "36.32", roadAddress: "대전역" }] }) });
  await request;
  assert.equal(pendingAfterSwitch, false);
  assert.equal(app.run("state.addressResults.length"), 0);
  assert.equal(app.run("state.addressPending"), false);
});

test("메뉴에서 계획 모드로 전환한 뒤 도착한 GPS는 화면과 기준점을 되돌리지 않는다", async () => {
  // 변수 의미: 앱 환경과 모드 전환 전 요청한 기기 위치 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.pendingPosition = pending.promise;
  app.run("state.location = {lat:36.35,lng:127.38,label:'기존 실측 위치'}; state.plannedLocation = {lat:36.32,lng:127.42,label:'대전역'}; readCurrentPosition=()=>pendingPosition; requestLocation(); setRecommendationMode('planning');");
  pending.resolve({ coords: { latitude: 36.4, longitude: 127.5, accuracy: 8 } });
  await pending.promise;
  await Promise.resolve();
  assert.equal(app.run("state.recommendationMode"), "planning");
  assert.equal(app.run("state.activeView"), "planning");
  assert.equal(app.run("getRecommendationLocation().lat"), 36.32);
  assert.equal(app.run("state.location.lat"), 36.35);
});

test("관심사 여행지 탭은 계획 모드에서 GPS 없이 관광지를 요청한다", async () => {
  // 변수 의미: 앱 환경과 관심사 탭 진입 시 발생한 외부 요청 목록입니다.
  const app = createApp();
  const paths = [];
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("state.recommendationMode = 'planning';");
  await app.run("selectPlanningTab('preferences')");
  assert.equal(app.run("state.planningTab"), "preferences");
  // 변수 의미: 관심사 여행지 조회에 사용한 실제 요청 경로입니다.
  const cityPath = paths.find((path) => path.startsWith("/api/places/recommendations?"));
  assert.ok(cityPath);
  assert.doesNotMatch(cityPath, /lat=|lng=/);
  app.run("selectPlanningTab('location');");
  assert.equal(app.run("state.planningTab"), "location");
});

test("새 세션의 관광지 주제 선택은 이전 계정의 필터 표시를 초기화한다", () => {
  // 변수 의미: 이전 계정에서 과학을 선택한 앱 환경과 관광지 주제 입력입니다.
  const app = createApp();
  const categorySelect = { value: "science" };
  app.context.document.querySelector = (selector) => selector === "#attraction-category" ? categorySelect : null;
  app.run("state.attractionCategory='science'; resetExpiredSession(); state.accessToken='user-b'; state.recommendationMode='planning'; actualRenderPlanningSettings();");
  assert.equal(categorySelect.value, "preferred");
});

test("선호 관광지 카드는 해당 장소 좌표와 카테고리로 계획 퀘스트를 조회한다", async () => {
  // 변수 의미: 실제 카드 렌더링과 클릭 이벤트를 실행할 앱 환경입니다.
  const app = createApp();
  /** 입력: 태그 이름. 출력: 최소 DOM 요소. 역할: 생성된 카드와 실제 클릭 이벤트를 기록합니다. 호출 예시: createNode('button'). */
  function createNode(tag) {
    return {
      tag, children: [], textContent: "", events: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
      addEventListener(type, handler) { this.events[type] = handler; },
    };
  }
  // 변수 의미: 화면에 표시된 관광지 카드 목록과 외부 API 요청입니다.
  const list = createNode("div");
  const paths = [];
  app.context.document.createElement = createNode;
  app.context.document.querySelector = (selector) => selector === "#attraction-list" ? list : null;
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("state.recommendationMode='planning'; state.preference={categories:['science'],isConfigured:true}; state.attractions=[{place:{title:'과학 장소',categoryCode:'science',latitude:36.32,longitude:127.42}},{place:{title:'자연 장소',categoryCode:'nature',latitude:36.3,longitude:127.4}}]; actualRenderAttractions();");
  assert.equal(list.children.length, 1);
  // 변수 의미: 선호 카테고리에 맞는 관광지 카드에서 생성한 실제 퀘스트 이동 버튼입니다.
  const button = list.children[0].children.find((child) => child.tag === "button");
  assert.equal(button.disabled, false);
  await button.events.click();
  assert.equal(paths[0], "/api/recommendations?lat=36.32&lng=127.42&category=science&mode=planning");
  assert.equal(app.run("state.activeView"), "quests");
  assert.equal(app.run("state.planningTab"), "location");
});

test("탐험과 계획의 퀘스트 카테고리는 모드 복귀 후 각각 유지된다", () => {
  // 변수 의미: 두 모드에서 서로 다른 퀘스트 필터를 선택할 앱 환경입니다.
  const app = createApp();
  // 변수 의미: 모드 복귀 직후 실제 추천 조회에 사용된 조건입니다.
  const paths = [];
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("setCategory('nature'); setRecommendationMode('planning'); setCategory('science'); setRecommendationMode('nearby');");
  assert.match(paths.at(-1), /category=nature&mode=nearby/);
  assert.equal(app.run("state.selectedCategory"), "nature");
  app.run("setRecommendationMode('planning');");
  assert.match(paths.at(-1), /category=science&mode=planning/);
  assert.equal(app.run("state.selectedCategory"), "science");
});
