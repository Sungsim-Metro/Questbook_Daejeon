# Questbook NCP CLOVA OCR 클라이언트의 요청과 응답 파싱을 검증한다.
from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.ocr.client import OcrClient, normalize_ocr_image_format  # noqa: E402
from questbook_api.settings import AppSettings  # noqa: E402


class FakeOcrResponse:
    """
    입력: OCR 응답 payload와 상태 코드.
    출력: urlopen 컨텍스트 매니저 대역.
    역할: 외부 네트워크 호출 없이 OCR 클라이언트 파싱을 검증한다.
    호출 예시: response = FakeOcrResponse({"images": []})
    """

    def __init__(self, payload: dict[str, object], status: int = 200) -> None:
        """
        입력: OCR 응답 payload와 상태 코드.
        출력: 없음.
        역할: 테스트 응답 본문과 HTTP 상태를 보관한다.
        호출 예시: response = FakeOcrResponse(payload)
        """
        # 변수 의미: OCR 응답 본문 바이트 스트림이다.
        self.body = BytesIO(json.dumps(payload).encode("utf-8"))
        # 변수 의미: OCR 응답 HTTP 상태 코드다.
        self.status = status

    def __enter__(self) -> "FakeOcrResponse":
        """
        입력: 없음.
        출력: 컨텍스트 매니저 자신.
        역할: urlopen with 블록을 흉내 낸다.
        호출 예시: with response as opened: ...
        """
        return self

    def __exit__(self, *_args: object) -> bool:
        """
        입력: 예외 정보.
        출력: 예외 전파 여부.
        역할: 테스트 예외를 삼키지 않는다.
        호출 예시: response.__exit__(None, None, None)
        """
        return False

    def read(self) -> bytes:
        """
        입력: 없음.
        출력: 응답 본문 바이트.
        역할: urllib 응답 객체의 read 메서드를 흉내 낸다.
        호출 예시: body = response.read()
        """
        return self.body.read()


class OcrClientTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: OCR 클라이언트 검증 결과.
    역할: CLOVA OCR 요청 형식과 텍스트 추출 로직을 확인한다.
    호출 예시: uv run pytest tests/test_ocr_client.py
    """

    def _settings(self) -> AppSettings:
        """
        입력: 없음.
        출력: 테스트용 앱 설정.
        역할: OCR 클라이언트에 필요한 최소 설정을 제공한다.
        호출 예시: settings = self._settings()
        """
        return AppSettings(
            host="127.0.0.1",
            port=8100,
            database_url="postgresql://example",
            redis_url="redis://example",
            cache_ttl_seconds=1800,
            tourapi_service_key="",
            naver_maps_key_id="",
            naver_maps_key="",
            gemini_api_key="",
            jwt_secret="x" * 48,
            public_base_url="http://localhost:8000",
            naver_oauth_client_id="",
            naver_oauth_client_secret="",
            google_oauth_client_id="",
            google_oauth_client_secret="",
            ocr_invoke_url="https://example.com/ocr",
            ocr_secret_key="ocr-secret",
        )

    def test_normalizes_image_format(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Content-Type과 객체 키에서 OCR format 값을 정규화한다.
        호출 예시: self.test_normalizes_image_format()
        """
        self.assertEqual(normalize_ocr_image_format("image/jpeg"), "jpg")
        self.assertEqual(normalize_ocr_image_format("users/u/receipt.PNG"), "png")

    def test_extract_text_from_url_uses_clova_request_shape(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OCR 요청 헤더와 본문, 응답 텍스트 추출을 확인한다.
        호출 예시: self.test_extract_text_from_url_uses_clova_request_shape()
        """
        # 변수 의미: OCR API가 반환할 테스트 응답이다.
        response_payload = {
            "images": [
                {
                    "fields": [
                        {"inferText": "성심당 본점"},
                        {"inferText": "튀김 소보로"},
                    ]
                }
            ]
        }
        # 변수 의미: urlopen에 전달된 요청 객체를 보관할 목록이다.
        captured_requests = []

        def fake_urlopen(request: object, timeout: int) -> FakeOcrResponse:
            """
            입력: urllib 요청 객체와 제한 시간.
            출력: 가짜 OCR 응답.
            역할: 실제 네트워크 호출 없이 요청 내용을 기록한다.
            호출 예시: response = fake_urlopen(request, 8)
            """
            captured_requests.append((request, timeout))
            return FakeOcrResponse(response_payload)

        with patch("questbook_api.integrations.ocr.client.urlopen", side_effect=fake_urlopen):
            # 변수 의미: 테스트 대상 OCR 클라이언트다.
            client = OcrClient(self._settings())
            # 변수 의미: OCR 텍스트 추출 결과다.
            result = client.extract_text_from_url("https://example.com/private.jpg", "image/jpeg")

        self.assertEqual(result["text"], "성심당 본점\n튀김 소보로")
        self.assertEqual(result["lines"], ["성심당 본점", "튀김 소보로"])
        self.assertEqual(captured_requests[0][1], 8)
        self.assertEqual(captured_requests[0][0].headers["X-ocr-secret"], "ocr-secret")


if __name__ == "__main__":
    unittest.main()
