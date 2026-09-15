# TourAPI 클라이언트의 키 정규화와 응답 처리를 검증한다.
from __future__ import annotations

from pathlib import Path
import json
import sys
import unittest
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


if __name__ == "__main__":
    unittest.main()
