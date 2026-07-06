/* Questbook Daejeon의 NAVER Dynamic Map 연동과 목업 지도 대체 렌더링을 제공한다. */
(function attachQuestbookMap(window, document) {
  'use strict';

  // 변수 의미: 공유 목업 데이터 네임스페이스다.
  const data = window.QuestbookMockData;
  // 변수 의미: 공유 UI 헬퍼 모음이다.
  const ui = window.QuestbookUi;
  // 변수 의미: 같은 출처의 Dynamic Map 설정 엔드포인트다.
  const CONFIG_ENDPOINT = '/api/naver-map/config';
  // 변수 의미: 같은 출처의 Geocoding 프록시 엔드포인트다.
  const GEOCODE_ENDPOINT = '/api/naver-map/geocode';
  // 변수 의미: 같은 출처의 Reverse Geocoding 프록시 엔드포인트다.
  const REVERSE_GEOCODE_ENDPOINT = '/api/naver-map/reverse-geocode';
  // 변수 의미: NAVER Maps JavaScript SDK URL이다.
  const NAVER_MAPS_SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js';
  // 변수 의미: Dynamic Map 기본 줌 레벨이다.
  const DEFAULT_ZOOM = 14;
  // 변수 의미: 사용자가 위치를 선택하거나 검색한 뒤 사용할 줌 레벨이다.
  const FOCUSED_ZOOM = 16;
  // 변수 의미: 브라우저 위치 확인 제한 시간이며 단위는 밀리초다.
  const GEOLOCATION_TIMEOUT_MS = 5000;

  // 변수 의미: 변경 가능한 지도 런타임 상태다.
  const state = {
    activeLocation: null,
    config: null,
    isDynamicMapActive: false,
    map: null,
    placeMarkers: [],
    positionMarker: null,
    sdkPromise: null,
    selectedPlaceId: '',
  };

  /**
   * 입력: 없음.
   * 출력: 지도 페이지 요소를 담은 객체.
   * 역할: 지도 페이지에서 사용하는 DOM 조회를 한곳에 모은다.
   * 호출 예시: const elements = getElements();
   */
  function getElements() {
    return {
      addressForm: document.querySelector('[data-map-search-form]'),
      addressInput: document.querySelector('[data-map-address-input]'),
      coordinateButton: document.querySelector('[data-map-coordinate-button]'),
      currentLocationButton: document.querySelector('[data-map-current-location]'),
      latitudeInput: document.querySelector('[data-map-lat-input]'),
      longitudeInput: document.querySelector('[data-map-lng-input]'),
      mapCanvas: document.querySelector('[data-quest-map]'),
      positionStatus: document.querySelector('[data-map-position-status]'),
      providerStatus: document.querySelector('[data-map-provider-status]'),
    };
  }

  /**
   * 입력: 없음.
   * 출력: 불리언 값.
   * 역할: 페이지에서 NAVER Maps SDK를 사용할 수 있는지 확인한다.
   * 호출 예시: if (hasNaverMaps()) renderNaverQuestMap(container, placeId, location);
   */
  function hasNaverMaps() {
    return Boolean(window.naver && window.naver.maps);
  }

  /**
   * 입력: 텍스트 라벨과 시각적 상태 이름.
   * 출력: 없음.
   * 역할: 지도 제공자 상태 배지를 갱신한다.
   * 호출 예시: updateProviderStatus('Naver Dynamic Map', 'ready');
   */
  function updateProviderStatus(text, statusName) {
    // 변수 의미: 지도 제공자 상태 배지 요소다.
    const providerStatus = getElements().providerStatus;
    if (!providerStatus) return;

    providerStatus.textContent = text;
    providerStatus.classList.remove('is-ready', 'is-warning', 'is-error');
    if (statusName) providerStatus.classList.add(`is-${statusName}`);
  }

  /**
   * 입력: 상태 메시지 문자열.
   * 출력: 없음.
   * 역할: 읽기 쉬운 현재 좌표와 주소 상태를 갱신한다.
   * 호출 예시: updatePositionStatus('대전역 · 36.33264, 127.43472');
   */
  function updatePositionStatus(text) {
    // 변수 의미: 위치 상태 표시 요소다.
    const positionStatus = getElements().positionStatus;
    if (positionStatus) positionStatus.textContent = text;
  }

  /**
   * 입력: 배지 ID 문자열.
   * 출력: 안전한 대체값을 포함한 배지 객체.
   * 역할: 공유 배지 데이터셋에서 지도 마커용 배지 시각 요소를 찾는다.
   * 호출 예시: const badge = resolveBadge(place.badgeId);
   */
  function resolveBadge(badgeId) {
    return ui.findBadgeById(badgeId) || { icon: '✦', color: '#0a8f48', name: '더미 배지' };
  }

  /**
   * 입력: 장소 ID 문자열.
   * 출력: 퀘스트 객체 또는 undefined.
   * 역할: 지도 장소에 연결된 대표 퀘스트를 찾는다.
   * 호출 예시: const quest = findQuestByPlaceId(place.id);
   */
  function findQuestByPlaceId(placeId) {
    return data.quests.find((quest) => quest.placeId === placeId);
  }

  /**
   * 입력: 위도, 경도, 이름, 출처 문자열.
   * 출력: 정규화된 위치 객체.
   * 역할: 브라우저 GPS, 검색, 좌표 입력, 장소 선택의 위치 상태를 일관되게 유지한다.
   * 호출 예시: const location = normalizeLocation(36.327, 127.427, '대전 중앙로', 'mock');
   */
  function normalizeLocation(latitude, longitude, name, source) {
    return {
      latitude,
      longitude,
      name: name || '선택 위치',
      source: source || 'manual',
    };
  }

  /**
   * 입력: 없음.
   * 출력: 대체 위치 객체.
   * 역할: 브라우저 GPS를 사용할 수 없을 때 기존 대전 목업 위치를 사용한다.
   * 호출 예시: const location = getFallbackLocation();
   */
  function getFallbackLocation() {
    return normalizeLocation(
      data.currentLocation.latitude,
      data.currentLocation.longitude,
      data.currentLocation.name,
      data.currentLocation.source || 'mock',
    );
  }

  /**
   * 입력: 위치 객체.
   * 출력: 화면 표시용 좌표 문자열.
   * 역할: 상태 텍스트에 사용할 위도와 경도를 포맷한다.
   * 호출 예시: const label = formatCoordinate(location);
   */
  function formatCoordinate(location) {
    return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  }

  /**
   * 입력: 위치 객체.
   * 출력: 없음.
   * 역할: 위도와 경도 입력 값을 활성 위치와 동기화한다.
   * 호출 예시: setCoordinateInputs(location);
   */
  function setCoordinateInputs(location) {
    // 변수 의미: 지도 페이지 요소 모음이다.
    const elements = getElements();
    if (elements.latitudeInput) elements.latitudeInput.value = location.latitude.toFixed(6);
    if (elements.longitudeInput) elements.longitudeInput.value = location.longitude.toFixed(6);
  }

  /**
   * 입력: 원본 좌표 값과 검증용 메타데이터.
   * 출력: 검증된 숫자 값.
   * 역할: 지도를 이동하기 전에 좌표 텍스트 필드를 파싱한다.
   * 호출 예시: const lat = parseCoordinateInput('36.327', '위도', -90, 90);
   */
  function parseCoordinateInput(rawValue, label, minimum, maximum) {
    // 변수 의미: 앞뒤 공백을 제거한 좌표 문자열이다.
    const normalizedValue = String(rawValue || '').trim();
    // 변수 의미: 파싱된 숫자 좌표다.
    const parsedValue = Number(normalizedValue);
    if (!normalizedValue || !Number.isFinite(parsedValue)) {
      throw new Error(`${label} 값을 숫자로 입력하세요.`);
    }
    if (parsedValue < minimum || parsedValue > maximum) {
      throw new Error(`${label} 값의 범위를 확인하세요.`);
    }
    return parsedValue;
  }

  /**
   * 입력: 없음.
   * 출력: 좌표 입력 값으로 만든 위치 객체.
   * 역할: 수동 지도 이동에 사용할 사용자 입력 좌표를 읽는다.
   * 호출 예시: const location = readCoordinateInputs();
   */
  function readCoordinateInputs() {
    // 변수 의미: 지도 페이지 요소 모음이다.
    const elements = getElements();
    // 변수 의미: 검증된 위도 입력 값이다.
    const latitude = parseCoordinateInput(elements.latitudeInput ? elements.latitudeInput.value : '', '위도', -90, 90);
    // 변수 의미: 검증된 경도 입력 값이다.
    const longitude = parseCoordinateInput(elements.longitudeInput ? elements.longitudeInput.value : '', '경도', -180, 180);
    return normalizeLocation(latitude, longitude, '좌표 선택 위치', 'coordinate');
  }

  /**
   * 입력: JSON 엔드포인트와 URLSearchParams 객체.
   * 출력: 파싱된 JSON 페이로드.
   * 역할: 같은 출처 JSON을 가져오고 HTTP 실패를 사용자에게 안전한 오류로 바꾼다.
   * 호출 예시: const payload = await requestJson(GEOCODE_ENDPOINT, params);
   */
  async function requestJson(endpoint, params) {
    // 변수 의미: 직렬화된 쿼리 문자열이다.
    const queryString = params && params.toString() ? `?${params.toString()}` : '';
    // 변수 의미: JSON HTTP 응답 객체다.
    const response = await fetch(`${endpoint}${queryString}`, { headers: { Accept: 'application/json' } });
    // 변수 의미: 서버가 JSON을 반환할 때의 파싱된 페이로드다.
    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }

    if (!response.ok) {
      // 변수 의미: 사용자에게 보여줄 수 있는 가장 유용한 오류 메시지다.
      const message = payload.error || `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  }

  /**
   * 입력: 없음.
   * 출력: NAVER 지도 설정 페이로드.
   * 역할: API Key 비밀 값은 서버에 두고 공개 가능한 Dynamic Map Key ID만 불러온다.
   * 호출 예시: const config = await loadNaverConfig();
   */
  async function loadNaverConfig() {
    // 변수 의미: 가져온 지도 설정 값이다.
    const config = await requestJson(CONFIG_ENDPOINT);
    state.config = config;
    return config;
  }

  /**
   * 입력: 없음.
   * 출력: 불리언 값.
   * 역할: Geocoding 및 Reverse Geocoding 프록시 라우트가 NAVER를 호출할 수 있는지 확인한다.
   * 호출 예시: if (hasRestProxy()) await reverseGeocodeLocation(location);
   */
  function hasRestProxy() {
    return Boolean(state.config && state.config.restApiConfigured);
  }

  /**
   * 입력: NAVER Maps API Key ID.
   * 출력: SDK 로딩이 끝나면 resolve되는 Promise.
   * 역할: 공식 NAVER Maps JavaScript SDK 스크립트를 동적으로 삽입한다.
   * 호출 예시: await loadNaverMapsSdk(config.keyId);
   */
  function loadNaverMapsSdk(keyId) {
    if (hasNaverMaps()) return Promise.resolve();
    if (state.sdkPromise) return state.sdkPromise;

    state.sdkPromise = new Promise((resolve, reject) => {
      // 변수 의미: SDK 스크립트 요소다.
      const script = document.createElement('script');
      script.src = `${NAVER_MAPS_SDK_URL}?ncpKeyId=${encodeURIComponent(keyId)}&submodules=geocoder`;
      script.async = true;
      script.dataset.naverMapsSdk = 'true';
      script.onload = () => {
        if (hasNaverMaps()) {
          resolve();
          return;
        }
        reject(new Error('NAVER Maps SDK loaded without the maps namespace.'));
      };
      script.onerror = () => {
        state.sdkPromise = null;
        reject(new Error('NAVER Maps SDK loading failed.'));
      };
      document.head.appendChild(script);
    });
    return state.sdkPromise;
  }

  /**
   * 입력: 없음.
   * 출력: 브라우저 위치로 resolve되는 Promise.
   * 역할: 제한 시간 안에서 브라우저 geolocation API를 읽는다.
   * 호출 예시: const location = await getBrowserLocation();
   */
  function getBrowserLocation() {
    return new Promise((resolve, reject) => {
      if (!window.navigator.geolocation) {
        reject(new Error('Geolocation is unavailable.'));
        return;
      }

      window.navigator.geolocation.getCurrentPosition(
        (position) => {
          // 변수 의미: 브라우저가 제공한 좌표다.
          const coords = position.coords;
          resolve(normalizeLocation(coords.latitude, coords.longitude, '현재 위치', 'browser'));
        },
        (error) => reject(error),
        { enableHighAccuracy: true, maximumAge: 60000, timeout: GEOLOCATION_TIMEOUT_MS },
      );
    });
  }

  /**
   * 입력: 없음.
   * 출력: 초기 지도 위치로 resolve되는 Promise.
   * 역할: 브라우저 GPS를 우선 사용하고 실패하면 대전 목업 위치로 대체한다.
   * 호출 예시: const initialLocation = await resolveInitialLocation();
   */
  async function resolveInitialLocation() {
    updatePositionStatus('현재 위치를 확인하고 있습니다.');
    try {
      return await getBrowserLocation();
    } catch (error) {
      // 변수 의미: 대체로 사용할 대전 위치다.
      const fallbackLocation = getFallbackLocation();
      updatePositionStatus(`현재 위치 권한 없음 · ${fallbackLocation.name} · ${formatCoordinate(fallbackLocation)}`);
      return fallbackLocation;
    }
  }

  /**
   * 입력: 지도 컨테이너 요소.
   * 출력: 없음.
   * 역할: 목업 지도 대체 화면에 장식용 도로와 권역을 그린다.
   * 호출 예시: renderMockMapBase(canvas);
   */
  function renderMockMapBase(container) {
    container.insertAdjacentHTML('beforeend', `
      <div class="map-river" style="left:-38px;bottom:54px;transform:rotate(-9deg)"></div>
      <div class="map-road" style="top:0;bottom:0;left:55%;width:8px"></div>
      <div class="map-road" style="top:43%;left:0;right:0;height:8px"></div>
      <div class="map-road" style="top:64%;left:18%;width:62%;height:8px;transform:rotate(-24deg)"></div>
      <div class="map-park" style="top:9%;left:7%;width:37%;height:25%"></div>
      <div class="map-label" style="top:13%;left:11%">한밭수목원 권역</div>
      <div class="my-location-dot" style="top:48%;left:52%" aria-label="현재 위치"></div>
      <div class="map-legend"><div>내 위치</div><div>퀘스트 · 추천 관광지</div></div>
    `);
  }

  /**
   * 입력: 장소 객체와 선택된 장소 ID.
   * 출력: 목업 지도 마커 버튼 HTML 문자열.
   * 역할: 목업 지도에서 클릭 가능한 배지 형태 마커를 만든다.
   * 호출 예시: const marker = renderMockMarker(place, selectedPlaceId);
   */
  function renderMockMarker(place, selectedPlaceId) {
    // 변수 의미: 장소에 연결된 배지다.
    const badge = resolveBadge(place.badgeId);
    // 변수 의미: 이 마커가 선택됐는지 여부다.
    const isSelected = place.id === selectedPlaceId;
    return `
      <button class="map-marker${isSelected ? ' is-selected' : ''}" type="button" data-map-place-id="${ui.escapeHtml(place.id)}" style="left:${place.x}%;top:${place.y}%">
        <span class="map-badge" style="color:${ui.escapeHtml(badge.color)}">${ui.escapeHtml(badge.icon)}</span>
        <span class="map-marker-label">${ui.escapeHtml(place.name)}</span>
      </button>
    `;
  }

  /**
   * 입력: 지도 컨테이너 요소와 선택된 장소 ID.
   * 출력: 없음.
   * 역할: 정적 목업 지도와 마커 버튼을 렌더링한다.
   * 호출 예시: renderMockQuestMap(container, 'hanbat-arboretum');
   */
  function renderMockQuestMap(container, selectedPlaceId) {
    state.isDynamicMapActive = false;
    state.map = null;
    state.placeMarkers = [];
    state.positionMarker = null;
    container.classList.remove('is-naver');
    container.classList.add('is-mock');
    container.innerHTML = '';
    renderMockMapBase(container);
    container.insertAdjacentHTML('beforeend', data.questPlaces.map((place) => renderMockMarker(place, selectedPlaceId)).join(''));
  }

  /**
   * 입력: 장소 객체와 선택된 장소 ID.
   * 출력: NAVER Maps 마커 아이콘 객체.
   * 역할: 퀘스트 장소용 HTML 마커 아이콘을 만든다.
   * 호출 예시: const icon = buildPlaceMarkerIcon(place, selectedPlaceId);
   */
  function buildPlaceMarkerIcon(place, selectedPlaceId) {
    // 변수 의미: 장소에 연결된 배지다.
    const badge = resolveBadge(place.badgeId);
    // 변수 의미: 선택된 마커에 붙일 클래스 접미사다.
    const selectedClass = place.id === selectedPlaceId ? ' is-selected' : '';
    // 변수 의미: NAVER Maps가 렌더링할 마커 HTML 내용이다.
    const content = `
      <button class="naver-marker${selectedClass}" type="button" data-map-place-id="${ui.escapeHtml(place.id)}" aria-label="${ui.escapeHtml(place.name)}">
        <span class="map-badge" style="color:${ui.escapeHtml(badge.color)}">${ui.escapeHtml(badge.icon)}</span>
        <span class="naver-marker-label">${ui.escapeHtml(place.name)}</span>
      </button>
    `;
    return {
      content,
      anchor: new window.naver.maps.Point(24, 58),
    };
  }

  /**
   * 입력: 위치 객체.
   * 출력: NAVER Maps 마커 아이콘 객체.
   * 역할: 현재 또는 선택 위치용 HTML 마커 아이콘을 만든다.
   * 호출 예시: const icon = buildPositionMarkerIcon(location);
   */
  function buildPositionMarkerIcon(location) {
    // 변수 의미: 위치 출처에 따른 간단한 마커 라벨이다.
    const label = location.source === 'browser' ? '내 위치' : '선택 위치';
    // 변수 의미: NAVER Maps가 렌더링할 마커 HTML 내용이다.
    const content = `
      <div class="naver-position-marker" aria-label="${ui.escapeHtml(label)}">
        <span></span>
      </div>
    `;
    return {
      content,
      anchor: new window.naver.maps.Point(13, 13),
    };
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 선택된 장소가 반영되도록 NAVER 마커 아이콘을 갱신한다.
   * 호출 예시: updateNaverMarkerSelection();
   */
  function updateNaverMarkerSelection() {
    state.placeMarkers.forEach((entry) => {
      entry.marker.setIcon(buildPlaceMarkerIcon(entry.place, state.selectedPlaceId));
    });
  }

  /**
   * 입력: 위치 객체.
   * 출력: 없음.
   * 역할: Dynamic Map에서 활성 위치 마커를 만들거나 이동한다.
   * 호출 예시: syncPositionMarker(location);
   */
  function syncPositionMarker(location) {
    if (!state.map || !hasNaverMaps()) return;

    // 변수 의미: 활성 위치에 해당하는 NAVER 좌표 객체다.
    const position = new window.naver.maps.LatLng(location.latitude, location.longitude);
    if (state.positionMarker) {
      state.positionMarker.setPosition(position);
      state.positionMarker.setIcon(buildPositionMarkerIcon(location));
      return;
    }

    state.positionMarker = new window.naver.maps.Marker({
      map: state.map,
      position,
      icon: buildPositionMarkerIcon(location),
      zIndex: 100,
    });
  }

  /**
   * 입력: 위치 객체, 줌 레벨, Reverse Geocoding 실행 여부.
   * 출력: 선택적 Reverse Geocoding까지 끝난 뒤 resolve되는 Promise.
   * 역할: Dynamic Map을 이동하고 화면에 보이는 좌표 상태를 동기화한다.
   * 호출 예시: await moveToLocation(location, FOCUSED_ZOOM, true);
   */
  async function moveToLocation(location, zoom, shouldReverseGeocode) {
    state.activeLocation = location;
    setCoordinateInputs(location);
    updatePositionStatus(`${location.name} · ${formatCoordinate(location)}`);

    if (state.map && hasNaverMaps()) {
      // 변수 의미: 대상 위치에 해당하는 NAVER 좌표 객체다.
      const position = new window.naver.maps.LatLng(location.latitude, location.longitude);
      state.map.setCenter(position);
      if (zoom) state.map.setZoom(zoom);
      syncPositionMarker(location);
    }

    if (shouldReverseGeocode) {
      await reverseGeocodeLocation(location);
    }
  }

  /**
   * 입력: NAVER Reverse Geocoding 결과 객체.
   * 출력: 읽기 쉬운 주소 문자열.
   * 역할: NAVER Reverse Geocoding의 지역 및 지번 필드를 간단한 텍스트로 변환한다.
   * 호출 예시: const address = buildAddressFromReverseResult(result);
   */
  function buildAddressFromReverseResult(result) {
    if (!result) return '';

    // 변수 의미: NAVER Reverse Geocoding에서 받은 지역 메타데이터다.
    const region = result.region || {};
    // 변수 의미: NAVER Reverse Geocoding에서 받은 지번 또는 도로명 메타데이터다.
    const land = result.land || {};
    // 변수 의미: 읽기 쉬운 지역명 목록이다.
    const regionNames = ['area1', 'area2', 'area3', 'area4']
      .map((key) => (region[key] ? region[key].name : ''))
      .filter(Boolean);
    // 변수 의미: 도로명 또는 지번 번호 접미사다.
    const numberSuffix = [land.number1, land.number2].filter(Boolean).join('-');
    // 변수 의미: 도로명 또는 지번 이름 접미사다.
    const landSuffix = [land.name, numberSuffix].filter(Boolean).join(' ');
    return [...regionNames, landSuffix].filter(Boolean).join(' ');
  }

  /**
   * 입력: NAVER Reverse Geocoding 페이로드.
   * 출력: 읽기 쉬운 주소 문자열.
   * 역할: 도로명 주소 결과를 우선 사용하고 없으면 첫 번째 결과로 대체한다.
   * 호출 예시: const address = formatReverseAddress(payload);
   */
  function formatReverseAddress(payload) {
    // 변수 의미: Reverse Geocoding 결과 행 목록이다.
    const results = Array.isArray(payload.results) ? payload.results : [];
    // 변수 의미: 우선 사용할 도로명 주소 결과다.
    const roadResult = results.find((result) => result.name === 'roadaddr');
    return buildAddressFromReverseResult(roadResult || results[0]);
  }

  /**
   * 입력: 위치 객체.
   * 출력: 주소 상태 갱신 뒤 resolve되는 Promise.
   * 역할: 서버 프록시를 통해 활성 좌표를 읽기 쉬운 주소로 변환한다.
   * 호출 예시: await reverseGeocodeLocation(location);
   */
  async function reverseGeocodeLocation(location) {
    if (!hasRestProxy()) {
      updatePositionStatus(`${location.name} · ${formatCoordinate(location)}`);
      return;
    }

    // 변수 의미: Reverse Geocoding용 쿼리 파라미터다.
    const params = new URLSearchParams({
      lat: String(location.latitude),
      lng: String(location.longitude),
      orders: 'roadaddr,addr,admcode,legalcode',
    });
    updatePositionStatus(`주소 확인 중 · ${formatCoordinate(location)}`);

    try {
      // 변수 의미: Reverse Geocoding 응답 페이로드다.
      const payload = await requestJson(REVERSE_GEOCODE_ENDPOINT, params);
      // 변수 의미: 포맷된 Reverse Geocoding 주소다.
      const address = formatReverseAddress(payload);
      // 변수 의미: 갱신된 활성 위치다.
      const updatedLocation = normalizeLocation(location.latitude, location.longitude, address || location.name, location.source);
      state.activeLocation = updatedLocation;
      updatePositionStatus(`${updatedLocation.name} · ${formatCoordinate(updatedLocation)}`);
    } catch (error) {
      updatePositionStatus(`주소 확인 실패 · ${formatCoordinate(location)}`);
    }
  }

  /**
   * 입력: 지도 컨테이너, 선택된 장소 ID, 초기 위치.
   * 출력: 없음.
   * 역할: NAVER Dynamic Map, 퀘스트 마커, 활성 위치 마커를 렌더링한다.
   * 호출 예시: renderNaverQuestMap(container, 'hanbat-arboretum', initialLocation);
   */
  function renderNaverQuestMap(container, selectedPlaceId, initialLocation) {
    // 변수 의미: 초기 지도 중심에 해당하는 NAVER 좌표 객체다.
    const center = new window.naver.maps.LatLng(initialLocation.latitude, initialLocation.longitude);
    state.selectedPlaceId = selectedPlaceId;
    state.isDynamicMapActive = true;
    container.classList.remove('is-mock');
    container.classList.add('is-naver');
    container.innerHTML = '';

    state.map = new window.naver.maps.Map(container, {
      center,
      zoom: DEFAULT_ZOOM,
      minZoom: 7,
      scaleControl: true,
      mapDataControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: window.naver.maps.Position.TOP_RIGHT,
      },
    });

    state.placeMarkers = data.questPlaces.map((place) => {
      // 변수 의미: 퀘스트 장소 마커 좌표다.
      const position = new window.naver.maps.LatLng(place.latitude, place.longitude);
      // 변수 의미: 현재 퀘스트 장소의 NAVER 마커다.
      const marker = new window.naver.maps.Marker({
        map: state.map,
        position,
        icon: buildPlaceMarkerIcon(place, selectedPlaceId),
      });
      window.naver.maps.Event.addListener(marker, 'click', () => selectPlace(place.id));
      return { marker, place };
    });

    syncPositionMarker(initialLocation);
    showPlaceDetail(selectedPlaceId);
    renderPlaceList(selectedPlaceId);
  }

  /**
   * 입력: 장소 ID 문자열.
   * 출력: 없음.
   * 역할: 선택된 지도 장소 정보 패널을 렌더링한다.
   * 호출 예시: showPlaceDetail('hanbat-arboretum');
   */
  function showPlaceDetail(placeId) {
    // 변수 의미: 상세 정보 패널 요소다.
    const detailElement = document.querySelector('[data-map-detail]');
    if (!detailElement) return;

    // 변수 의미: 선택된 장소 또는 첫 번째 대체 장소다.
    const place = data.questPlaces.find((item) => item.id === placeId) || data.questPlaces[0];
    // 변수 의미: 선택된 장소의 배지다.
    const badge = resolveBadge(place.badgeId);
    // 변수 의미: 선택된 장소의 퀘스트다.
    const quest = findQuestByPlaceId(place.id);
    // 변수 의미: 선택된 퀘스트 제목이다.
    const questTitle = quest ? quest.title : '연결된 퀘스트 준비 중';
    // 변수 의미: 선택된 퀘스트 보상 문구다.
    const rewardText = quest ? `+${quest.xp} XP · ${quest.verification}` : '추천 관광지 데이터';
    // 변수 의미: 선택된 장소의 좌표 문자열이다.
    const coordinateText = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;

    detailElement.innerHTML = `
      <article class="soft-panel map-detail-card">
        <div class="map-detail-head">
          <span class="map-badge" style="color:${ui.escapeHtml(badge.color)}">${ui.escapeHtml(badge.icon)}</span>
          <div class="map-detail-copy">
            <div class="map-detail-title">${ui.escapeHtml(place.name)}</div>
            <div class="map-detail-sub">${ui.escapeHtml(place.category)} · ${place.recommended ? '추천 관광지' : '퀘스트 후보'}</div>
          </div>
        </div>
        <div class="card-title">${ui.escapeHtml(questTitle)}</div>
        <div class="card-sub">${ui.escapeHtml(place.summary)}</div>
        <div class="map-detail-meta">
          <span class="type-chip">${ui.escapeHtml(rewardText)}</span>
          <span class="state-chip">${ui.escapeHtml(coordinateText)}</span>
        </div>
      </article>
    `;
  }

  /**
   * 입력: 선택된 장소 ID 문자열.
   * 출력: 없음.
   * 역할: 지도 없이도 마커를 선택할 수 있는 장소 목록을 렌더링한다.
   * 호출 예시: renderPlaceList('science-museum');
   */
  function renderPlaceList(selectedPlaceId) {
    // 변수 의미: 목록 컨테이너 요소다.
    const listElement = document.querySelector('[data-map-place-list]');
    if (!listElement) return;

    listElement.innerHTML = data.questPlaces.map((place) => {
      // 변수 의미: 장소에 연결된 배지다.
      const badge = resolveBadge(place.badgeId);
      // 변수 의미: 목록 항목이 선택됐는지 여부다.
      const isSelected = place.id === selectedPlaceId;
      return `
        <button class="map-place-button${isSelected ? ' is-selected' : ''}" type="button" data-map-place-id="${ui.escapeHtml(place.id)}">
          <span class="map-badge" style="color:${ui.escapeHtml(badge.color)}">${ui.escapeHtml(badge.icon)}</span>
          <span class="card-copy">
            <span class="card-title">${ui.escapeHtml(place.name)}</span>
            <span class="card-sub">${ui.escapeHtml(place.category)} · ${place.recommended ? '추천' : '일반'}</span>
          </span>
        </button>
      `;
    }).join('');
  }

  /**
   * 입력: 선택된 장소 ID 문자열.
   * 출력: 없음.
   * 역할: 지도, 상세 패널, 목록, Dynamic Map 중심에서 선택 장소를 동기화한다.
   * 호출 예시: selectPlace('sungsimdang');
   */
  function selectPlace(placeId) {
    // 변수 의미: 선택된 퀘스트 장소다.
    const place = data.questPlaces.find((item) => item.id === placeId) || data.questPlaces[0];
    // 변수 의미: 선택된 장소의 위치 객체다.
    const location = normalizeLocation(place.latitude, place.longitude, place.name, 'place');
    // 변수 의미: 정적 지도 캔버스 요소다.
    const mapCanvas = document.querySelector('[data-quest-map]');

    state.selectedPlaceId = place.id;
    showPlaceDetail(place.id);
    renderPlaceList(place.id);

    if (state.isDynamicMapActive && state.map) {
      updateNaverMarkerSelection();
      moveToLocation(location, FOCUSED_ZOOM, false);
      return;
    }

    if (mapCanvas) renderMockQuestMap(mapCanvas, place.id);
    setCoordinateInputs(location);
    updatePositionStatus(`${location.name} · ${formatCoordinate(location)}`);
  }

  /**
   * 입력: 클릭 이벤트 객체.
   * 출력: 없음.
   * 역할: 마커와 장소 목록 클릭을 처리한다.
   * 호출 예시: document.addEventListener('click', handleMapClick);
   */
  function handleMapClick(event) {
    if (!(event.target instanceof Element)) return;

    // 변수 의미: 가장 가까운 장소 선택 트리거 요소다.
    const trigger = event.target.closest('[data-map-place-id]');
    if (!trigger) return;
    selectPlace(trigger.dataset.mapPlaceId);
  }

  /**
   * 입력: submit 이벤트 객체.
   * 출력: 주소 검색 뒤 resolve되는 Promise.
   * 역할: 주소를 좌표로 변환하고 지도를 이동한다.
   * 호출 예시: form.addEventListener('submit', handleAddressSubmit);
   */
  async function handleAddressSubmit(event) {
    event.preventDefault();

    // 변수 의미: 지도 페이지 요소 모음이다.
    const elements = getElements();
    // 변수 의미: 주소 검색어다.
    const query = elements.addressInput ? elements.addressInput.value.trim() : '';
    if (!query) {
      updatePositionStatus('검색할 주소를 입력하세요.');
      return;
    }
    if (!hasRestProxy()) {
      updatePositionStatus('주소 검색에는 NAVER_MAPS_API_KEY 설정이 필요합니다.');
      return;
    }

    // 변수 의미: Geocoding용 쿼리 파라미터다.
    const params = new URLSearchParams({ query, count: '5', language: 'kor' });
    if (state.activeLocation) {
      params.set('coordinate', `${state.activeLocation.longitude},${state.activeLocation.latitude}`);
    }

    updatePositionStatus('주소를 검색하고 있습니다.');
    try {
      // 변수 의미: NAVER Geocoding 응답 페이로드다.
      const payload = await requestJson(GEOCODE_ENDPOINT, params);
      // 변수 의미: Geocoding 주소 후보 목록이다.
      const addresses = Array.isArray(payload.addresses) ? payload.addresses : [];
      if (!addresses.length) {
        updatePositionStatus('검색 결과가 없습니다.');
        return;
      }

      // 변수 의미: 첫 번째 Geocoding 후보 결과다.
      const candidate = addresses[0];
      // 변수 의미: 후보 결과의 위도다.
      const latitude = Number(candidate.y);
      // 변수 의미: 후보 결과의 경도다.
      const longitude = Number(candidate.x);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Geocoding result has invalid coordinates.');
      }

      // 변수 의미: NAVER Geocoding 결과 중 화면에 표시할 최적 주소다.
      const displayName = candidate.roadAddress || candidate.jibunAddress || candidate.englishAddress || query;
      // 변수 의미: 정규화된 검색 위치 객체다.
      const location = normalizeLocation(latitude, longitude, displayName, 'geocode');
      await moveToLocation(location, FOCUSED_ZOOM, false);
    } catch (error) {
      updatePositionStatus('주소 검색에 실패했습니다.');
    }
  }

  /**
   * 입력: 없음.
   * 출력: 좌표 이동 뒤 resolve되는 Promise.
   * 역할: 사용자가 입력한 좌표로 지도를 이동하고 필요하면 Reverse Geocoding을 실행한다.
   * 호출 예시: await handleCoordinateMove();
   */
  async function handleCoordinateMove() {
    try {
      // 변수 의미: 사용자가 직접 입력한 좌표 위치 객체다.
      const location = readCoordinateInputs();
      await moveToLocation(location, FOCUSED_ZOOM, hasRestProxy());
    } catch (error) {
      updatePositionStatus(error.message || '좌표 값을 확인하세요.');
    }
  }

  /**
   * 입력: 없음.
   * 출력: 브라우저 위치 이동 뒤 resolve되는 Promise.
   * 역할: 브라우저 위치 또는 대전 대체 위치로 지도를 이동한다.
   * 호출 예시: await handleCurrentLocationRequest();
   */
  async function handleCurrentLocationRequest() {
    updatePositionStatus('현재 위치를 확인하고 있습니다.');
    try {
      // 변수 의미: 브라우저가 제공한 위치 객체다.
      const location = await getBrowserLocation();
      await moveToLocation(location, DEFAULT_ZOOM, hasRestProxy());
    } catch (error) {
      // 변수 의미: 대체로 사용할 대전 위치다.
      const fallbackLocation = getFallbackLocation();
      await moveToLocation(fallbackLocation, DEFAULT_ZOOM, false);
      updatePositionStatus(`현재 위치 권한 없음 · ${fallbackLocation.name} · ${formatCoordinate(fallbackLocation)}`);
    }
  }

  /**
   * 입력: 지도 페이지 요소 참조 모음.
   * 출력: 없음.
   * 역할: 폼, 좌표, 현재 위치, 마커 클릭 핸들러를 등록한다.
   * 호출 예시: bindMapControls(getElements());
   */
  function bindMapControls(elements) {
    if (elements.addressForm) elements.addressForm.addEventListener('submit', handleAddressSubmit);
    if (elements.coordinateButton) elements.coordinateButton.addEventListener('click', handleCoordinateMove);
    if (elements.currentLocationButton) elements.currentLocationButton.addEventListener('click', handleCurrentLocationRequest);
    document.addEventListener('click', handleMapClick);
  }

  /**
   * 입력: 지도 컨테이너 요소와 선택적 초기 장소 ID.
   * 출력: 지도 렌더링 뒤 resolve되는 Promise.
   * 역할: 설정이 있으면 Dynamic Map을 렌더링하고 아니면 목업 지도로 대체한다.
   * 호출 예시: await renderQuestMap(document.querySelector('[data-quest-map]'));
   */
  async function renderQuestMap(container, initialPlaceId) {
    if (!container) return;

    // 변수 의미: 처음 선택할 장소 ID다.
    const selectedPlaceId = initialPlaceId || data.questPlaces[0].id;
    // 변수 의미: 대체로 사용할 대전 위치다.
    const fallbackLocation = getFallbackLocation();
    setCoordinateInputs(fallbackLocation);
    showPlaceDetail(selectedPlaceId);
    renderPlaceList(selectedPlaceId);

    try {
      updateProviderStatus('연결 확인 중', 'warning');
      // 변수 의미: 공개 가능한 Dynamic Map 설정 값이다.
      const config = await loadNaverConfig();
      if (!config.dynamicMapConfigured || !config.keyId) {
        throw new Error('NAVER Dynamic Map Key ID is missing.');
      }

      await loadNaverMapsSdk(config.keyId);
      // 변수 의미: 초기 지도 위치 객체다.
      const initialLocation = await resolveInitialLocation();
      renderNaverQuestMap(container, selectedPlaceId, initialLocation);
      await moveToLocation(initialLocation, DEFAULT_ZOOM, hasRestProxy());
      updateProviderStatus(config.restApiConfigured ? 'Naver Dynamic Map' : '지도만 연결', config.restApiConfigured ? 'ready' : 'warning');
    } catch (error) {
      renderMockQuestMap(container, selectedPlaceId);
      updateProviderStatus('Mock 지도', 'error');
      updatePositionStatus('네이버 지도 키 또는 Web 서비스 URL 설정을 확인하세요.');
    }
  }

  /**
   * 입력: 없음.
   * 출력: 없음.
   * 역할: 지도 페이지를 초기화한다.
   * 호출 예시: initMapPage();
   */
  function initMapPage() {
    // 변수 의미: 지도 페이지 요소 모음이다.
    const elements = getElements();
    bindMapControls(elements);
    renderQuestMap(elements.mapCanvas);
  }

  // 변수 의미: 메인 페이지 초기화 코드에서 사용할 지도 헬퍼를 공개한다.
  window.QuestbookMap = {
    renderQuestMap,
    initMapPage,
  };
}(window, document));
