# 한국관광공사 TourAPI 호출과 fallback 장소 후보 생성을 담당한다.
from __future__ import annotations

import json
import math
from concurrent.futures import Future
from datetime import date, datetime, timedelta, timezone
from threading import Lock, Thread
from time import monotonic
from typing import Any
from urllib.parse import unquote, urlencode
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

from questbook_api.domain.models import TourPlaceCandidate


# 변수 의미: TourAPI 위치 기반 목록 조회 엔드포인트다.
TOURAPI_LOCATION_ENDPOINT = "https://apis.data.go.kr/B551011/KorService2/locationBasedList2"
# 변수 의미: 대전 전체 관광지를 지역 코드로 조회하는 공식 엔드포인트다.
TOURAPI_AREA_ENDPOINT = "https://apis.data.go.kr/B551011/KorService2/areaBasedList2"
# 변수 의미: TourAPI 지역 코드 체계의 대전광역시 값이다.
DAEJEON_AREA_CODE = "3"
# 변수 의미: 대전 전체 조회에서 한 페이지에 요청하는 원천 항목 수다.
DAEJEON_PAGE_SIZE = 100
# 변수 의미: 한 번의 사용자 조회에서 허용하는 최대 원천 페이지 수다.
DAEJEON_MAX_PAGES = 5
# 변수 의미: 게이트웨이의 10초 제한 안에 응답하기 위한 원천 조회 총 시간 예산이다.
DAEJEON_FETCH_BUDGET_SECONDS = 7.5
# 변수 의미: 외부 API 응답 제한 시간 초 단위 값이다.
UPSTREAM_TIMEOUT_SECONDS = 5
# 변수 의미: TourAPI 정상 응답 코드다.
TOURAPI_SUCCESS_RESULT_CODE = "0000"


# 변수 의미: TourAPI가 없을 때 baseline 흐름을 검증하기 위한 대전 장소 후보 목록이다.
FALLBACK_PLACES: list[TourPlaceCandidate] = [
    TourPlaceCandidate("fallback-hanbat-arboretum", "한밭수목원", 36.3671, 127.3882, "nature", "자연 관찰", "도심 속 녹지를 걷고 식물 관찰 기록을 남기는 추천 장소입니다.", None, "fallback"),
    TourPlaceCandidate("fallback-science-museum", "국립중앙과학관", 36.3762, 127.3745, "science", "과학 문화", "전시와 체험을 연결해 과학 탐험 퀘스트를 만들기 좋은 장소입니다.", None, "fallback"),
    TourPlaceCandidate("fallback-eunhaeng-dong", "은행동 스카이로드", 36.3284, 127.4277, "downtown", "원도심 걷기", "원도심 산책과 야간 기록을 연결할 수 있는 중심 거리입니다.", None, "fallback"),
    TourPlaceCandidate("fallback-sungsimdang", "성심당 본점", 36.3275, 127.4273, "market", "지역 상권", "대전 로컬 상권 방문과 소비형 퀘스트를 시연하기 좋은 장소입니다.", None, "fallback"),
    TourPlaceCandidate("fallback-tashu-station", "타슈 중앙로 거점", 36.3267, 127.4262, "mobility", "이동형", "자전거 이동 퀘스트의 시작점으로 사용할 수 있는 도심 거점입니다.", None, "fallback"),
    TourPlaceCandidate("fallback-bomunsan-observatory", "보문산 전망대", 36.3016, 127.4218, "nightview", "야경 기록", "대전 전망과 야경 기록을 남길 수 있는 활동형 관광지입니다.", None, "fallback"),
]


# 변수 의미: Questbook 내부 카테고리별 fallback 필터 이름이다.
CATEGORY_NAMES = {
    "nature": "자연 관찰",
    "science": "과학 문화",
    "downtown": "원도심 걷기",
    "market": "지역 상권",
    "mobility": "이동형",
    "nightview": "야경 기록",
}

