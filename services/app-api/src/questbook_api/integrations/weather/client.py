# 기상청(KMA) 단기예보(getVilageFcst) 호출과 프론트 응답 형식으로의 정규화를 담당한다.
#
# 업스트림 교체 메모: 사용자가 신청한 행정안전부 재난안전데이터공유플랫폼 "DSSP-IF-00183"이
# 승인되어 정확한 요청/응답 스펙이 확보되면, 이 파일의 _build_kma_request()와
# _parse_kma_response() 두 메서드(+필요하면 인증 방식)만 그 스펙에 맞게 바꾸면 된다.
# circuit-breaker, 캐시, fetch_forecast()의 반환 shape, 호출부(server.py)는 그대로 둔다.
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import urlopen

from questbook_api.integrations.weather.grid import latlng_to_grid


# 변수 의미: 기상청 단기예보(3일치 시간별) 조회 엔드포인트다.
KMA_VILAGE_FCST_ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
# 변수 의미: 외부 API 응답 제한 시간 초 단위 값이다.
UPSTREAM_TIMEOUT_SECONDS = 5
# 변수 의미: 공공데이터포털 공통 정상 응답 결과 코드다.
KMA_SUCCESS_RESULT_CODE = "00"
# 변수 의미: getVilageFcst가 실제로 발표를 마치는 KST 시각(각 시각 약 10분 뒤 발표된다)이다.
_BASE_TIME_HOURS = (2, 5, 8, 11, 14, 17, 20, 23)
# 변수 의미: 발표 지연을 감안해 막 발표된 슬롯을 곧바로 쓰지 않기 위한 안전 마진이다.
_PUBLISH_SAFETY_MARGIN_MINUTES = 15
# 변수 의미: getVilageFcst가 실제로 예보를 제공하는 최대 일수(오늘 포함)다.
_FORECAST_WINDOW_DAYS = 3
# 변수 의미: KST(한국 표준시) 타임존이다.
KST = timezone(timedelta(hours=9))
# 변수 의미: 인메모리 예보 캐시의 TTL 초 단위 값이다. 예보는 매 정시 갱신되지 않으므로
# 짧은 새로고침에는 캐시로 응답해 KMA 일일 호출 한도를 아낀다.
_CACHE_TTL_SECONDS = 1800
# 변수 의미: 하늘상태(SKY) 코드 -> 한글 라벨이다.
_SKY_LABELS: dict[str, str] = {"1": "맑음", "3": "구름 많음", "4": "흐림"}
# 변수 의미: 강수형태(PTY) 코드 -> 한글 라벨이다. "0"(없음)은 SKY로 판단하므로 여기 없다.
_PTY_LABELS: dict[str, str] = {
    "1": "비", "2": "비/눈", "3": "눈", "4": "소나기",
    "5": "빗방울", "6": "빗방울날림", "7": "눈날림",
}


def normalize_service_key(raw_service_key: str) -> str:
    """
    입력: 환경 변수에서 읽은 공공데이터포털 서비스 키.
    출력: URL 쿼리 인코딩 전에 사용할 서비스 키.
    역할: Encoding/Decoding 키 입력 차이로 인한 이중 인코딩을 방지한다. (TourApiClient와 동일한 이유)
    호출 예시: service_key = normalize_service_key(get_env("KMA_WEATHER_SERVICE_KEY"))
    """
    stripped_key = raw_service_key.strip()
    if not stripped_key:
        return ""
    return unquote(stripped_key)


def latest_valid_base_datetime(now_kst: datetime) -> tuple[str, str]:
    """
    입력: KST 기준 현재 시각.
    출력: (base_date "YYYYMMDD", base_time "HHMM") 튜플.
    역할: getVilageFcst가 실제로 발표를 마친 가장 최근 슬롯을 고른다. 자정을 넘나들 때도
    어제/오늘 후보를 함께 검사해서 자동으로 올바른 날짜로 넘어간다.
    호출 예시: base_date, base_time = latest_valid_base_datetime(datetime.now(KST))
    """
    # 변수 의미: 오늘·어제 날짜에 대해 만들어본 발표 슬롯 후보 시각들이다.
    candidates: list[datetime] = []
    for day_offset in (0, -1):
        candidate_date = (now_kst + timedelta(days=day_offset)).date()
        for hour in _BASE_TIME_HOURS:
            candidates.append(
                datetime(candidate_date.year, candidate_date.month, candidate_date.day, hour, 0, tzinfo=now_kst.tzinfo)
            )

    # 변수 의미: 안전 마진을 지나 실제로 발표됐다고 볼 수 있는 후보들이다.
    valid_candidates = [
        candidate for candidate in candidates
        if candidate + timedelta(minutes=_PUBLISH_SAFETY_MARGIN_MINUTES) <= now_kst
    ]
    # 변수 의미: 그중 가장 최근 슬롯이다.
    latest = max(valid_candidates)
    return latest.strftime("%Y%m%d"), latest.strftime("%H%M")


