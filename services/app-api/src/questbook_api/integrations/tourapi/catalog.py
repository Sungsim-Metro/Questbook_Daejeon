# 사용자 요청 경로와 독립적으로 대전 TourAPI 카탈로그 전체를 검증하며 수집한다.
from __future__ import annotations

from threading import Event
from typing import Any
from urllib.parse import urlencode

from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.integrations.tourapi.client import (
    DAEJEON_AREA_CODE,
    DAEJEON_PAGE_SIZE,
    TOURAPI_AREA_ENDPOINT,
    TOURAPI_SUCCESS_RESULT_CODE,
    UPSTREAM_TIMEOUT_SECONDS,
    TourApiClient,
    extract_response_body,
    extract_response_items,
    extract_result_code,
    read_payload_with_deadline,
)


def _nonnegative_integer(raw_value: Any) -> int:
    """
    입력: 원천 페이지의 전체 건수 또는 페이지 번호.
    출력: 0 이상의 정수.
    역할: bool, 실수, 누락값을 유효한 전체 건수로 오인하지 않게 한다.
    호출 예시: total_count = _nonnegative_integer(body.get("totalCount"))
    """
    if isinstance(raw_value, bool) or not isinstance(raw_value, (int, str)):
        raise ValueError("Invalid catalog count")
    # 변수 의미: 문자열 정수를 정규화한 카탈로그 건수다.
    parsed_value = int(raw_value)
    if parsed_value < 0:
        raise ValueError("Invalid catalog count")
    return parsed_value


def fetch_catalog(
    client: TourApiClient,
    *,
    max_pages: int = 1000,
    stop_event: Event | None = None,
) -> tuple[list[TourPlaceCandidate], str]:
    """
    입력: 인증과 기존 분류 파서를 제공하는 클라이언트, 최대 페이지 수, 종료 이벤트.
    출력: 완결된 전체 장소 목록과 live, 또는 빈 목록과 안전한 실패 상태.
    역할: 전체 건수·중복·파싱 누락을 검증해 부분 조회로 인한 기존 장소 폐기를 막는다.
    호출 예시: places, status = fetch_catalog(TourApiClient(service_key))
    """
    if not client.service_key:
        return [], "error:not_configured"
    if (
        isinstance(max_pages, bool)
        or not isinstance(max_pages, int)
        or max_pages < 1
    ):
        return [], "error:invalid_page_limit"
    # 변수 의미: 페이지 간 일관성을 검증할 최초 전체 건수다.
    expected_total: int | None = None
    # 변수 의미: 완결성 확인 전에는 저장하지 않는 최소 장소 후보 목록이다.
    places: list[TourPlaceCandidate] = []
    # 변수 의미: 같은 페이지와 여러 페이지의 중복을 검사하는 원천 ID 집합이다.
    seen_ids: set[str] = set()
    # 변수 의미: 한 번만 요청하며 1부터 증가하는 전체 조회 페이지 번호다.
    for page_number in range(1, max_pages + 1):
        if stop_event is not None and stop_event.is_set():
            return [], "cancelled"
        # 변수 의미: 대전 전체 조회에 필요한 필터 없는 TourAPI 요청 파라미터다.
        query_params = {
            "serviceKey": client.service_key,
            "MobileOS": "ETC",
            "MobileApp": "QuestbookDaejeon",
            "_type": "json",
            "areaCode": DAEJEON_AREA_CODE,
            "numOfRows": str(DAEJEON_PAGE_SIZE),
            "pageNo": str(page_number),
            "arrange": "A",
        }
        # 변수 의미: 인증값을 포함하므로 반환값과 로그에 기록하지 않는 요청 URL이다.
        request_url = f"{TOURAPI_AREA_ENDPOINT}?{urlencode(query_params)}"
        try:
            # 기존 사용자 조회의 서킷, 재시도, 호출량 상태는 읽거나 변경하지 않는다.
            # 변수 의미: 페이지별 기존 5초 제한으로 받은 원천 JSON 응답이다.
            payload = read_payload_with_deadline(request_url, UPSTREAM_TIMEOUT_SECONDS)
            if extract_result_code(payload) != TOURAPI_SUCCESS_RESULT_CODE:
                return [], "error:upstream_result"
            # 변수 의미: 구조를 검증한 응답 본문과 누락 없이 받은 원천 행이다.
            response_body = extract_response_body(payload)
            raw_items = extract_response_items(response_body)
            # 변수 의미: 이번 페이지에 명시된 전체 건수다.
            total_count = _nonnegative_integer(response_body.get("totalCount"))
            if expected_total is None:
                expected_total = total_count
            if total_count != expected_total:
                return [], "incomplete:changed_total"
            if (
                "pageNo" in response_body
                and _nonnegative_integer(response_body["pageNo"]) != page_number
            ):
                return [], "incomplete:wrong_page"
            # 변수 의미: 전체 건수에 따라 이번 페이지가 반드시 포함해야 하는 행 수다.
            expected_page_count = min(
                DAEJEON_PAGE_SIZE, expected_total - len(places),
            )
            if len(raw_items) != expected_page_count:
                return [], "incomplete:row_count"
            # 변수 의미: 중복과 형식을 확인할 현재 페이지의 각 원천 행이다.
            for raw_item in raw_items:
                if not isinstance(raw_item, dict):
                    return [], "incomplete:invalid_item"
                # 변수 의미: 기존 파서의 문자열 변환 전에 검증할 원천 ID와 제목이다.
                raw_id = raw_item.get("contentid")
                raw_title = raw_item.get("title")
                if (
                    isinstance(raw_id, bool)
                    or not isinstance(raw_id, (int, str))
                    or not str(raw_id).strip()
                    or not isinstance(raw_title, str)
                    or not raw_title.strip()
                    or isinstance(raw_item.get("mapx"), bool)
                    or isinstance(raw_item.get("mapy"), bool)
                ):
                    return [], "incomplete:invalid_item"
                # 변수 의미: 파서와 같은 방식으로 정규화한 중복 검사 ID다.
                content_id = str(raw_id).strip()
                if content_id in seen_ids:
                    return [], "incomplete:duplicate_id"
                seen_ids.add(content_id)
            # 변수 의미: 기존 파서와 카테고리 규칙으로 변환한 페이지 후보 목록이다.
            page_places = client._parse_tourapi_payload(payload)
            if len(page_places) != len(raw_items):
                return [], "incomplete:invalid_item"
            places.extend(page_places)
            if len(places) == expected_total:
                return places, "live"
        except Exception:
            # 외부 예외 문자열은 URL과 인증값을 포함할 수 있으므로 기록하지 않는다.
            return [], "error:upstream_error"
    return [], "incomplete:page_limit"