# 변수 의미: 공식 lclsSystmCode2 branch와 고정 leaf를 Questbook에 연결하는 규칙이다.
# 공식 출처(2026-09-01 조회): https://apis.data.go.kr/B551011/KorService2/lclsSystmCode2
LCLS_CATEGORY_RULES: tuple[
    tuple[str, tuple[str, ...], tuple[str, ...]],
    ...,
] = (
    # 변수 의미: 타워·전망대 분류를 야경 기록 테마로 연결한다.
    ("nightview", (), ("VE010200",)),
    # 변수 의미: 천문대·전시시설·첨단산업 체험 분류를 과학 문화 테마로 연결한다.
    (
        "science",
        ("VE07",),
        (
            "VE020500",
            "EX060200",
            "EX060600",
            "EX060700",
            "EX060900",
        ),
    ),
    # 변수 의미: 자연관광·도시공원·생태축제·자연치유 분류를
    # 자연 관찰 테마로 연결한다.
    ("nature", ("NA", "VE03"), ("EV010500", "EX050700")),
    # 변수 의미: 음식·쇼핑·특산물축제·향토산업 분류를 지역 상권 테마로 연결한다.
    ("market", ("FD", "SH"), ("EV010300", "EX060300", "EX060800")),
    # 변수 의미: 레저스포츠·교통시설 분류를 이동형 테마로 연결한다.
    ("mobility", ("LS", "VE11"), ()),
)

# 변수 의미: 신분류가 없을 때 기존 코드·제목 평가 순서를 보존하는 fallback 규칙이다.
LEGACY_CATEGORY_RULES: tuple[
    tuple[str, tuple[str, ...], tuple[str, ...]],
    ...,
] = (
    ("market", ("A05",), ("시장", "성심", "빵")),
    ("science", ("A02",), ("과학", "박물관")),
    ("mobility", ("A03",), ("자전거", "타슈")),
    ("nightview", (), ("전망", "야경")),
    ("nature", ("A01",), ("공원", "수목원")),
)


def _normalize_classification_codes(
    raw_item: dict[str, Any],
    field_names: tuple[str, ...],
) -> tuple[str, ...]:
    """
    입력: TourAPI item 딕셔너리와 읽을 분류 필드 이름 목록.
    출력: 빈 값이 제거되고 대문자로 정규화된 분류 코드 튜플.
    역할: 신분류와 구분류의 누락, null, 공백 형태를 동일하게 처리한다.
    호출 예시: codes = _normalize_classification_codes(item, ("lclsSystm1", "lclsSystm2"))
    """
    # 변수 의미: 정규화한 유효 분류 코드를 순서대로 모은 목록이다.
    normalized_codes: list[str] = []
    # 변수 의미: 현재 읽을 TourAPI 분류 필드 이름이다.
    for field_name in field_names:
        # 변수 의미: TourAPI 응답에 들어 있던 원본 분류 코드 값이다.
        raw_code = raw_item.get(field_name)
        if raw_code is None:
            continue
        # 변수 의미: 공백 제거와 대문자 변환을 적용한 분류 코드다.
        normalized_code = str(raw_code).strip().upper()
        if normalized_code:
            normalized_codes.append(normalized_code)
    return tuple(normalized_codes)