def sky_pty_to_condition(sky: str, pty: str) -> str:
    """
    입력: 하늘상태(SKY) 코드와 강수형태(PTY) 코드.
    출력: 화면에 보여줄 한글 날씨 상태 문구.
    역할: 비/눈이 오면 강수형태를 우선하고, 아니면 하늘상태로 표현한다.
    호출 예시: sky_pty_to_condition("3", "0") == "구름 많음"
    """
    if pty and pty != "0" and pty in _PTY_LABELS:
        return _PTY_LABELS[pty]
    return _SKY_LABELS.get(sky, "정보 없음")


def build_outdoor_note(temperature_c: float | None, precipitation_probability: int | None) -> str:
    """
    입력: 대표 기온(섭씨)과 강수확률(%).
    출력: 외출 참고 문구.
    역할: dev-server 목업과 같은 톤으로, 기온·강수확률 임계값 기반 짧은 안내 문장을 만든다.
    호출 예시: note = build_outdoor_note(29.0, 60)
    """
    # 변수 의미: 조건에 맞을 때마다 덧붙이는 안내 문구 목록이다.
    notes: list[str] = []

    if precipitation_probability is not None:
        if precipitation_probability >= 50:
            notes.append("비 소식이 있어요. 우산을 꼭 챙기세요.")
        elif precipitation_probability >= 20:
            notes.append("비가 올 수 있어요. 우산을 챙기면 안심이에요.")

    if temperature_c is not None:
        if temperature_c >= 28:
            notes.append("더운 날씨예요. 물을 충분히 챙기세요.")
        elif temperature_c <= 5:
            notes.append("쌀쌀해요. 겉옷을 챙기면 좋아요.")

    if not notes:
        notes.append("야외 활동하기 좋은 날씨예요.")
    return " ".join(notes)


