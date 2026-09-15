# 전체 카탈로그의 페이지 완결성 검증을 외부 네트워크 없이 수행한다.
from __future__ import annotations

import importlib
from threading import Event
from typing import Any
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

import pytest

from questbook_api.integrations.tourapi.client import TourApiClient


def catalog_module() -> Any:
    """입력: 없음. 출력: 조회 모듈. 역할: 구현 부재도 명시적 실패로 검증한다. 예시: module = catalog_module()."""
    assert importlib.util.find_spec("questbook_api.integrations.tourapi.catalog") is not None
    return importlib.import_module("questbook_api.integrations.tourapi.catalog")


def raw_place(content_id: int) -> dict[str, Any]:
    """입력: 장소 ID. 출력: 원천 항목. 역할: 정상 API 행을 재현한다. 예시: raw_place(1)."""
    return {"contentid": str(content_id), "title": "테스트 공원", "mapx": "127.4", "mapy": "36.3", "cat1": "A01"}


def page(items: list[Any], total_count: Any, page_number: int = 1) -> dict[str, Any]:
    """입력: 행·전체 건수·페이지. 출력: 응답. 역할: 페이징 원천을 재현한다. 예시: page([], 0)."""
    return {"response": {"header": {"resultCode": "0000"}, "body": {
        "items": {"item": items}, "totalCount": total_count, "numOfRows": 100, "pageNo": page_number,
    }}}


def test_catalog_reads_more_than_frontend_five_pages() -> None:
    """입력: 601개 장소. 출력: 전체 601개. 역할: 프런트 조회 상한 재사용을 방지한다. 예시: pytest -k five_pages."""
    # 변수 의미: 실제 전체 조회 구현과 인증값 없는 테스트 클라이언트다.
    module = catalog_module()
    client = TourApiClient("test-only-service-key")
    # 변수 의미: 네트워크 경계에서 관측한 페이지 번호다.
    requested_pages: list[int] = []

    def read_page(request_url: str, timeout_seconds: float) -> dict[str, Any]:
        """입력: 요청·시간 제한. 출력: 페이지 응답. 역할: 영역·페이지 계약을 검증한다. 예시: read_page(url, 5)."""
        # 변수 의미: 실제 요청에 포함된 쿼리와 현재 페이지다.
        query = parse_qs(urlparse(request_url).query)
        page_number = int(query["pageNo"][0])
        assert urlparse(request_url).path.endswith("/areaBasedList2")
        assert query["areaCode"] == ["3"]
        assert query["numOfRows"] == ["100"]
        assert timeout_seconds == 5
        assert "mapX" not in query
        requested_pages.append(page_number)
        return page([raw_place(index) for index in range((page_number - 1) * 100 + 1, min(page_number * 100, 601) + 1)], "601", page_number)

    with patch.object(module, "read_payload_with_deadline", side_effect=read_page):
        # 변수 의미: 완결 조회 결과와 상태다.
        places, status = module.fetch_catalog(client)
    assert status == "live"
    assert len(places) == 601
    assert places[-1].content_id == "601"
    assert requested_pages == [1, 2, 3, 4, 5, 6, 7]
    assert client.status()["dailyCallCount"] == 0


@pytest.mark.parametrize("total_count", [None, -1, True, "invalid", 1.5])
def test_catalog_rejects_invalid_total_count(total_count: Any) -> None:
    """입력: 잘못된 전체 건수. 출력: 비정상 상태. 역할: 불명확한 삭제 판정을 막는다. 예시: pytest -k total_count."""
    # 변수 의미: 전체 건수 검증 대상 모듈이다.
    module = catalog_module()
    with patch.object(module, "read_payload_with_deadline", return_value=page([raw_place(1)], total_count)):
        # 변수 의미: 저장 불가를 나타내는 조회 결과다.
        places, status = module.fetch_catalog(TourApiClient("test-key"))
    assert status != "live"
    assert places == []


@pytest.mark.parametrize("items", [[None], [{"contentid": "1"}], [raw_place(1) | {"contentid": ""}], [raw_place(1) | {"mapy": "NaN"}], [raw_place(1) | {"contentid": {"bad": 1}}], [raw_place(1) | {"title": []}]])
def test_catalog_rejects_malformed_or_dropped_rows(items: list[Any]) -> None:
    """입력: 잘못된 장소 행. 출력: 비정상 상태. 역할: 파싱 누락이 삭제로 오인되는 것을 막는다. 예시: pytest -k dropped_rows."""
    # 변수 의미: 개별 항목 검증 대상 모듈이다.
    module = catalog_module()
    with patch.object(module, "read_payload_with_deadline", return_value=page(items, 1)):
        # 변수 의미: 저장 불가를 나타내는 조회 결과다.
        places, status = module.fetch_catalog(TourApiClient("test-key"))
    assert status != "live"
    assert places == []