def haversine_meters(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    """
    입력: 두 지점의 위도와 경도.
    출력: 두 지점 사이의 대략적인 거리 미터 값.
    역할: 추천 점수와 GPS 인증 반경 계산에 사용한다.
    호출 예시: distance = haversine_meters(36.327, 127.427, 36.3671, 127.3882)
    """
    # 변수 의미: 지구 반지름 미터 값이다.
    earth_radius_meters = 6_371_000
    # 변수 의미: 라디안으로 변환한 위도 차이다.
    delta_latitude = math.radians(latitude_b - latitude_a)
    # 변수 의미: 라디안으로 변환한 경도 차이다.
    delta_longitude = math.radians(longitude_b - longitude_a)
    # 변수 의미: 첫 번째 위도의 라디안 값이다.
    latitude_a_radians = math.radians(latitude_a)
    # 변수 의미: 두 번째 위도의 라디안 값이다.
    latitude_b_radians = math.radians(latitude_b)
    # 변수 의미: haversine 공식의 중간 값이다.
    haversine_value = (
        math.sin(delta_latitude / 2) ** 2
        + math.cos(latitude_a_radians) * math.cos(latitude_b_radians) * math.sin(delta_longitude / 2) ** 2
    )
    # 변수 의미: 두 지점 사이의 중심각이다.
    central_angle = 2 * math.atan2(math.sqrt(haversine_value), math.sqrt(1 - haversine_value))
    return earth_radius_meters * central_angle


def with_distances(places: list[TourPlaceCandidate], latitude: float, longitude: float) -> list[TourPlaceCandidate]:
    """
    입력: 장소 후보 목록과 기준 좌표.
    출력: distance_meters가 채워진 장소 후보 목록.
    역할: TourAPI fallback 장소에도 거리 정보를 붙인다.
    호출 예시: nearby = with_distances(FALLBACK_PLACES, 36.327, 127.427)
    """
    # 변수 의미: 거리 값이 갱신된 장소 후보 목록이다.
    places_with_distances: list[TourPlaceCandidate] = []
    for place in places:
        # 변수 의미: 기준 좌표와 장소 사이 거리다.
        distance_meters = haversine_meters(latitude, longitude, place.latitude, place.longitude)
        places_with_distances.append(
            TourPlaceCandidate(
                place.content_id,
                place.title,
                place.latitude,
                place.longitude,
                place.category_code,
                place.category_name,
                place.summary,
                round(distance_meters, 1),
                place.source,
            )
        )
    return places_with_distances


def map_tourapi_category(raw_item: dict[str, Any]) -> tuple[str, str]:
    """
    입력: TourAPI item 딕셔너리.
    출력: Questbook 내부 카테고리 코드와 표시 이름.
    역할: 복잡한 TourAPI 분류를 baseline 카테고리로 단순 매핑한다.
    호출 예시: category_code, category_name = map_tourapi_category(item)
    """
    # 변수 의미: TourAPI 신분류 1·2·3Depth에서 정규화한 코드 목록이다.
    lcls_codes = _normalize_classification_codes(
        raw_item,
        ("lclsSystm1", "lclsSystm2", "lclsSystm3"),
    )
    # 변수 의미: 관광지 제목이다.
    title = str(raw_item.get("title", ""))
    if lcls_codes:
        # 변수 의미: 우선순위대로 검사할 카테고리, branch 접두사, 고정 leaf 코드다.
        for category_code, code_prefixes, exact_codes in LCLS_CATEGORY_RULES:
            if any(
                classification_code.startswith(code_prefix)
                for classification_code in lcls_codes
                for code_prefix in code_prefixes
            ) or any(classification_code in exact_codes for classification_code in lcls_codes):
                return category_code, CATEGORY_NAMES[category_code]
    else:
        # 변수 의미: 신분류가 없을 때 cat1·2·3에서 정규화한 구분류 코드 목록이다.
        legacy_codes = _normalize_classification_codes(
            raw_item,
            ("cat1", "cat2", "cat3"),
        )
        # 변수 의미: 기존 우선순위대로 검사할 카테고리, 코드 접두사, 제목 키워드다.
        for category_code, code_prefixes, title_keywords in LEGACY_CATEGORY_RULES:
            if any(
                legacy_code.startswith(code_prefix)
                for legacy_code in legacy_codes
                for code_prefix in code_prefixes
            ) or any(title_keyword in title for title_keyword in title_keywords):
                return category_code, CATEGORY_NAMES[category_code]
        return "downtown", CATEGORY_NAMES["downtown"]

    # 변수 의미: 신분류가 미등록일 때 기존 제목 fallback으로 검사할 카테고리와 키워드다.
    for category_code, _code_prefixes, title_keywords in LEGACY_CATEGORY_RULES:
        if any(title_keyword in title for title_keyword in title_keywords):
            return category_code, CATEGORY_NAMES[category_code]
    return "downtown", CATEGORY_NAMES["downtown"]


def normalize_service_key(raw_service_key: str) -> str:
    """
    입력: 환경 변수에서 읽은 한국관광공사 OpenAPI 서비스 키.
    출력: URL 쿼리 인코딩 전에 사용할 서비스 키.
    역할: 공공데이터포털의 Encoding/Decoding 키 입력 차이로 인한 이중 인코딩을 방지한다.
    호출 예시: service_key = normalize_service_key(get_env("TOURAPI_SERVICE_KEY"))
    """
    # 변수 의미: 앞뒤 공백을 제거한 원본 서비스 키다.
    stripped_key = raw_service_key.strip()
    if not stripped_key:
        return ""
    return unquote(stripped_key)


def extract_result_code(payload: dict[str, Any]) -> str:
    """
    입력: TourAPI JSON 페이로드.
    출력: 응답 헤더의 resultCode 문자열.
    역할: HTTP 200이어도 인증키 오류나 서비스 오류이면 fallback으로 전환하게 한다.
    호출 예시: result_code = extract_result_code(payload)
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("response"), dict):
        raise ValueError("Invalid TourAPI response envelope")
    # 변수 의미: TourAPI 응답 헤더 딕셔너리다.
    response_header = payload["response"].get("header", {})
    if not isinstance(response_header, dict):
        raise ValueError("Invalid TourAPI response header")
    return str(response_header.get("resultCode", "")).strip()


def extract_response_body(payload: dict[str, Any]) -> dict[str, Any]:
    """
    입력: TourAPI JSON 페이로드.
    출력: 구조를 검증한 응답 본문 딕셔너리.
    역할: 잘못된 중첩 JSON이 속성 접근 오류로 서버까지 전파되지 않도록 한다.
    호출 예시: body = extract_response_body(payload)
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("response"), dict):
        raise ValueError("Invalid TourAPI response envelope")
    # 변수 의미: 페이징 정보와 장소 목록을 포함하는 응답 본문이다.
    response_body = payload["response"].get("body")
    if not isinstance(response_body, dict):
        raise ValueError("Invalid TourAPI response body")
    return response_body