class WeatherClient:
    """
    입력: 기상청 단기예보 서비스 키.
    출력: 프론트가 기대하는 형태로 정규화된 날씨 조회 클라이언트.
    역할: TourApiClient와 동일하게, 키가 없거나 실패해도 "unavailable" 응답으로 baseline
    흐름을 유지한다(원문 에러를 그대로 노출하지 않는다).
    호출 예시: client = WeatherClient(service_key); payload, status = client.fetch_forecast(36.35, 127.38, None)
    """

    def __init__(self, service_key: str) -> None:
        """
        입력: 기상청 단기예보 서비스 키.
        출력: 없음.
        역할: 외부 API 호출에 필요한 인증 값을 보관하되 출력하지 않는다.
        호출 예시: client = WeatherClient(settings.kma_weather_service_key)
        """
        # 변수 의미: 기상청 단기예보 서비스 키다.
        self.service_key = normalize_service_key(service_key)
        # 변수 의미: 연속 실패 횟수다.
        self._failure_count = 0
        # 변수 의미: 서킷이 다시 닫힐 수 있는 시각이다.
        self._circuit_open_until: datetime | None = None
        # 변수 의미: 일일 호출량을 기록하는 날짜다.
        self._quota_date = date.today()
        # 변수 의미: 오늘 수행한 호출 횟수다.
        self._daily_call_count = 0
        # 변수 의미: 상태 값과 캐시 접근을 보호하는 잠금이다.
        self._lock = Lock()
        # 변수 의미: (nx,ny,base_date,base_time) 키의 인메모리 예보 캐시다.
        # ThreadingHTTPServer가 단일 프로세스라 이 정도로 충분하고, 다중 인스턴스 배포 시에는
        # TourPlaceRedisCache 패턴으로 옮기면 된다.
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def fetch_forecast(
        self,
        latitude: float,
        longitude: float,
        target_date: date | None,
    ) -> tuple[dict[str, Any], str]:
        """
        입력: 기준 좌표와(선택) 조회하고 싶은 날짜. None이면 오늘(KST).
        출력: 프론트 normalizeWeather()가 기대하는 형태의 딕셔너리와 원천 상태 문자열.
        역할: 격자 변환, 발표 슬롯 선택, 캐시, circuit-breaker를 거쳐 예보를 정규화한다.
        호출 예시: payload, status = client.fetch_forecast(36.3504, 127.3845, None)
        """
        # 변수 의미: 현재 KST 시각이다.
        now_kst = datetime.now(KST)
        # 변수 의미: 실제로 조회할 대상 날짜다.
        resolved_target_date = target_date or now_kst.date()

        if not (now_kst.date() <= resolved_target_date < now_kst.date() + timedelta(days=_FORECAST_WINDOW_DAYS)):
            return self._unavailable_payload(), "fallback:out_of_range"
        if not self.service_key:
            return self._unavailable_payload(), "fallback:not_configured"
        if self._is_circuit_open():
            return self._unavailable_payload(), "fallback:circuit_open"

        # 변수 의미: getVilageFcst 격자 좌표다.
        grid_x, grid_y = latlng_to_grid(latitude, longitude)
        # 변수 의미: 사용할 발표 기준 날짜·시각이다.
        base_date, base_time = latest_valid_base_datetime(now_kst)
        # 변수 의미: 캐시 조회·저장 키다.
        cache_key = f"{grid_x}:{grid_y}:{base_date}:{base_time}:{resolved_target_date.isoformat()}"

        cached_payload = self._read_cache(cache_key)
        if cached_payload is not None:
            return cached_payload, "live:cached"

        # 변수 의미: 실제 호출할 업스트림 URL이다.
        request_url = self._build_kma_request(grid_x, grid_y, base_date, base_time)
        try:
            self._record_quota_call()
            with urlopen(request_url, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
                # 변수 의미: 업스트림 응답 원문이다.
                response_body = response.read().decode("utf-8")
            # 변수 의미: JSON으로 파싱한 업스트림 응답이다.
            payload = json.loads(response_body)
            aggregated = self._parse_kma_response(payload, resolved_target_date, now_kst)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
            self._record_failure()
            return self._unavailable_payload(), "fallback:upstream_error"

        if aggregated is None:
            # 응답은 받았지만 결과 코드가 실패였거나(_parse_kma_response가 None을 반환)
            # 대상 날짜의 시간대별 자료가 비어 있는 경우다.
            self._record_failure()
            return self._unavailable_payload(), "fallback:upstream_error"

        self._record_success()
        self._write_cache(cache_key, aggregated)
        return aggregated, "live"

    def _build_kma_request(self, grid_x: int, grid_y: int, base_date: str, base_time: str) -> str:
        """
        입력: 격자 좌표와 발표 기준 날짜·시각.
        출력: 실제로 호출할 getVilageFcst 요청 URL.
        역할: 업스트림별 요청 조립을 한 곳에 모아, DSSP-IF-00183 교체 시 이 메서드만 바꾸면
        되게 한다.
        호출 예시: url = self._build_kma_request(67, 100, "20260922", "0200")
        """
        # 변수 의미: getVilageFcst 요청 쿼리 파라미터다.
        query_params = {
            "serviceKey": self.service_key,
            "pageNo": "1",
            "numOfRows": "1000",
            "dataType": "JSON",
            "base_date": base_date,
            "base_time": base_time,
            "nx": str(grid_x),
            "ny": str(grid_y),
        }
        return f"{KMA_VILAGE_FCST_ENDPOINT}?{urlencode(query_params)}"

    def _parse_kma_response(
        self,
        payload: dict[str, Any],
        target_date: date,
        now_kst: datetime,
    ) -> dict[str, Any] | None:
        """
        입력: getVilageFcst JSON 응답, 조회 대상 날짜, 현재 KST 시각.
        출력: 프론트 형태로 정규화된 딕셔너리(실패/데이터 없음이면 None).
        역할: 업스트림 응답 구조를 프론트가 기대하는 평평한 형태로 바꾼다. DSSP-IF-00183
        교체 시 이 메서드만 그 응답 구조에 맞게 바꾸면 된다.
        호출 예시: aggregated = self._parse_kma_response(payload, date.today(), now_kst)
        """
        # 변수 의미: 응답 헤더의 결과 코드다.
        response = payload.get("response")
        if not isinstance(response, dict):
            return None
        header = response.get("header")
        if not isinstance(header, dict) or str(header.get("resultCode", "")).strip() != KMA_SUCCESS_RESULT_CODE:
            return None
        body = response.get("body")
        if not isinstance(body, dict):
            return None
        items_container = body.get("items")
        if not isinstance(items_container, dict):
            return None
        # 변수 의미: (fcstDate, fcstTime, category) 단위의 원본 항목 목록이다.
        raw_items = items_container.get("item")
        if raw_items is None:
            return None
        if isinstance(raw_items, dict):
            raw_items = [raw_items]
        if not isinstance(raw_items, list):
            return None

        # 변수 의미: (fcstDate, fcstTime) -> {category: value} 로 피벗한 슬롯별 값이다.
        slots: dict[tuple[str, str], dict[str, str]] = {}
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            fcst_date = str(item.get("fcstDate", ""))
            fcst_time = str(item.get("fcstTime", ""))
            category = str(item.get("category", ""))
            if not fcst_date or not fcst_time or not category:
                continue
            slots.setdefault((fcst_date, fcst_time), {})[category] = str(item.get("fcstValue", ""))

        # 변수 의미: 대상 날짜에 해당하는 슬롯만 시간순으로 정렬한 목록이다.
        target_date_str = target_date.strftime("%Y%m%d")
        matching_slots = sorted(
            (key for key in slots if key[0] == target_date_str),
            key=lambda key: key[1],
        )
        if not matching_slots:
            return None

        # 변수 의미: 시간별 예보 배열이다.
        hourly: list[dict[str, Any]] = []
        for fcst_date, fcst_time in matching_slots:
            values = slots[(fcst_date, fcst_time)]
            hourly.append({
                "time": f"{fcst_time[:2]}시",
                "temperatureC": _parse_optional_float(values.get("TMP")),
                "precipitationProbability": _parse_optional_int(values.get("POP")),
            })

        # 변수 의미: 대표 값으로 쓸, 지금 이후 가장 가까운 슬롯이다(전부 지났으면 첫 슬롯).
        now_time_str = now_kst.strftime("%H%M")
        representative_key = next(
            (key for key in matching_slots if key[1] >= now_time_str),
            matching_slots[0],
        )
        representative_values = slots[representative_key]
        representative_temp = _parse_optional_float(representative_values.get("TMP"))
        representative_pop = _parse_optional_int(representative_values.get("POP"))
        condition = sky_pty_to_condition(
            representative_values.get("SKY", ""), representative_values.get("PTY", ""),
        )

        return {
            "temperatureC": representative_temp,
            "precipitationProbability": representative_pop,
            "condition": condition,
            "outdoorNote": build_outdoor_note(representative_temp, representative_pop),
            "hourly": hourly,
            "unavailable": False,
        }

    def _unavailable_payload(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 프론트가 "연동 준비 중/조회 불가"로 표시할 최소 응답.
        역할: 키 없음/서킷 오픈/범위 밖/업스트림 실패를 모두 같은 모양으로 폴백한다.
        호출 예시: return self._unavailable_payload(), "fallback:not_configured"
        """
        return {"unavailable": True}

    def status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 날씨 연동 복원력 상태 딕셔너리.
        역할: 헬스체크/설정 확인 화면에서 호출량, 실패 횟수, 서킷 상태를 확인한다.
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

    def _read_cache(self, cache_key: str) -> dict[str, Any] | None:
        """
        입력: 캐시 키.
        출력: 캐시된 정규화 응답(없거나 만료됐으면 None).
        역할: TTL이 지나지 않은 예보를 재사용해 KMA 호출 횟수를 아낀다.
        호출 예시: cached = self._read_cache("67:100:20260922:0200:20260922")
        """
        with self._lock:
            entry = self._cache.get(cache_key)
            if entry is None:
                return None
            expires_at, cached_payload = entry
            if expires_at <= monotonic():
                del self._cache[cache_key]
                return None
            return cached_payload

    def _write_cache(self, cache_key: str, payload: dict[str, Any]) -> None:
        """
        입력: 캐시 키와 정규화된 응답.
        출력: 없음.
        역할: 다음 요청이 같은 격자·발표 슬롯·날짜를 다시 조회할 때 재사용하게 저장한다.
        호출 예시: self._write_cache(cache_key, aggregated)
        """
        with self._lock:
            self._cache[cache_key] = (monotonic() + _CACHE_TTL_SECONDS, payload)

    def _record_quota_call(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 호출량을 날짜별로 집계한다. (TourApiClient와 동일한 이유)
        호출 예시: self._record_quota_call()
        """
        with self._lock:
            self._reset_quota_if_needed()
            self._daily_call_count += 1

    def _reset_quota_if_needed(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 날짜가 바뀌면 일일 호출량 카운터를 초기화한다. 호출 전 반드시 self._lock을 쥔 채여야 한다.
        호출 예시: self._reset_quota_if_needed()
        """
        today = date.today()
        if self._quota_date != today:
            self._quota_date = today
            self._daily_call_count = 0

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


def _parse_optional_float(raw_value: str | None) -> float | None:
    """
    입력: KMA 응답의 원본 숫자 문자열(기온 등).
    출력: 파싱된 실수 값, 실패하면 None.
    역할: "강수없음" 같은 비숫자 값이 섞여도 죽지 않게 한다.
    호출 예시: temperature = _parse_optional_float("18.3")
    """
    if raw_value is None or raw_value == "":
        return None
    try:
        return float(raw_value)
    except ValueError:
        return None


def _parse_optional_int(raw_value: str | None) -> int | None:
    """
    입력: KMA 응답의 원본 숫자 문자열(강수확률 등).
    출력: 파싱된 정수 값, 실패하면 None.
    역할: 강수확률처럼 정수로 보여줘야 하는 값을 안전하게 변환한다.
    호출 예시: pop = _parse_optional_int("60")
    """
    if raw_value is None or raw_value == "":
        return None
    try:
        return int(float(raw_value))
    except ValueError:
        return None