@pytest.mark.parametrize("second_page", [
    page([raw_place(1)], 101, 2),
    page([raw_place(101)], 102, 2),
    page([], 101, 2),
    page([raw_place(101), raw_place(102)], 101, 2),
    page([raw_place(101)], 101, 1),
])
def test_catalog_rejects_duplicates_changed_count_or_incomplete_pages(second_page: dict[str, Any]) -> None:
    """입력: 불완전한 두 번째 페이지. 출력: 비정상 상태. 역할: 중복·건수 변경·중단을 차단한다. 예시: pytest -k incomplete_pages."""
    # 변수 의미: 검증 모듈과 첫 페이지의 정상 장소 목록이다.
    module = catalog_module()
    first_page = page([raw_place(index) for index in range(1, 101)], 101)
    with patch.object(module, "read_payload_with_deadline", side_effect=[first_page, second_page]):
        # 변수 의미: 일부 결과를 저장하지 않도록 비워진 조회 결과다.
        places, status = module.fetch_catalog(TourApiClient("test-key"))
    assert status != "live"
    assert places == []


def test_catalog_page_limit_does_not_authorize_partial_sync() -> None:
    """입력: 상한보다 많은 페이지. 출력: 비정상 상태. 역할: 최대 호출 수와 완결 조건을 분리한다. 예시: pytest -k page_limit."""
    # 변수 의미: 조회 모듈과 아직 한 행이 남은 첫 페이지다.
    module = catalog_module()
    first_page = page([raw_place(index) for index in range(1, 101)], 101)
    with patch.object(module, "read_payload_with_deadline", return_value=first_page):
        # 변수 의미: 한 페이지 제한에 의해 저장하지 않는 결과다.
        places, status = module.fetch_catalog(TourApiClient("test-key"), max_pages=1)
    assert status != "live"
    assert places == []


@pytest.mark.parametrize("payload", [page([], 0), {"response": {"header": {"resultCode": "0000"}, "body": {"items": "", "totalCount": "0"}}}])
def test_catalog_accepts_explicit_complete_empty_result(payload: dict[str, Any]) -> None:
    """입력: 정상 0건. 출력: live 빈 목록. 역할: 정상 공집합을 오류와 구별한다. 예시: pytest -k complete_empty."""
    # 변수 의미: 빈 전체 목록 검증 대상 모듈이다.
    module = catalog_module()
    with patch.object(module, "read_payload_with_deadline", return_value=payload):
        assert module.fetch_catalog(TourApiClient("test-key")) == ([], "live")


@pytest.mark.parametrize("failure", [URLError("https://example.invalid/?serviceKey=sensitive-marker"), ValueError("sensitive-marker")])
def test_catalog_sanitizes_network_failures_even_after_a_good_page(failure: Exception) -> None:
    """입력: 키를 포함한 외부 예외. 출력: 안전한 상태. 역할: 오류가 로그에 키를 노출하지 않게 한다. 예시: pytest -k sanitizes."""
    # 변수 의미: 조회 모듈과 일부 정상 응답이다.
    module = catalog_module()
    first_page = page([raw_place(index) for index in range(1, 101)], 101)
    with patch.object(module, "read_payload_with_deadline", side_effect=[first_page, failure]):
        # 변수 의미: 원문 예외를 배제한 실패 결과다.
        places, status = module.fetch_catalog(TourApiClient("test-key"))
    assert places == []
    assert status != "live"
    assert "sensitive-marker" not in status
    assert "https" not in status


def test_catalog_requires_success_code_and_configured_key() -> None:
    """입력: 미설정 키·성공 코드 부재. 출력: 비정상 상태. 역할: fallback 자료의 동기화를 막는다. 예시: pytest -k success_code."""
    # 변수 의미: 전체 조회 모듈과 잘못된 성공 코드 응답이다.
    module = catalog_module()
    payload = page([], 0)
    payload["response"]["header"]["resultCode"] = "sensitive-marker"
    with patch.object(module, "read_payload_with_deadline", return_value=payload):
        assert module.fetch_catalog(TourApiClient(""))[1] != "live"
        assert module.fetch_catalog(TourApiClient("test-key"))[1] == "error:upstream_result"


def test_catalog_cancellation_between_pages_discards_partial_result() -> None:
    """입력: 첫 페이지 후 종료 요청. 출력: 취소 상태. 역할: 종료 중 일부 목록을 저장하지 않게 한다. 예시: pytest -k cancellation."""
    # 변수 의미: 조회 모듈과 프로세스 종료를 전달할 이벤트다.
    module = catalog_module()
    stop_event = Event()

    def stop_after_first_page(_request_url: str, _timeout_seconds: float) -> dict[str, Any]:
        """입력: 요청·제한. 출력: 첫 페이지. 역할: 수신 직후 종료 신호를 재현한다. 예시: stop_after_first_page(url, 5)."""
        stop_event.set()
        return page([raw_place(index) for index in range(1, 101)], 101)

    with patch.object(module, "read_payload_with_deadline", side_effect=stop_after_first_page):
        assert module.fetch_catalog(TourApiClient("test-key"), stop_event=stop_event) == ([], "cancelled")
