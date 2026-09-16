// main UI와 기존 백엔드의 계획, 계정, 수첩, 보상 계약을 검증합니다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// 변수 의미: ESM import와 자동 시작을 제외한 실제 앱 소스입니다.
const source = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
  .replace(/^import .*?;\s*$/m, "")
  .replace(/initializeApp\(\);\s*$/, "");

/**
 * 입력: 없음.
 * 출력: 테스트에서 제어할 최소 DOM 요소.
 * 역할: 실제 앱 함수의 DOM 부수 효과를 브라우저 없이 받아냅니다.
 * 호출 예시: const node = createNode();
 */
function createNode() {
  return {
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    children: [],
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    addEventListener() {},
    focus() {},
  };
}

/**
 * 입력: 없음.
 * 출력: 실제 app.js가 실행된 격리 컨텍스트.
 * 역할: 네트워크와 DOM만 경계에서 제어하고 상태 로직은 실제 코드를 실행합니다.
 * 호출 예시: const app = createApp();
 */
function createApp() {
  // 변수 의미: 테스트에서 조회할 선택자별 DOM 요소입니다.
  const elements = new Map();
  // 변수 의미: 앱이 읽고 갱신할 브라우저 주소입니다.
  const location = { search: "", hash: "", hostname: "localhost", pathname: "/" };
  // 변수 의미: app.js를 실행할 브라우저 대체 컨텍스트입니다.
  const context = vm.createContext({
    URL,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout,
    createRewardFx: () => createNode(),
    playRewardFlash() {},
    history: { replaceState() {}, pushState() {}, back() {} },
    window: {
      location,
      history: { replaceState() {}, pushState() {}, back() {} },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {},
    },
    document: {
      body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
      activeElement: null,
      querySelector: (selector) => elements.get(selector) || null,
      querySelectorAll: () => [],
      createElement: () => createNode(),
    },
    navigator: {},
    fetch: async () => ({ ok: true, json: async () => ({ recommendations: [] }) }),
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.accessToken = "user-a";
    var actualRenderMapView = renderMapView;
    renderAll = renderRecommendationMeta = renderHomeMetrics = renderHomeRecommendations =
      renderRecommendations = renderAdventure = renderQuestBoard = renderMapView = renderHomeContext =
      renderPlanSheet = renderNotes = renderCatalog = renderCatalogSheet = renderAccountPanel =
      renderActionDialog = renderGgumdori = renderProfile = renderWeather = updateSystemStatus =
      syncNaverPositionMarker = () => {};
    loadWeather = async () => {};
  `, context);
  return {
    context,
    element(selector) {
      // 변수 의미: 요청한 선택자의 기존 또는 새 DOM 요소입니다.
      const element = elements.get(selector) || createNode();
      elements.set(selector, element);
      return element;
    },
    run: (code) => vm.runInContext(code, context),
  };
}

/**
 * 입력: 없음.
 * 출력: 외부에서 완료 순서를 제어할 Promise.
 * 역할: 먼저 시작한 요청을 나중에 끝내는 경쟁 상황을 만듭니다.
 * 호출 예시: const pending = deferred();
 */
function deferred() {
  // 변수 의미: Promise를 완료할 외부 함수입니다.
  let resolve;
  // 변수 의미: 테스트가 완료 시점을 제어하는 Promise입니다.
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("계획 추천은 별도 위치와 planning 모드를 사용하고 정상 빈 결과를 유지한다", async () => {
  // 변수 의미: 실제 추천 호출 경로를 기록할 앱입니다.
  const app = createApp();
  // 변수 의미: fetch에 전달된 마지막 URL입니다.
  let path = "";
  app.context.fetch = async (url) => {
    path = url;
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("state.location={lat:36.35,lng:127.38,label:'현재 위치'}; state.plannedLocation={lat:36.32,lng:127.42,label:'대전역'}; state.explorationMode='planned';");
  await app.run("loadRecommendations()");
  assert.match(path, /lat=36.32/);
  assert.match(path, /mode=planning/);
  assert.equal(app.run("state.recommendations.length"), 0);
  assert.equal(app.run("state.dataSource"), "api");
  assert.equal(app.run("state.location.lat"), 36.35);
});

test("기존 카테고리는 서버 코드로 역변환하고 미지원 카테고리는 요청하지 않는다", async () => {
  // 변수 의미: 실제 API 요청 목록입니다.
  const paths = [];
  // 변수 의미: 카테고리 전환을 실행할 앱입니다.
  const app = createApp();
  app.context.fetch = async (url) => {
    paths.push(url);
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("state.selectedCategory='heritage'");
  await app.run("loadRecommendations()");
  assert.match(paths.at(-1), /category=downtown/);
  app.run("setCategory('bread')");
  assert.equal(paths.length, 1);
  assert.equal(app.run("state.selectedCategory"), "heritage");
});

test("계획 위치 검색은 기존 NAVER geocode의 x y 응답을 좌표로 사용한다", async () => {
  // 변수 의미: 실제 geocode 호출 경로입니다.
  let path = "";
  // 변수 의미: 계획 검색을 실행할 앱입니다.
  const app = createApp();
  app.context.fetch = async (url) => {
    path = url;
    return { ok: true, json: async () => ({ addresses: [{ x: "127.42", y: "36.32", roadAddress: "대전역" }] }) };
  };
  await app.run("searchPlanLocation('대전역')");
  assert.match(path, /^\/api\/naver-map\/geocode\?/);
  assert.equal(app.run("state.planSearchResults[0].lat"), 36.32);
  assert.equal(app.run("state.planSearchResults[0].lng"), 127.42);
});

test("관심사 저장과 대전 전체 관광지 조회는 기존 API 계약을 사용한다", async () => {
  // 변수 의미: 호출된 API와 본문을 기록할 목록입니다.
  const calls = [];
  // 변수 의미: 관심사 기능을 실행할 앱입니다.
  const app = createApp();
  app.context.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/me/preferences") {
      return { ok: true, json: async () => ({ preference: { categories: ["science"], isConfigured: true } }) };
    }
    return { ok: true, json: async () => ({ recommendations: [] }) };
  };
  app.run("state.interestDraft=['science']");
  await app.run("savePreferences()");
  await app.run("loadAttractions()");
  assert.equal(calls[0].url, "/api/me/preferences");
  assert.deepEqual(JSON.parse(calls[0].options.body), { categories: ["science"] });
  assert.match(calls.at(-1).url, /^\/api\/places\/recommendations\?/);
  assert.doesNotMatch(calls.at(-1).url, /lat=|lng=/);
});

test("늦게 도착한 이전 추천과 사용자 응답은 최신 상태를 덮지 않는다", async () => {
  // 변수 의미: 먼저 시작한 추천과 사용자 응답입니다.
  const oldRecommendation = deferred();
  const oldUser = deferred();
  // 변수 의미: 요청 경쟁을 실행할 앱입니다.
  const app = createApp();
  app.context.fetch = (url) => url.startsWith("/api/recommendations") ? oldRecommendation.promise : oldUser.promise;
  // 변수 의미: 이전 상태에서 시작한 비동기 요청입니다.
  const recommendationRequest = app.run("loadRecommendations()");
  const userRequest = app.run("loadUser()");
  app.run("state.explorationMode='planned'; state.plannedLocation={lat:36.32,lng:127.42,label:'대전역'}; state.accessToken='user-b'; state.user={...state.user,nickname:'새 사용자'};");
  oldRecommendation.resolve({ ok: true, json: async () => ({ recommendations: [{ instanceId: "old" }] }) });
  oldUser.resolve({ ok: true, json: async () => ({ user: { nickname: "이전 사용자" } }) });
  await Promise.all([recommendationRequest, userRequest]);
  assert.notEqual(app.run("state.recommendations[0]?.instanceId"), "old");
  assert.equal(app.run("state.user.nickname"), "새 사용자");
});

test("모험 기록 수정은 평면 수첩 PATCH 계약을 보낸다", async () => {
  // 변수 의미: 실제 PATCH 옵션입니다.
  let requestOptions;
  // 변수 의미: 기록 저장을 실행할 앱입니다.
  const app = createApp();
  app.context.fetch = async (_url, options) => {
    requestOptions = options;
    return { ok: true, json: async () => ({ note: {} }) };
  };
  app.run("state.notes=[{id:'note-1',entry:{type:'review',title:'제목',body:'이전',rating:4}}]");
  await app.run("saveRecordEntry(state.notes[0], '새 기록')");
  assert.deepEqual(JSON.parse(requestOptions.body), {
    entryType: "review",
    title: "제목",
    body: "새 기록",
    rating: 4,
  });
});

test("도감은 서버 꿈돌이의 실제 해금 상태와 식별자만 사용한다", () => {
  // 변수 의미: 서버 도감 변환을 실행할 앱입니다.
  const app = createApp();
  app.run(`state.ggumdori=[
    {id:'ggumdori_default_1',name:'기본 꿈돌이',themeCategory:'default',unlocked:true,imageRef:'/default.svg'},
    {id:'ggumdori_science_2',name:'플라스크 꿈돌이',themeCategory:'science',unlocked:false,imageRef:'/science.svg'}
  ]; state.badges=[]; state.catalog=buildServerCatalog();`);
  assert.equal(app.run("state.catalog.entries.length"), 2);
  assert.equal(app.run("state.catalog.entries[0].ggumdoriId"), "ggumdori_default_1");
  assert.equal(app.run("state.catalog.entries[0].state"), "earned");
  assert.equal(app.run("state.catalog.entries[1].state"), "locked");
});

test("완료 연출은 서버가 이번에 지급한 보상만 표시한다", () => {
  // 변수 의미: 완료 결과를 대화상자로 변환할 앱입니다.
  const app = createApp();
  app.run("showQuestActionDialog('complete',{instanceId:'q',questTitle:'퀘스트',placeName:'장소'},{ok:true,completion:{earnedXp:50,badges:{earnedBadges:[]},unlockedGgumdori:[]}})");
  assert.equal(app.run("state.actionDialog.reward"), null);
  app.run("showQuestActionDialog('complete',{instanceId:'q',questTitle:'퀘스트',placeName:'장소'},{ok:true,completion:{earnedXp:50,badges:{earnedBadges:[{name:'과학 탐험가',categoryCode:'science',tier:1}]},unlockedGgumdori:[{id:'ggumdori_science_1',name:'안경 꿈돌이',image_ref:'/science.svg'}]}})");
  assert.equal(app.run("state.actionDialog.reward.name"), "과학 탐험가");
  assert.equal(app.run("state.actionDialog.reward.ggumdoriId"), "ggumdori_science_1");
});

test("계정 변경 뒤 늦게 온 뱃지 수첩 꿈돌이 응답을 모두 무시한다", async () => {
  const app = createApp();
  const badgeResponse = deferred();
  const noteResponse = deferred();
  const ggumdoriResponse = deferred();
  app.context.fetch = (url) => {
    if (url === "/api/badges") return badgeResponse.promise;
    if (url === "/api/notes") return noteResponse.promise;
    return ggumdoriResponse.promise;
  };
  const requests = [app.run("loadBadges()"), app.run("loadNotes()"), app.run("loadGgumdori()")];
  app.run("state.accessToken='user-b'; state.sessionVersion+=1; state.badges=[{name:'B'}]; state.notes=[{id:'B'}]; state.ggumdori=[{id:'B'}]");
  badgeResponse.resolve({ ok: true, json: async () => ({ badges: [{ name: "A" }] }) });
  noteResponse.resolve({ ok: true, json: async () => ({ notes: [{ id: "A" }] }) });
  ggumdoriResponse.resolve({ ok: true, json: async () => ({ variants: [{ id: "A" }] }) });
  await Promise.all(requests);
  assert.equal(app.run("state.badges[0].name"), "B");
  assert.equal(app.run("state.notes[0].id"), "B");
  assert.equal(app.run("state.ggumdori[0].id"), "B");
});

test("도감은 꿈돌이와 같은 카테고리 단계의 뱃지만 연결한다", () => {
  const app = createApp();
  app.run(`state.ggumdori=[{id:'ggumdori_science_1',name:'안경 꿈돌이',themeCategory:'science',tier:1,unlocked:true,imageRef:'/one.svg'}];
    state.badges=[{name:'과학 입문',category:'science',tier:1,earned:true},{name:'과학 정복',category:'science',tier:3,earned:false}];
    state.catalog=buildServerCatalog();`);
  assert.equal(app.run("state.catalog.entries[0].badgeName"), "과학 입문");
});

test("대표 꿈돌이는 서버 저장 실패 시 기존 선택을 유지한다", async () => {
  const app = createApp();
  app.context.fetch = async () => {
    throw new Error("offline");
  };
  app.run("state.selectedGgumdoriId='ggumdori_default_1'");
  await app.run("setFeaturedGgumdori({state:'earned',ggumdoriId:'ggumdori_science_1'})");
  assert.equal(app.run("state.selectedGgumdoriId"), "ggumdori_default_1");
  assert.match(app.run("state.catalogMessage"), /저장하지 못/);
});

test("OAuth provider 설정을 조회해 미설정 로그인 버튼을 잠근다", async () => {
  // 변수 의미: 로그인 버튼 두 개를 가진 앱입니다.
  const app = createApp();
  const naver = app.element("#naver-login-button");
  const google = app.element("#google-login-button");
  app.context.fetch = async () => ({
    ok: true,
    json: async () => ({ providers: [{ id: "naver", configured: false }, { id: "google", configured: true }] }),
  });
  await app.run("loadAuthProviders()");
  assert.equal(naver.disabled, true);
  assert.equal(google.disabled, false);
});

test("닉네임 저장 실패는 기존 이름과 입력 단계를 유지한다", async () => {
  // 변수 의미: 저장 실패를 주입할 실제 앱입니다.
  const app = createApp();
  app.context.fetch = async () => { throw new Error("offline"); };
  app.run("state.user={nickname:'기존 이름'}; state.nicknameDraft='새 이름'; state.accountStep='nickname'");
  assert.equal(await app.run("saveNickname('새 이름')"), false);
  assert.equal(app.run("state.user.nickname"), "기존 이름");
  await app.run("confirmNickname()");
  assert.equal(app.run("state.accountStep"), "nickname");
  assert.equal(app.run("state.user.nickname"), "기존 이름");
});

test("기록 저장 실패와 이전 계정의 응답은 현재 기록을 바꾸지 않는다", async () => {
  // 변수 의미: 저장 작업을 실행할 앱과 지연 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.run("state.notes=[{id:'note-1',entry:{type:'diary',body:'원본'}}]");
  app.context.fetch = async () => { throw new Error("offline"); };
  await app.run("saveRecordEntry(state.notes[0], '실패한 변경')");
  assert.equal(app.run("state.notes[0].entry.body"), "원본");
  app.context.fetch = () => pending.promise;
  // 변수 의미: 계정 전환 이전에 시작된 저장입니다.
  const saving = app.run("saveRecordEntry(state.notes[0], 'A의 변경')");
  app.run("state.accessToken='user-b'; state.sessionVersion+=1; state.notes=[{id:'B'}]; state.recordMessage='B의 화면'");
  pending.resolve({ ok: true, json: async () => ({ note: { id: "note-1", entry: { body: "A의 변경" } } }) });
  await saving;
  assert.equal(app.run("state.notes[0].id"), "B");
  assert.equal(app.run("state.recordMessage"), "B의 화면");
});

test("사진 URL 발급 중 계정이 바뀌면 업로드와 OCR을 시작하지 않는다", async () => {
  // 변수 의미: 업로드 경계를 제어할 앱과 지연 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.fetch = () => pending.promise;
  app.run("var uploads=0; uploadEvidenceFile=async()=>{uploads+=1;}; state.evidenceUploads={}");
  // 변수 의미: 이전 계정에서 시작된 사진 처리입니다.
  const uploading = app.run("handleQuestEvidenceUpload({instanceId:'q',verificationType:'photo'}, {name:'test.jpg',type:'image/jpeg',size:12})");
  app.run("state.accessToken='user-b'; state.sessionVersion+=1; state.evidenceUploads={}");
  pending.resolve({ ok: true, json: async () => ({ url: "/upload", objectKey: "A/photo", maxUploadBytes: 100 }) });
  await uploading;
  assert.equal(app.run("uploads"), 0);
  assert.equal(app.run("Object.keys(state.evidenceUploads).length"), 0);
});

test("이전 세션의 401은 다시 로그인한 같은 토큰의 세션도 만료시키지 않는다", async () => {
  // 변수 의미: 인증 오류의 도착 시점을 제어할 앱과 응답입니다.
  const app = createApp();
  const pending = deferred();
  app.context.fetch = () => pending.promise;
  // 변수 의미: 재로그인 전에 시작한 API 요청입니다.
  const request = app.run("fetchJson('/api/me')");
  app.run("state.sessionVersion+=1");
  pending.resolve({ ok: false, status: 401, clone: () => ({ json: async () => ({}) }) });
  await assert.rejects(request);
  assert.equal(app.run("state.accessToken"), "user-a");
});

test("초기 로드 도중 계정이 바뀌면 후속 추천 조회를 시작하지 않는다", async () => {
  // 변수 의미: 초기 조회를 멈출 Promise와 실제 앱입니다.
  const app = createApp();
  const pending = deferred();
  app.context.initialPending = pending.promise;
  app.run("loadHealth=()=>initialPending; loadUser=loadBadges=loadNotes=loadGgumdori=loadMapConfig=loadAuthProviders=async()=>{}; var recommendationLoads=0; loadRecommendations=async()=>{recommendationLoads+=1;}");
  // 변수 의미: 이전 계정의 초기 로드입니다.
  const loading = app.run("loadInitialData()");
  app.run("state.accessToken='user-b'; state.sessionVersion+=1");
  pending.resolve();
  await loading;
  assert.equal(app.run("recommendationLoads"), 0);
});

test("모드를 왕복해도 현위치와 카테고리 선택은 복원된다", async () => {
  // 변수 의미: 모드 전환 후 네트워크만 생략한 앱입니다.
  const app = createApp();
  app.run("loadRecommendations=async()=>{}; state.location={lat:36.35,lng:127.38}; state.selectedCategory='market'; state.explorationMode='current'");
  app.run("setExplorationMode('planned'); state.selectedCategory='science'; state.plannedLocation={lat:36.37,lng:127.37}; setExplorationMode('current')");
  assert.equal(app.run("state.selectedCategory"), "market");
  assert.equal(app.run("state.location.lat"), 36.35);
  app.run("setExplorationMode('planned')");
  assert.equal(app.run("state.selectedCategory"), "science");
  assert.equal(app.run("state.plannedLocation.lat"), 36.37);
});

test("GPS 대기 중 계정이 바뀌면 완료 요청과 위치 변경을 하지 않는다", async () => {
  // 변수 의미: GPS 응답을 지연시킬 앱과 Promise입니다.
  const app = createApp();
  const pending = deferred();
  app.context.gpsPending = pending.promise;
  app.run("readCurrentPosition=()=>gpsPending; state.location={lat:36.35,lng:127.38}");
  // 변수 의미: 실제 완료 본문 생성 경로입니다.
  const completion = app.run("buildCompletionBody({instanceId:'q'})");
  app.run("state.accessToken='user-b'; state.sessionVersion+=1");
  pending.resolve({ coords: { latitude: 37.5, longitude: 127.0, accuracy: 5 } });
  await assert.rejects(completion, /session changed/);
  assert.equal(app.run("state.location.lat"), 36.35);
});

test("실제 등록된 Escape 처리기는 열린 드로어를 닫는다", () => {
  // 변수 의미: 실제 이벤트 바인딩에서 등록한 콜백 목록과 앱입니다.
  const app = createApp();
  const listeners = {};
  app.context.window.addEventListener = (type, callback) => { listeners[type] = callback; };
  app.context.document.addEventListener = () => {};
  app.run("var drawerClosed=false; isDrawerOpen=()=>true; closeDrawer=()=>{drawerClosed=true;}; bindEvents()");
  listeners.keydown({ key: "Escape" });
  assert.equal(app.run("drawerClosed"), true);
});

test("관광지 조회는 중첩된 실제 장소명과 계획 좌표를 보존한다", async () => {
  // 변수 의미: 기존 API의 관광지 응답을 제공할 앱입니다.
  const app = createApp();
  app.context.fetch = async () => ({ ok: true, json: async () => ({ recommendations: [{
    place: { title: "국립중앙과학관", categoryCode: "science", latitude: 36.37, longitude: 127.37 },
  }] }) });
  await app.run("loadAttractions()");
  assert.equal(app.run("state.attractions[0].placeName"), "국립중앙과학관");
  assert.equal(app.run("state.attractions[0].lat"), 36.37);
  assert.equal(app.run("state.attractions[0].category"), "science");
});

test("정상 빈 추천은 지도 마커와 선택 장소에도 예시 퀘스트를 만들지 않는다", () => {
  // 변수 의미: 실제 지도 렌더러의 DOM 경계를 제공할 앱입니다.
  const app = createApp();
  app.element("#quest-map");
  const detail = app.element("#map-detail");
  const list = app.element("#map-place-list");
  app.run("state.recommendations=[]; var markerCount=-1; renderMockMapView=(_canvas,places)=>{markerCount=places.length;}; actualRenderMapView()");
  assert.equal(app.run("markerCount"), 0);
  assert.equal(app.run("state.selectedMapInstanceId"), "");
  assert.equal(list.children.length, 0);
  assert.match(detail.children[0].textContent, /추천 퀘스트가 없습니다/);
});
