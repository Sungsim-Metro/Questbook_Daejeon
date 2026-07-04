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

from questbook_api.integrations.tourapi.client import TourApiClient, normalize_service_key


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
                                "title": "대전 과학관",
                                "mapx": "127.3845000",
                                "mapy": "36.3504000",
                                "cat1": "A02",
                                "cat2": "",
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
