# TourAPI 클라이언트의 키 정규화와 응답 처리를 검증한다.
from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest
from threading import Event
from time import monotonic
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.tourapi.client import (
    TourApiClient,
    map_tourapi_category,
    normalize_service_key,
)


class FakeTourApiResponse:
    """
    입력: JSON 직렬화 가능한 TourAPI 응답 페이로드.
    출력: urlopen context manager처럼 동작하는 가짜 응답.
    역할: 네트워크 호출 없이 TourApiClient의 파싱 흐름을 검증한다.
    호출 예시: response = FakeTourApiResponse({"response": {}})
    """

    def __init__(self, payload: dict) -> None:
        """
        입력: 응답으로 돌려줄 딕셔너리.
        출력: 없음.
        역할: read()에서 반환할 JSON 바이트를 준비한다.
        호출 예시: FakeTourApiResponse(payload)
        """
        # 변수 의미: 가짜 TourAPI JSON 응답 바이트다.
        self.response_body = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "FakeTourApiResponse":
        """
        입력: 없음.
        출력: 현재 가짜 응답 객체.
        역할: with urlopen(...) as response 패턴을 지원한다.
        호출 예시: with FakeTourApiResponse(payload) as response: ...
        """
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        """
        입력: context manager 종료 정보.
        출력: 없음.
        역할: 실제 네트워크 자원 해제 없이 context manager 계약만 맞춘다.
        호출 예시: response.__exit__(None, None, None)
        """
        return None

    def read(self) -> bytes:
        """
        입력: 없음.
        출력: 가짜 TourAPI 응답 바이트.
        역할: urllib 응답 객체의 read()를 대체한다.
        호출 예시: body = response.read()
        """
        return self.response_body


class TourApiClientTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: TourAPI 클라이언트 단위 검증 결과.
    역할: 실제 네트워크 없이 서비스 키와 응답 파싱 정책을 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_tourapi_client
    """

    def test_normalize_service_key_decodes_encoded_public_data_key(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Encoding 키를 넣어도 내부에서는 Decoding 키 형태로 보관하는지 확인한다.
        호출 예시: self.test_normalize_service_key_decodes_encoded_public_data_key()
        """
        self.assertEqual(normalize_service_key("abc%2Bdef%2Fghi%3D"), "abc+def/ghi=")

    def test_map_tourapi_category_maps_official_lcls_codes(self) -> None:
        """
        입력: 공식 lclsSystmCode2 코드표의 대표 신분류 코드.
        출력: Questbook 내부 카테고리 코드와 표시 이름.
        역할: 신분류 전용 응답이 여섯 개 내부 카테고리로 매핑되는지 확인한다.
        호출 예시: self.test_map_tourapi_category_maps_official_lcls_codes()
        """
        # 변수 의미: 공식 신분류 코드와 기대하는 Questbook 카테고리의 대표 사례다.
        category_cases = [
            ("NA", "", "", "nature"),
            ("VE", "VE03", "VE030100", "nature"),
            ("EV", "EV01", "EV010500", "nature"),
            ("EX", "EX05", "EX050700", "nature"),
            ("VE", "VE07", "VE070500", "science"),
            ("VE", "VE02", "VE020500", "science"),
            ("EX", "EX06", "EX060200", "science"),
            ("EX", "EX06", "EX060600", "science"),
            ("EX", "EX06", "EX060700", "science"),
            ("EX", "EX06", "EX060900", "science"),
            ("FD", "", "", "market"),
            ("SH", "", "", "market"),
            ("EV", "EV01", "EV010300", "market"),
            ("EX", "EX06", "EX060300", "market"),
            ("EX", "EX06", "EX060800", "market"),
            ("LS", "", "", "mobility"),
            ("VE", "VE11", "VE110200", "mobility"),
            ("VE", "VE01", "VE010200", "nightview"),
            ("VE", "VE04", "VE040100", "downtown"),
        ]

        # 변수 의미: 한 개 신분류 1·2·3Depth 코드와 기대하는 내부 카테고리 코드다.
        for lcls_one, lcls_two, lcls_three, expected_category_code in category_cases:
            # 변수 의미: 현재 공식 신분류 대표 사례로 구성한 TourAPI 항목이다.
            raw_item = {
                "lclsSystm1": lcls_one,
                "lclsSystm2": lcls_two,
                "lclsSystm3": lcls_three,
                "title": "분류 테스트 장소",
            }
            with self.subTest(raw_item=raw_item):
                # 변수 의미: 신분류 입력을 변환한 실제 내부 카테고리 코드다.
                actual_category_code, _category_name = map_tourapi_category(raw_item)
                self.assertEqual(actual_category_code, expected_category_code)

    def test_map_tourapi_category_prefers_lcls_over_legacy_categories(self) -> None:
        """
        입력: 서로 다른 의미의 신분류와 구분류를 함께 가진 TourAPI 항목.
        출력: 신분류를 기준으로 결정된 내부 카테고리.
        역할: 과도기 동시 응답에서 cat1/2/3가 신분류를 덮어쓰지 않는지 확인한다.
        호출 예시: self.test_map_tourapi_category_prefers_lcls_over_legacy_categories()
        """
        # 변수 의미: 음식 신분류와 과학 구분류가 충돌하는 TourAPI 항목이다.
        raw_item = {
            "lclsSystm1": "FD",
            "lclsSystm2": "FD01",
            "lclsSystm3": "FD010100",
            "cat1": "A02",
            "cat2": "A0206",
            "cat3": "A02060100",
            "title": "분류 테스트 장소",
        }

        # 변수 의미: 충돌하는 분류를 변환한 실제 내부 카테고리 코드다.
        category_code, _category_name = map_tourapi_category(raw_item)

        self.assertEqual(category_code, "market")

    def test_map_tourapi_category_uses_legacy_cat3_when_lcls_is_empty(self) -> None:
        """
        입력: 신분류 값은 비어 있고 cat3만 채워진 구형 TourAPI 항목.
        출력: 구분류를 기준으로 결정된 내부 카테고리.
        역할: 신분류가 없을 때 cat1/2/3 fallback이 유지되는지 확인한다.
        호출 예시: self.test_map_tourapi_category_uses_legacy_cat3_when_lcls_is_empty()
        """
        # 변수 의미: 서로 다른 빈 값 형태와 레저스포츠 cat3를 가진 TourAPI 항목이다.
        raw_item = {
            "lclsSystm1": "",
            "lclsSystm2": None,
            "lclsSystm3": "   ",
            "cat3": "A03020700",
            "title": "분류 테스트 장소",
        }

        # 변수 의미: 구분류 fallback으로 변환한 실제 내부 카테고리 코드다.
        category_code, _category_name = map_tourapi_category(raw_item)

        self.assertEqual(category_code, "mobility")

    def test_map_tourapi_category_reads_each_legacy_category_depth(self) -> None:
        """
        입력: 신분류 없이 cat1, cat2, cat3 중 하나만 가진 구형 TourAPI 항목.
        출력: 각 구분류 Depth를 기준으로 결정된 내부 카테고리.
        역할: 세 구분류 필드가 모두 과도기 fallback 입력으로 유지되는지 확인한다.
        호출 예시: self.test_map_tourapi_category_reads_each_legacy_category_depth()
        """
        # 변수 의미: 구분류 필드별 대표 코드와 기대하는 내부 카테고리 사례다.
        legacy_cases = [
            ("cat1", "A01", "nature"),
            ("cat2", "A0206", "science"),
            ("cat3", "A05020900", "market"),
        ]

        # 변수 의미: 현재 검사할 구분류 필드 이름, 값, 기대 카테고리다.
        for field_name, field_value, expected_category_code in legacy_cases:
            # 변수 의미: 한 개 구분류 Depth만 가진 TourAPI 항목이다.
            raw_item = {field_name: field_value, "title": "분류 테스트 장소"}
            with self.subTest(field_name=field_name):
                # 변수 의미: 구분류 입력을 변환한 실제 내부 카테고리 코드다.
                actual_category_code, _category_name = map_tourapi_category(raw_item)
                self.assertEqual(actual_category_code, expected_category_code)

    def test_map_tourapi_category_preserves_legacy_code_and_title_priority(self) -> None:
        """
        입력: 구분류 코드와 더 높은 기존 우선순위의 제목 키워드가 충돌하는 항목.
        출력: 변경 전 TourAPI 매핑 순서와 같은 내부 카테고리.
        역할: 신분류 migration이 구분류-only 항목의 기존 분류 결과를 바꾸지 않는지 확인한다.
        호출 예시: self.test_map_tourapi_category_preserves_legacy_code_and_title_priority()
        """
        # 변수 의미: 기존 분류 순서를 보존해야 하는 코드·제목 충돌 사례다.
        legacy_priority_cases = [
            ({"cat1": "A02", "title": "성심당 본점"}, "market"),
            ({"cat1": "A01", "title": "보문산 전망대"}, "nightview"),
        ]

        # 변수 의미: 현재 검사할 구분류 충돌 항목과 기존 기대 카테고리다.
        for raw_item, expected_category_code in legacy_priority_cases:
            with self.subTest(raw_item=raw_item):
                # 변수 의미: 구분류 충돌 항목을 변환한 실제 내부 카테고리 코드다.
                actual_category_code, _category_name = map_tourapi_category(raw_item)
                self.assertEqual(actual_category_code, expected_category_code)

    def test_map_tourapi_category_does_not_fallback_for_unknown_lcls_code(self) -> None:
        """
        입력: 미등록 신분류 코드와 유효한 구분류가 함께 있는 TourAPI 항목.
        출력: 제목 기본 규칙으로 결정된 내부 카테고리.
        역할: 신분류 값이 존재하면 미등록 코드여도 구분류를 사용하지 않는지 확인한다.
        호출 예시: self.test_map_tourapi_category_does_not_fallback_for_unknown_lcls_code()
        """
        # 변수 의미: 미등록 신분류와 과학 구분류가 함께 있는 TourAPI 항목이다.
        raw_item = {
            "lclsSystm1": "ZZ",
            "lclsSystm2": "ZZ99",
            "lclsSystm3": "ZZ999999",
            "cat1": "A02",
            "cat2": "A0206",
            "cat3": "A02060100",
            "title": "미등록 분류 장소",
        }

        # 변수 의미: 미등록 신분류 입력을 변환한 실제 내부 카테고리 코드다.
        category_code, _category_name = map_tourapi_category(raw_item)

        self.assertEqual(category_code, "downtown")

    def test_map_tourapi_category_does_not_prefix_match_fixed_lcls_leaf_codes(self) -> None:
        """
        입력: 공식 3Depth 고정 코드 뒤에 문자가 추가된 미등록 신분류 값.
        출력: 공식 고정 코드 카테고리가 아닌 기본 내부 카테고리.
        역할: 3Depth leaf 코드를 branch 접두사처럼 과잉 매칭하지 않는지 확인한다.
        호출 예시: self.test_map_tourapi_category_does_not_prefix_match_fixed_lcls_leaf_codes()
        """
        # 변수 의미: Questbook이 exact match로만 인정해야 하는 공식 3Depth 코드다.
        fixed_leaf_codes = [
            "VE010200",
            "VE020500",
            "EX060200",
            "EX060600",
            "EX060700",
            "EX060900",
            "EV010500",
            "EX050700",
            "EV010300",
            "EX060300",
            "EX060800",
        ]

        # 변수 의미: 뒤에 문자를 붙여 미등록 값으로 만든 공식 3Depth 코드다.
        for fixed_leaf_code in fixed_leaf_codes:
            # 변수 의미: 미등록 3Depth 코드만 가진 TourAPI 항목이다.
            raw_item = {
                "lclsSystm3": f"{fixed_leaf_code}X",
                "title": "미등록 분류 장소",
            }
            with self.subTest(raw_item=raw_item):
                # 변수 의미: 미등록 3Depth 입력을 변환한 실제 내부 카테고리 코드다.
                category_code, _category_name = map_tourapi_category(raw_item)
                self.assertEqual(category_code, "downtown")

    def test_fetch_nearby_uses_live_tourapi_payload(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 정상 TourAPI JSON 응답이 live 장소 후보로 변환되는지 확인한다.
        호출 예시: self.test_fetch_nearby_uses_live_tourapi_payload()
        """
        # 변수 의미: urlopen에 전달된 요청 URL 목록이다.
        requested_urls: list[str] = []
        # 변수 의미: 정상 TourAPI 위치 기반 목록 응답이다.
        payload = {
            "response": {
                "header": {"resultCode": "0000", "resultMsg": "OK"},
                "body": {
                    "items": {
                        "item": [
                            {
                                "contentid": "12345",
                                "title": "대전 전시 체험 공간",
                                "mapx": "127.3845000",
                                "mapy": "36.3504000",
                                "lclsSystm1": "VE",
                                "lclsSystm2": "VE07",
                                "lclsSystm3": "VE070500",
                            }
                        ]
                    }
                },
            }
        }

        def fake_urlopen(request_url: str, timeout: int) -> FakeTourApiResponse:
            """
            입력: 요청 URL과 제한 시간.
            출력: 정상 TourAPI 가짜 응답.
            역할: 호출 URL을 보관하고 네트워크 호출을 대체한다.
            호출 예시: response = fake_urlopen(url, 5)
            """
            requested_urls.append(request_url)
            return FakeTourApiResponse(payload)

        with patch("questbook_api.integrations.tourapi.client.urlopen", fake_urlopen):
            # 변수 의미: Encoding 키 형태로 주입한 테스트 클라이언트다.
            client = TourApiClient("decoded%2B%2Fkey%3D")
            # 변수 의미: TourAPI 위치 기반 조회 결과와 상태다.
            places, status = client.fetch_nearby(36.3504, 127.3845, "science", 5000)

        # 변수 의미: 실제 요청 URL에서 파싱한 쿼리 파라미터다.
        query = parse_qs(urlparse(requested_urls[0]).query)
        self.assertEqual(query["serviceKey"][0], "decoded+/key=")
        self.assertNotIn("lclsSystm1", query)
        self.assertNotIn("lclsSystm2", query)
        self.assertNotIn("lclsSystm3", query)
        self.assertEqual(status, "live")
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0].content_id, "12345")
        self.assertEqual(places[0].category_code, "science")
        self.assertEqual(places[0].source, "tourapi")

    def test_fetch_nearby_falls_back_on_tourapi_result_code_error(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: HTTP 200이어도 TourAPI resultCode 오류이면 fallback으로 전환하는지 확인한다.
        호출 예시: self.test_fetch_nearby_falls_back_on_tourapi_result_code_error()
        """
        # 변수 의미: 오류 resultCode를 담은 TourAPI 응답이다.
        payload = {"response": {"header": {"resultCode": "30", "resultMsg": "SERVICE KEY IS NOT REGISTERED"}}}

        with patch("questbook_api.integrations.tourapi.client.urlopen", return_value=FakeTourApiResponse(payload)):
            # 변수 의미: 테스트용 TourAPI 클라이언트다.
            client = TourApiClient("test-key")
            # 변수 의미: 오류 응답 후 fallback된 장소 후보와 상태다.
            places, status = client.fetch_nearby(36.327, 127.427, "all", 5000)

        self.assertEqual(status, "fallback:result_code_30")
        self.assertGreaterEqual(len(places), 1)
        self.assertTrue(all(place.source == "fallback" for place in places))


def daejeon_item(content_id: str, **overrides: object) -> dict:
    """
    입력: 장소 식별자와 덮어쓸 TourAPI 필드.
    출력: 대전 지역 목록 응답에 넣을 가짜 장소 항목.
    역할: 페이지와 잘못된 필드 사례를 실제 키 없이 구성한다.
    호출 예시: item = daejeon_item("100", lclsSystm1="FD")
    """
    return {
        "contentid": content_id,
        "title": f"대전 관광지 {content_id}",
        "mapx": "127.3845",
        "mapy": "36.3504",
        "lclsSystm1": "NA",
        **overrides,
    }


def daejeon_payload(items: object, total_count: int) -> dict:
    """
    입력: 원본 items 필드와 전체 조회 건수.
    출력: 정상 헤더를 가진 TourAPI 가짜 응답.
    역할: 빈 목록과 페이지 목록을 동일한 응답 구조로 만든다.
    호출 예시: payload = daejeon_payload({"item": [daejeon_item("100")]}, 1)
    """
    return {
        "response": {
            "header": {"resultCode": "0000", "resultMsg": "OK"},
            "body": {"items": items, "totalCount": total_count},
        }
    }


class TourApiDaejeonTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 대전 전체 관광지 조회 단위 검증 결과.
    역할: 위치 없이 조회하는 페이지 처리와 정상 빈 결과, 장애 상태를 검증한다.
    호출 예시: uv run --project services/app-api pytest services/app-api/tests/test_tourapi_client.py
    """

    def test_daejeon_uses_area_endpoint_and_multiple_pages_without_distances(self) -> None:
        """
        입력: 중복 장소가 있는 두 페이지의 가짜 응답.
        출력: 없음.
        역할: 대전 지역 조회, 페이지 순회, 중복 제거와 최소 필드 보존을 검증한다.
        호출 예시: self.test_daejeon_uses_area_endpoint_and_multiple_pages_without_distances()
        """
        # 변수 의미: 첫 페이지에 들어갈 서로 다른 100개 관광지다.
        first_items = [daejeon_item(str(index)) for index in range(100)]
        # 변수 의미: 원본 이미지와 주소가 최소 후보에 들어가지 않는지 검사할 두 번째 페이지다.
        second_items = [daejeon_item("0"), daejeon_item("100", firstimage="private-image", addr1="원본 주소")]
        with patch(
            "questbook_api.integrations.tourapi.client.urlopen",
            side_effect=[
                FakeTourApiResponse(daejeon_payload({"item": first_items}, 102)),
                FakeTourApiResponse(daejeon_payload({"item": second_items}, 102)),
            ],
        ) as mocked_urlopen:
            # 변수 의미: 실제 키 대신 고정 테스트 키를 사용하는 클라이언트다.
            client = TourApiClient("test-key")
            # 변수 의미: 대전 전체 조회 결과와 원천 상태다.
            places, status = client.fetch_daejeon()
        self.assertEqual(status, "live")
        self.assertEqual(len(places), 101)
        self.assertEqual(len({place.content_id for place in places}), 101)
        self.assertTrue(all(place.distance_meters is None for place in places))
        self.assertEqual(client.status()["dailyCallCount"], 2)
        # 변수 의미: 순서대로 수행한 페이지 호출과 1부터 시작하는 페이지 번호다.
        for page_number, request_call in enumerate(mocked_urlopen.call_args_list, 1):
            # 변수 의미: 네트워크 호출에 전달된 요청 URL과 쿼리다.
            request_url = urlparse(request_call.args[0])
            query = parse_qs(request_url.query)
            self.assertEqual(request_url.path, "/B551011/KorService2/areaBasedList2")
            self.assertEqual(query["areaCode"], ["3"])
            self.assertEqual(query["numOfRows"], ["100"])
            self.assertEqual(query["pageNo"], [str(page_number)])
            self.assertFalse({"mapX", "mapY", "radius", "lclsSystm1", "cat1"} & query.keys())
            self.assertLessEqual(request_call.kwargs["timeout"], 5)
        self.assertEqual(
            set(places[-1].to_public_dict()),
            {"contentId", "title", "latitude", "longitude", "categoryCode", "categoryName", "summary", "distanceMeters", "source"},
        )

    def test_daejeon_filter_keeps_lcls_priority_and_never_substitutes_other_categories(self) -> None:
        """
        입력: 음식 신분류와 과학 구분류가 충돌하는 장소.
        출력: 없음.
        역할: 신분류 우선순위를 유지하고 필터 불일치에 빈 목록을 반환하는지 확인한다.
        호출 예시: self.test_daejeon_filter_keeps_lcls_priority_and_never_substitutes_other_categories()
        """
        # 변수 의미: 신분류로는 지역 상권에 해당하는 정상 응답이다.
        payload = daejeon_payload({"item": daejeon_item("100", lclsSystm1="FD", cat1="A02")}, 1)
        # 변수 의미: 선택 카테고리와 기대하는 결과 건수다.
        for category_key, expected_count in [("science", 0), ("market", 1), ("unsupported", 0)]:
            with self.subTest(category=category_key), patch(
                "questbook_api.integrations.tourapi.client.urlopen", return_value=FakeTourApiResponse(payload)
            ):
                # 변수 의미: 명시적 카테고리로 조회한 장소와 원천 상태다.
                places, status = TourApiClient("test-key").fetch_daejeon(category_key)
                self.assertEqual(status, "live")
                self.assertEqual(len(places), expected_count)

    def test_daejeon_successful_empty_items_stay_live(self) -> None:
        """
        입력: TourAPI가 사용하는 여러 빈 items 형태.
        출력: 없음.
        역할: 정상 빈 응답을 fallback 예시 관광지로 대체하지 않는지 확인한다.
        호출 예시: self.test_daejeon_successful_empty_items_stay_live()
        """
        # 변수 의미: 응답에 등장할 수 있는 빈 항목 표현이다.
        for empty_items in ["", None, {}, {"item": []}, {"item": None}, {"item": ""}]:
            with self.subTest(items=empty_items), patch(
                "questbook_api.integrations.tourapi.client.urlopen",
                return_value=FakeTourApiResponse(daejeon_payload(empty_items, 0)),
            ) as mocked_urlopen:
                self.assertEqual(TourApiClient("test-key").fetch_daejeon(), ([], "live"))
                self.assertEqual(mocked_urlopen.call_count, 1)

    def test_daejeon_page_limit_returns_partial_results(self) -> None:
        """
        입력: 600개 중 동일 항목이 반복되는 페이지 응답.
        출력: 없음.
        역할: 최대 5번만 요청하고 일부 수집 상태와 중복 제거 결과를 제공한다.
        호출 예시: self.test_daejeon_page_limit_returns_partial_results()
        """
        # 변수 의미: 계속 다음 페이지가 남아 있는 응답이다.
        payload = daejeon_payload({"item": [daejeon_item("100")] * 100}, 600)
        with patch(
            "questbook_api.integrations.tourapi.client.urlopen", return_value=FakeTourApiResponse(payload)
        ) as mocked_urlopen:
            # 변수 의미: 제한된 페이지 처리 결과와 상태다.
            places, status = TourApiClient("test-key").fetch_daejeon()
        self.assertEqual(status, "live:partial")
        self.assertEqual(len(places), 1)
        self.assertEqual(mocked_urlopen.call_count, 5)

    def test_daejeon_time_budget_limits_remaining_call_timeout(self) -> None:
        """
        입력: 첫 페이지 조회 후 총 시간 예산이 거의 소진된 시각.
        출력: 없음.
        역할: 후속 요청 제한 시간을 남은 총 예산으로 줄이고 예산 소진 시 종료한다.
        호출 예시: self.test_daejeon_time_budget_limits_remaining_call_timeout()
        """
        # 변수 의미: 다음 페이지가 남아 있는 정상 응답이다.
        payload = daejeon_payload({"item": [daejeon_item("100")] * 100}, 600)
        with patch(
            "questbook_api.integrations.tourapi.client.urlopen", return_value=FakeTourApiResponse(payload)
        ) as mocked_urlopen, patch(
            "questbook_api.integrations.tourapi.client.monotonic", side_effect=[0.0, 0.0, 7.0, 7.6]
        ):
            # 변수 의미: 제한된 총 대기 시간으로 수집한 후보와 상태다.
            places, status = TourApiClient("test-key").fetch_daejeon()
        self.assertEqual(status, "live:partial")
        self.assertEqual(len(places), 1)
        self.assertEqual(mocked_urlopen.call_count, 2)
        self.assertLessEqual(mocked_urlopen.call_args_list[1].kwargs["timeout"], 0.5)

    def test_daejeon_later_failure_keeps_live_candidates_and_strict_filter(self) -> None:
        """
        입력: 정상 첫 페이지 이후 실패하는 두 번째 요청.
        출력: 없음.
        역할: 수집한 실제 장소를 보존하고 필터 불일치여도 partial 상태를 유지한다.
        호출 예시: self.test_daejeon_later_failure_keeps_live_candidates_and_strict_filter()
        """
        # 변수 의미: 다음 페이지가 존재하는 자연 테마 첫 응답이다.
        payload = daejeon_payload({"item": [daejeon_item("100")] * 100}, 101)
        # 변수 의미: 선택 카테고리와 부분 수집 결과의 기대 건수다.
        for category_key, expected_count in [("all", 1), ("science", 0)]:
            with self.subTest(category=category_key), patch(
                "questbook_api.integrations.tourapi.client.urlopen",
                side_effect=[FakeTourApiResponse(payload), URLError("temporary failure")],
            ):
                # 변수 의미: 부분 조회 결과와 원천 상태다.
                places, status = TourApiClient("test-key").fetch_daejeon(category_key)
                self.assertEqual(status, "live:partial")
                self.assertEqual(len(places), expected_count)
                self.assertTrue(all(place.source == "tourapi" for place in places))

    def test_daejeon_slow_response_body_cannot_exceed_total_wait_budget(self) -> None:
        """
        입력: 소켓 연결 이후 본문 반환이 지연되는 외부 응답.
        출력: 없음.
        역할: 개별 소켓 제한과 별도로 전체 응답 대기 시간을 제한하는지 확인한다.
        호출 예시: self.test_daejeon_slow_response_body_cannot_exceed_total_wait_budget()
        """
        # 변수 의미: 테스트 종료 시 지연 중인 가짜 응답 작업을 해제하는 신호다.
        release_response = Event()
        # 변수 의미: 본문 반환을 지연시킬 정상 응답이다.
        response = FakeTourApiResponse(daejeon_payload({"item": daejeon_item("100")}, 1))

        def delayed_read() -> bytes:
            """
            입력: 없음.
            출력: 해제 신호 이후 반환하는 정상 JSON 바이트.
            역할: 총 예산보다 오래 걸리는 본문 수신을 재현한다.
            호출 예시: body = delayed_read()
            """
            release_response.wait(timeout=0.3)
            return response.response_body

        try:
            with patch("questbook_api.integrations.tourapi.client.urlopen", return_value=response), patch.object(
                response, "read", delayed_read
            ), patch("questbook_api.integrations.tourapi.client.DAEJEON_FETCH_BUDGET_SECONDS", 0.02):
                # 변수 의미: 실제 경과 시간을 측정하기 위한 단조 시계 시작 시각이다.
                started_at = monotonic()
                # 변수 의미: 원천 전체 대기 시간 제한을 적용한 결과와 상태다.
                places, status = TourApiClient("test-key").fetch_daejeon()
                self.assertLess(monotonic() - started_at, 0.15)
                self.assertEqual(status, "fallback:upstream_error")
                self.assertTrue(all(place.source == "fallback" for place in places))
        finally:
            release_response.set()

    def test_daejeon_initial_failure_reports_fallback_and_opens_circuit(self) -> None:
        """
        입력: 처음부터 실패하는 외부 요청과 연속된 사용자 조회.
        출력: 없음.
        역할: 장애 예시 데이터 출처를 표시하고 기존 서킷 차단을 적용한다.
        호출 예시: self.test_daejeon_initial_failure_reports_fallback_and_opens_circuit()
        """
        # 변수 의미: 호출 간 실패 카운터를 공유하는 테스트 클라이언트다.
        client = TourApiClient("test-key")
        with patch("questbook_api.integrations.tourapi.client.urlopen", side_effect=URLError("failure")) as mocked_urlopen:
            # 변수 의미: 서킷 임계까지 발생시키는 세 번의 사용자 요청이다.
            for _attempt in range(3):
                # 변수 의미: 장애 후 반환한 예시 장소와 상태다.
                places, status = client.fetch_daejeon("science")
                self.assertEqual(status, "fallback:upstream_error")
                self.assertTrue(all(place.source == "fallback" and place.category_code == "science" for place in places))
                self.assertTrue(all(place.distance_meters is None for place in places))
            self.assertEqual(client.fetch_daejeon()[1], "fallback:circuit_open")
        self.assertEqual(mocked_urlopen.call_count, 3)

    def test_daejeon_missing_key_and_result_errors_are_honest(self) -> None:
        """
        입력: 미설정 키, API 오류 헤더와 HTTP 403 응답.
        출력: 없음.
        역할: 조회 불가 원인별 상태를 유지하고 예시 장소에 거리를 붙이지 않는다.
        호출 예시: self.test_daejeon_missing_key_and_result_errors_are_honest()
        """
        with patch("questbook_api.integrations.tourapi.client.urlopen") as mocked_urlopen:
            # 변수 의미: API 키 미설정 상태의 장소와 출처다.
            places, status = TourApiClient("").fetch_daejeon()
        mocked_urlopen.assert_not_called()
        self.assertEqual(status, "fallback:not_configured")
        self.assertEqual(len(places), 6)
        self.assertTrue(all(place.distance_meters is None for place in places))
        # 변수 의미: 반환 상태가 달라야 하는 API 헤더 오류와 HTTP 오류다.
        error_cases = [
            (FakeTourApiResponse({"response": {"header": {"resultCode": "30"}}}), "fallback:result_code_30"),
            (HTTPError("https://example.test", 403, "Forbidden", None, None), "fallback:upstream_4xx"),
        ]
        # 변수 의미: 현재 검사할 응답 또는 예외와 기대 상태다.
        for response_or_error, expected_status in error_cases:
            with self.subTest(status=expected_status), patch(
                "questbook_api.integrations.tourapi.client.urlopen", side_effect=[response_or_error]
            ):
                self.assertEqual(TourApiClient("test-key").fetch_daejeon()[1], expected_status)

    def test_daejeon_skips_missing_nonfinite_and_out_of_range_place_fields(self) -> None:
        """
        입력: 빈 필드, 비유한 좌표, 범위 밖 좌표를 포함한 관광지 목록.
        출력: 없음.
        역할: 잘못된 항목만 제외하고 유효 후보의 최소 필드만 보존한다.
        호출 예시: self.test_daejeon_skips_missing_nonfinite_and_out_of_range_place_fields()
        """
        # 변수 의미: 파싱 단계에서 안전하게 건너뛰어야 하는 관광지다.
        malformed_items = [
            None, "", daejeon_item("missing", mapx=None),
            daejeon_item("nan", mapy="nan"), daejeon_item("inf", mapx="inf"),
            daejeon_item("latitude", mapy=91), daejeon_item("longitude", mapx=181),
            daejeon_item("null-title", title=None), daejeon_item("null-id", contentid=None),
            daejeon_item("blank-title", title="  "), daejeon_item("valid"),
        ]
        with patch(
            "questbook_api.integrations.tourapi.client.urlopen",
            return_value=FakeTourApiResponse(daejeon_payload({"item": malformed_items}, len(malformed_items))),
        ):
            # 변수 의미: 유효성 검사를 통과한 후보와 상태다.
            places, status = TourApiClient("test-key").fetch_daejeon()
        self.assertEqual(status, "live")
        self.assertEqual([place.content_id for place in places], ["valid"])

    def test_daejeon_malformed_envelopes_report_upstream_error(self) -> None:
        """
        입력: 객체가 아니거나 응답 본문 구조가 잘못된 JSON 페이로드.
        출력: 없음.
        역할: 잘못된 원천 응답이 서버 오류로 전파되거나 정상 빈 목록으로 위장하지 않게 한다.
        호출 예시: self.test_daejeon_malformed_envelopes_report_upstream_error()
        """
        # 변수 의미: 정상 성공 응답으로 간주할 수 없는 페이로드다.
        for payload in [
            None, [], {}, {"response": None}, {"response": {"body": []}},
            {"response": {"header": {"resultCode": "0000"}}},
            daejeon_payload({"item": 3}, 1),
            daejeon_payload({"item": []}, float("inf")),
        ]:
            with self.subTest(payload=payload), patch(
                "questbook_api.integrations.tourapi.client.urlopen", return_value=FakeTourApiResponse(payload)
            ):
                self.assertEqual(TourApiClient("test-key").fetch_daejeon()[1], "fallback:upstream_error")


if __name__ == "__main__":
    unittest.main()
