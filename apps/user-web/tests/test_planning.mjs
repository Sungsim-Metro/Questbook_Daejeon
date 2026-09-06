// 여행 계획, 관심사 저장, 비동기 응답 격리를 브라우저 외부에서 검증합니다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// 변수 의미: 실제 브라우저 앱 소스이며 자동 시작만 생략합니다.
const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8").replace(/initializeApp\(\);\s*$/, "");

/** 입력: 없음. 출력: 격리 실행 환경. 역할: 실제 앱 함수의 상태 변경을 검증합니다. 호출 예시: const app = createApp(). */
function createApp() {
  // 변수 의미: 화면 출력 없이 앱 동작을 실행하는 컨텍스트입니다.
  const context = vm.createContext({
    URLSearchParams, console, setTimeout, clearTimeout,
    window: { location: { search: "", hash: "", hostname: "localhost" }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => ({ recommendations: [] }) }),
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.accessToken = 'user-a';
    globalThis.actualRenderMapView = renderMapView;
    globalThis.actualRenderPlanningSettings = renderPlanningSettings;
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
