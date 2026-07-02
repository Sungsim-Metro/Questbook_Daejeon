# 한국관광공사 TourAPI 호출과 fallback 장소 후보 생성을 담당한다.
from __future__ import annotations

import json
import math
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import URLError, HTTPError

from questbook_api.domain.models import TourPlaceCandidate


# 변수 의미: TourAPI 위치 기반 목록 조회 엔드포인트다.
TOURAPI_LOCATION_ENDPOINT = "https://apis.data.go.kr/B551011/KorService2/locationBasedList2"
# 변수 의미: 외부 API 응답 제한 시간 초 단위 값이다.
UPSTREAM_TIMEOUT_SECONDS = 5


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
    # 변수 의미: TourAPI 대분류 코드다.
    category_one = str(raw_item.get("cat1", ""))
    # 변수 의미: TourAPI 중분류 코드다.
    category_two = str(raw_item.get("cat2", ""))
    # 변수 의미: 관광지 제목이다.
    title = str(raw_item.get("title", ""))
    if "A05" in {category_one, category_two} or "시장" in title or "성심" in title or "빵" in title:
        return "market", CATEGORY_NAMES["market"]
    if "A02" in {category_one, category_two} or "과학" in title or "박물관" in title:
        return "science", CATEGORY_NAMES["science"]
    if "A03" in {category_one, category_two} or "자전거" in title or "타슈" in title:
        return "mobility", CATEGORY_NAMES["mobility"]
    if "전망" in title or "야경" in title:
        return "nightview", CATEGORY_NAMES["nightview"]
    if "A01" in {category_one, category_two} or "공원" in title or "수목원" in title:
        return "nature", CATEGORY_NAMES["nature"]
    return "downtown", CATEGORY_NAMES["downtown"]


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
        self.service_key = service_key
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
        raw_items = payload.get("response", {}).get("body", {}).get("items", {}).get("item", [])
        if isinstance(raw_items, dict):
            raw_items = [raw_items]

        # 변수 의미: 정규화된 장소 후보 목록이다.
        places: list[TourPlaceCandidate] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict):
                continue
            # 변수 의미: TourAPI contentId 값이다.
            content_id = str(raw_item.get("contentid", "")).strip()
            # 변수 의미: 관광지 제목이다.
            title = str(raw_item.get("title", "")).strip()
            try:
                # 변수 의미: TourAPI 경도 값이다.
                longitude = float(raw_item.get("mapx"))
                # 변수 의미: TourAPI 위도 값이다.
                latitude = float(raw_item.get("mapy"))
            except (TypeError, ValueError):
                continue
            if not content_id or not title:
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

    def _filter_places(self, places: list[TourPlaceCandidate], category_key: str) -> list[TourPlaceCandidate]:
        """
        입력: 장소 후보 목록과 카테고리 키.
        출력: 카테고리 조건이 적용된 장소 후보 목록.
        역할: 사용자가 선택한 관광 카테고리를 추천 후보에 반영한다.
        호출 예시: filtered = self._filter_places(places, "science")
        """
        if category_key in {"", "all", "recommended"}:
            return places
        # 변수 의미: 선택 카테고리와 일치하는 장소 목록이다.
        filtered_places = [place for place in places if place.category_code == category_key]
        return filtered_places or places