def extract_response_items(response_body: dict[str, Any]) -> list[Any]:
    """
    입력: 구조를 검증한 TourAPI 응답 본문.
    출력: 빈 값과 단일 항목을 정규화한 원본 항목 목록.
    역할: 정상 빈 목록은 보존하고 파싱과 페이지 종료 판단에 같은 항목 수를 사용한다.
    호출 예시: raw_items = extract_response_items(extract_response_body(payload))
    """
    # 변수 의미: 빈 문자열이나 null일 수도 있는 원본 items 컨테이너다.
    items_container = response_body.get("items")
    if items_container is None or items_container == "":
        return []
    if not isinstance(items_container, dict):
        raise ValueError("Invalid TourAPI items container")
    # 변수 의미: TourAPI item 목록 또는 단일 item 값이다.
    raw_items = items_container.get("item")
    if raw_items is None or raw_items == "":
        return []
    if isinstance(raw_items, dict):
        return [raw_items]
    if not isinstance(raw_items, list):
        raise ValueError("Invalid TourAPI item list")
    return raw_items


def read_payload_with_deadline(request_url: str, timeout_seconds: float) -> Any:
    """
    입력: 요청 URL과 응답을 기다릴 수 있는 최대 시간.
    출력: 외부 응답을 JSON으로 변환한 페이로드.
    역할: 소켓 작업별 제한 외에도 연결과 본문 수신 전체의 대기 시간을 제한한다.
    호출 예시: payload = read_payload_with_deadline(request_url, 3.5)
    """
    # 변수 의미: 네트워크 작업의 결과 또는 예외를 요청 처리 쪽에 전달하는 객체다.
    result: Future[Any] = Future()

    def read_response() -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 클라이언트 상태 변경 없이 원천 호출만 수행하고 결과와 예외를 전달한다.
        호출 예시: Thread(target=read_response, daemon=True).start()
        """
        try:
            with urlopen(request_url, timeout=timeout_seconds) as response:
                result.set_result(json.loads(response.read().decode("utf-8")))
        except Exception as error:
            result.set_exception(error)

    # 변수 의미: 제한 시간을 지난 소켓 정리가 사용자 응답을 막지 않도록 하는 작업 스레드다.
    response_worker = Thread(target=read_response, daemon=True)
    response_worker.start()
    return result.result(timeout=timeout_seconds)


class TourApiClient:
    """
    입력: TourAPI 서비스 키.
    출력: 주변 관광지 후보 조회 클라이언트.
    역할: 실제 TourAPI가 없거나 실패하면 fallback 장소로 baseline 흐름을 유지한다.
    호출 예시: client = TourApiClient(service_key); places, status = client.fetch_nearby(...)
    """

    def __init__(self, service_key: str) -> None:
        """
        입력: TourAPI 서비스 키.
        출력: 없음.
        역할: 외부 API 호출에 필요한 인증 값을 보관하되 출력하지 않는다.
        호출 예시: client = TourApiClient(settings.tourapi_service_key)
        """
        # 변수 의미: 한국관광공사 OpenAPI 서비스 키다.
        self.service_key = normalize_service_key(service_key)
        # 변수 의미: 연속 실패 횟수다.
        self._failure_count = 0
        # 변수 의미: 서킷이 다시 닫힐 수 있는 시각이다.
        self._circuit_open_until: datetime | None = None
        # 변수 의미: 일일 호출량을 기록하는 날짜다.
        self._quota_date = date.today()
        # 변수 의미: 오늘 수행한 TourAPI 호출 횟수다.
        self._daily_call_count = 0
        # 변수 의미: 상태 값 접근을 보호하는 잠금이다.
        self._lock = Lock()

    def fetch_nearby(
        self,
        latitude: float,
        longitude: float,
        category_key: str,
        radius_meters: int,
    ) -> tuple[list[TourPlaceCandidate], str]:
        """
        입력: 기준 좌표, 내부 카테고리 키, 검색 반경.
        출력: 장소 후보 목록과 원천 상태.
        역할: TourAPI 위치 기반 조회를 수행하고 실패 시 fallback을 반환한다.
        호출 예시: places, status = client.fetch_nearby(36.327, 127.427, "nature", 3000)
        """
        if not self.service_key:
            return self._fallback_places(latitude, longitude, category_key), "fallback:not_configured"
        if self._is_circuit_open():
            return self._fallback_places(latitude, longitude, category_key), "fallback:circuit_open"

        # 내부 카테고리 하나가 여러 공식 신분류에 걸치므로
        # lclsSystm 필터는 요청에 넣지 않는다.
        # 위치 기반 전체 결과를 받은 뒤 LCLS_CATEGORY_RULES로 한 번만 로컬 분류한다.
        # 변수 의미: TourAPI 요청 쿼리 파라미터다.
        query_params = {
            "serviceKey": self.service_key,
            "MobileOS": "ETC",
            "MobileApp": "QuestbookDaejeon",
            "_type": "json",
            "mapX": f"{longitude:.7f}",
            "mapY": f"{latitude:.7f}",
            "radius": str(radius_meters),
            "numOfRows": "20",
            "pageNo": "1",
            "arrange": "E",
        }
        # 변수 의미: 실제 호출할 TourAPI URL이다.
        request_url = f"{TOURAPI_LOCATION_ENDPOINT}?{urlencode(query_params)}"
        for attempt_index in range(2):
            try:
                self._record_quota_call()
                with urlopen(request_url, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                    # 변수 의미: TourAPI 응답 본문이다.
                    response_body = response.read().decode("utf-8")
                # 변수 의미: JSON으로 파싱한 TourAPI 응답이다.
                payload = json.loads(response_body)
                # 변수 의미: TourAPI 응답 결과 코드다.
                result_code = extract_result_code(payload)
                if result_code and result_code != TOURAPI_SUCCESS_RESULT_CODE:
                    self._record_failure()
                    return self._fallback_places(latitude, longitude, category_key), f"fallback:result_code_{result_code}"
                # 변수 의미: 정규화된 장소 후보 목록이다.
                places = self._parse_tourapi_payload(payload)
                self._record_success()
                if places:
                    return self._filter_places(with_distances(places, latitude, longitude), category_key), "live"
                return self._fallback_places(latitude, longitude, category_key), "fallback:empty"
            except HTTPError as error:
                if 400 <= error.code < 500:
                    self._record_failure()
                    return self._fallback_places(latitude, longitude, category_key), "fallback:upstream_4xx"
                self._record_failure()
            except (URLError, TimeoutError, ValueError, json.JSONDecodeError):
                self._record_failure()
            if attempt_index == 0:
                continue
            return self._fallback_places(latitude, longitude, category_key), "fallback:upstream_error"
        return self._fallback_places(latitude, longitude, category_key), "fallback:empty"

    def fetch_daejeon(self, category_key: str = "all") -> tuple[list[TourPlaceCandidate], str]:
        """
        입력: 내부 카테고리 키이며 기본값은 전체를 의미하는 all.
        출력: 거리 없는 대전 장소 후보 목록과 원천 상태.
        역할: 대전 지역 목록을 제한된 페이지와 시간 안에 수집하고 일부 조회와 정상 빈 결과를 구별한다.
        호출 예시: places, source_status = client.fetch_daejeon("science")
        """
        # 변수 의미: 외부 조회를 수행할 수 없을 때 사용할 거리 없는 대전 예시 장소다.
        fallback_places = self._filter_places(list(FALLBACK_PLACES), category_key, strict=True)
        if not self.service_key:
            return fallback_places, "fallback:not_configured"
        if self._is_circuit_open():
            return fallback_places, "fallback:circuit_open"

        # 변수 의미: 전체 원천 호출에 공유하는 단조 시계 기반 종료 시각이다.
        deadline = monotonic() + DAEJEON_FETCH_BUDGET_SECONDS
        # 변수 의미: 원천 식별자를 키로 사용해 페이지 간 중복을 제거한 최소 장소 후보다.
        places_by_id: dict[str, TourPlaceCandidate] = {}
        # 변수 의미: 중복 제거 전 실제 수신한 원천 항목 수다.
        received_item_count = 0
        # 변수 의미: 적어도 한 페이지의 정상 응답을 수신했는지 여부다.
        has_successful_page = False
        # 변수 의미: 정상 완료되기 전 기본으로 사용할 제한 조회 상태다.
        source_status = "live:partial"
        # 변수 의미: 1부터 시작하며 최대 호출 횟수를 넘지 않는 페이지 번호다.
        for page_number in range(1, DAEJEON_MAX_PAGES + 1):
            # 변수 의미: 이번 호출이 사용할 수 있는 남은 총 대기 시간이다.
            remaining_seconds = deadline - monotonic()
            if remaining_seconds <= 0:
                if not has_successful_page:
                    return fallback_places, "fallback:upstream_error"
                break
            # 내부 테마는 여러 공식 분류에 걸치므로 대전 전체를 조회한 후 기존 규칙으로 분류한다.
            # 변수 의미: 위치나 분류 코드를 사용하지 않는 대전 지역 기반 요청 파라미터다.
            query_params = {
                "serviceKey": self.service_key,
                "MobileOS": "ETC",
                "MobileApp": "QuestbookDaejeon",
                "_type": "json",
                "areaCode": DAEJEON_AREA_CODE,
                "numOfRows": str(DAEJEON_PAGE_SIZE),
                "pageNo": str(page_number),
                "arrange": "A",
            }
            # 변수 의미: 실제 호출할 TourAPI 지역 기반 조회 URL이다.
            request_url = f"{TOURAPI_AREA_ENDPOINT}?{urlencode(query_params)}"
            # 변수 의미: 유효한 첫 페이지를 받지 못했을 때 반환할 오류 원인이다.
            failure_status = "fallback:upstream_error"
            try:
                self._record_quota_call()
                # 변수 의미: 최소 필드로 변환하기 전에 메모리에서만 사용하는 원천 JSON 응답이다.
                payload = read_payload_with_deadline(request_url, min(UPSTREAM_TIMEOUT_SECONDS, remaining_seconds))
                # 변수 의미: HTTP 성공 여부와 별도로 검사하는 TourAPI 결과 코드다.
                result_code = extract_result_code(payload)
                if result_code != TOURAPI_SUCCESS_RESULT_CODE:
                    if result_code:
                        failure_status = f"fallback:result_code_{result_code}"
                    raise ValueError("TourAPI did not report success")
                # 변수 의미: 전체 건수와 원천 목록을 검증한 현재 페이지 본문이다.
                response_body = extract_response_body(payload)
                # 변수 의미: 잘못된 관광지 필드도 포함하는 원천 행 목록이다.
                raw_items = extract_response_items(response_body)
                # 변수 의미: 전체 건수가 제공될 때 사용하는 정수 값이며 없으면 None이다.
                total_count = response_body.get("totalCount")
                if total_count is not None:
                    if isinstance(total_count, bool) or not isinstance(total_count, (int, str)):
                        raise ValueError("Invalid TourAPI total count")
                    total_count = int(total_count)
                    if total_count < 0:
                        raise ValueError("Invalid TourAPI total count")
                # 변수 의미: 유효성 검사와 기존 분류 규칙을 통과한 현재 페이지 장소다.
                for place in self._parse_tourapi_payload(payload):
                    places_by_id.setdefault(place.content_id, place)
                received_item_count += len(raw_items)
                has_successful_page = True
                self._record_success()
                if (
                    total_count is not None and received_item_count >= total_count
                    or total_count is None and len(raw_items) < DAEJEON_PAGE_SIZE
                ):
                    source_status = "live"
                    break
                if not raw_items:
                    break
                continue
            except HTTPError as error:
                if 400 <= error.code < 500:
                    failure_status = "fallback:upstream_4xx"
            except (URLError, TimeoutError, ValueError, TypeError):
                pass
            self._record_failure()
            if not has_successful_page:
                return fallback_places, failure_status
            break
        return self._filter_places(list(places_by_id.values()), category_key, strict=True), source_status

    def status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: TourAPI 복원력 상태 딕셔너리.
        역할: 헬스체크에서 호출량, 실패 횟수, 서킷 상태를 확인한다.
        호출 예시: status = client.status()
        """
        with self._lock:
            self._reset_quota_if_needed()
            return {
                "configured": bool(self.service_key),
                "dailyCallCount": self._daily_call_count,
                "failureCount": self._failure_count,
                "circuitOpenUntil": self._circuit_open_until.isoformat() if self._circuit_open_until else None,
            }

    def _record_quota_call(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: TourAPI 호출량을 날짜별로 집계한다.
        호출 예시: self._record_quota_call()
        """
        with self._lock:
            self._reset_quota_if_needed()
            self._daily_call_count += 1

    def _record_success(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 성공 시 실패 카운터와 서킷 상태를 초기화한다.
        호출 예시: self._record_success()
        """
        with self._lock:
            self._failure_count = 0
            self._circuit_open_until = None

    def _record_failure(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 실패 카운터를 올리고 임계 초과 시 서킷을 연다.
        호출 예시: self._record_failure()
        """
        with self._lock:
            self._failure_count += 1
            if self._failure_count >= 3:
                self._circuit_open_until = datetime.now(timezone.utc) + timedelta(minutes=2)

    def _is_circuit_open(self) -> bool:
        """
        입력: 없음.
        출력: 서킷이 열려 있는지 여부.
        역할: 연속 실패 후 일정 시간 외부 호출을 차단한다.
        호출 예시: if self._is_circuit_open(): ...
        """
        with self._lock:
            if self._circuit_open_until is None:
                return False
            if self._circuit_open_until <= datetime.now(timezone.utc):
                self._circuit_open_until = None
                self._failure_count = 0
                return False
            return True

    def _reset_quota_if_needed(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 날짜가 바뀌면 일일 호출량 카운터를 초기화한다.
        호출 예시: self._reset_quota_if_needed()
        """
        # 변수 의미: 오늘 날짜다.
        today = date.today()
        if self._quota_date != today:
            self._quota_date = today
            self._daily_call_count = 0

    def _parse_tourapi_payload(self, payload: dict[str, Any]) -> list[TourPlaceCandidate]:
        """
        입력: TourAPI JSON 페이로드.
        출력: 최소 필드만 남긴 장소 후보 목록.
        역할: 원본 응답 전체를 저장하지 않도록 필요한 값만 추출한다.
        호출 예시: places = self._parse_tourapi_payload(payload)
        """
        # 변수 의미: TourAPI item 목록 또는 단일 item 값이다.
        raw_items = extract_response_items(extract_response_body(payload))

        # 변수 의미: 정규화된 장소 후보 목록이다.
        places: list[TourPlaceCandidate] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue
            # 변수 의미: TourAPI contentId 값이다.
            content_id = str(raw_item.get("contentid") or "").strip()
            # 변수 의미: 관광지 제목이다.
            title = str(raw_item.get("title") or "").strip()
            try:
                # 변수 의미: TourAPI 경도 값이다.
                longitude = float(raw_item.get("mapx"))
                # 변수 의미: TourAPI 위도 값이다.
                latitude = float(raw_item.get("mapy"))
            except (TypeError, ValueError):
                continue
            if (
                not content_id
                or not title
                or not math.isfinite(latitude)
                or not math.isfinite(longitude)
                or not -90 <= latitude <= 90
                or not -180 <= longitude <= 180
            ):
                continue
            # 변수 의미: 내부 카테고리 코드와 이름이다.
            category_code, category_name = map_tourapi_category(raw_item)
            places.append(
                TourPlaceCandidate(
                    content_id,
                    title,
                    latitude,
                    longitude,
                    category_code,
                    category_name,
                    f"{category_name} 퀘스트 후보로 추천된 관광지입니다.",
                    None,
                    "tourapi",
                )
            )
        return places

    def _fallback_places(self, latitude: float, longitude: float, category_key: str) -> list[TourPlaceCandidate]:
        """
        입력: 기준 좌표와 카테고리 키.
        출력: fallback 장소 후보 목록.
        역할: 외부 API 없이도 baseline 추천 흐름을 검증한다.
        호출 예시: places = self._fallback_places(36.327, 127.427, "all")
        """
        return self._filter_places(with_distances(FALLBACK_PLACES, latitude, longitude), category_key)

    def _filter_places(
        self,
        places: list[TourPlaceCandidate],
        category_key: str,
        *,
        strict: bool = False,
    ) -> list[TourPlaceCandidate]:
        """
        입력: 장소 후보 목록과 카테고리 키, 불일치 시 빈 목록을 보존할지 여부.
        출력: 카테고리 조건이 적용된 장소 후보 목록.
        역할: 사용자가 선택한 관광 카테고리를 추천 후보에 반영한다.
        호출 예시: filtered = self._filter_places(places, "science")
        """
        if category_key == "all" or not strict and category_key in {"", "recommended"}:
            return places
        # 변수 의미: 선택 카테고리와 일치하는 장소 목록이다.
        filtered_places = [place for place in places if place.category_code == category_key]
        return filtered_places if strict else filtered_places or places
