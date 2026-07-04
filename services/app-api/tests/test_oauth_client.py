# Questbook OAuth provider 클라이언트의 URL 구성과 응답 정규화를 검증한다.
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.oauth import client


class FakeHttpResponse:
    """
    입력: 응답으로 돌려줄 딕셔너리.
    출력: urlopen 컨텍스트 매니저를 흉내 내는 객체.
    역할: 실제 HTTP 없이 토큰·프로필 응답을 주입한다.
    호출 예시: FakeHttpResponse({"access_token": "x"})
    """

    def __init__(self, payload: dict[str, object]) -> None:
        """
        입력: 응답 JSON으로 만들 payload.
        출력: 없음.
        역할: 테스트 응답 바이트를 준비한다.
        호출 예시: response = FakeHttpResponse({"ok": True})
        """
        # 변수 의미: JSON 응답 바이트다.
        self._data = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        """
        입력: 없음.
        출력: 응답 본문 바이트.
        역할: urllib 응답 객체의 read를 흉내 낸다.
        호출 예시: data = response.read()
        """
        return self._data

    def __enter__(self) -> "FakeHttpResponse":
        """
        입력: 없음.
        출력: 현재 테스트 응답 객체.
        역할: 컨텍스트 매니저 진입을 지원한다.
        호출 예시: with FakeHttpResponse({}) as response: ...
        """
        return self

    def __exit__(self, *_args: object) -> bool:
        """
        입력: 컨텍스트 매니저 종료 인자.
        출력: 예외 전파 여부.
        역할: 예외를 삼키지 않는다.
        호출 예시: response.__exit__(None, None, None)
        """
        return False


class CapturingUrlopen:
    """
    입력: 응답 payload.
    출력: urlopen 대체 callable.
    역할: 실제 HTTP 없이 요청 본문과 응답을 함께 검증한다.
    호출 예시: opener = CapturingUrlopen({"access_token": "x"})
    """

    def __init__(self, payload: dict[str, object]) -> None:
        """
        입력: 응답 JSON으로 만들 payload.
        출력: 없음.
        역할: 테스트 응답과 마지막 요청 정보를 준비한다.
        호출 예시: opener = CapturingUrlopen({"access_token": "x"})
        """
        # 변수 의미: 반환할 fake HTTP 응답이다.
        self.response = FakeHttpResponse(payload)
        # 변수 의미: 마지막으로 받은 urllib Request 객체다.
        self.request = None

    def __call__(self, request, timeout: int) -> FakeHttpResponse:
        """
        입력: urllib Request와 timeout.
        출력: fake HTTP 응답.
        역할: urlopen 호출을 기록하고 준비된 응답을 반환한다.
        호출 예시: response = opener(request, timeout=8)
        """
        self.request = request
        return self.response


class OAuthClientTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: OAuth provider client 검증 결과.
    역할: 인가 URL과 provider 응답 정규화를 확인한다.
    호출 예시: uv run pytest tests/test_oauth_client.py
    """

    def test_build_authorize_url_includes_required_params(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Google 인가 URL에 필수 파라미터와 scope가 들어가는지 확인한다.
        호출 예시: self.test_build_authorize_url_includes_required_params()
        """
        # 변수 의미: 테스트용 Google 인가 URL이다.
        url = client.build_authorize_url("google", "cid", "state-123", "http://localhost:8000/api/auth/google/callback")
        # 변수 의미: 인가 URL 쿼리 파라미터다.
        query = parse_qs(urlparse(url).query)

        self.assertEqual(query["response_type"], ["code"])
        self.assertEqual(query["client_id"], ["cid"])
        self.assertEqual(query["state"], ["state-123"])
        self.assertEqual(query["redirect_uri"], ["http://localhost:8000/api/auth/google/callback"])
        self.assertIn("scope", query)

    def test_naver_profile_is_normalized(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 네이버 response 래핑 구조를 공통 프로필로 변환하는지 확인한다.
        호출 예시: self.test_naver_profile_is_normalized()
        """
        with patch.object(
            client,
            "urlopen",
            return_value=FakeHttpResponse({"response": {"id": "naver-1", "email": "a@b.com", "nickname": "탐험가"}}),
        ):
            # 변수 의미: 정규화된 네이버 프로필이다.
            profile = client.fetch_profile("naver", "token")

        self.assertEqual(profile["provider_user_id"], "naver-1")
        self.assertEqual(profile["email"], "a@b.com")
        self.assertEqual(profile["display_name"], "탐험가")

    def test_google_profile_is_normalized(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Google userinfo 응답을 공통 프로필로 변환하는지 확인한다.
        호출 예시: self.test_google_profile_is_normalized()
        """
        with patch.object(
            client,
            "urlopen",
            return_value=FakeHttpResponse({"sub": "google-1", "email": "g@example.com", "name": "Explorer"}),
        ):
            # 변수 의미: 정규화된 Google 프로필이다.
            profile = client.fetch_profile("google", "token")

        self.assertEqual(profile["provider_user_id"], "google-1")
        self.assertEqual(profile["email"], "g@example.com")
        self.assertEqual(profile["display_name"], "Explorer")

    def test_exchange_code_requires_access_token(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 토큰 교환 응답에 access_token이 없으면 실패하는지 확인한다.
        호출 예시: self.test_exchange_code_requires_access_token()
        """
        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"error": "invalid_grant"})):
            with self.assertRaises(ValueError):
                client.exchange_code("google", "cid", "secret", "code", "state", "http://localhost:8000/cb")

    def test_exchange_code_rejects_null_access_token(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: null access_token이 문자열 "None"으로 통과하지 않는지 확인한다.
        호출 예시: self.test_exchange_code_rejects_null_access_token()
        """
        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"access_token": None, "token_type": "Bearer"})):
            with self.assertRaises(ValueError):
                client.exchange_code("naver", "cid", "secret", "code", "state", "http://localhost:8000/cb")

    def test_exchange_code_uses_provider_specific_token_params(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: Google token POST에는 state를 보내지 않고 redirect_uri를 보내는지 확인한다.
        호출 예시: self.test_exchange_code_uses_provider_specific_token_params()
        """
        # 변수 의미: 요청 정보를 기록하는 fake urlopen이다.
        opener = CapturingUrlopen({
            "access_token": "token",
            "token_type": "Bearer",
            "scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        })
        with patch.object(client, "urlopen", side_effect=opener):
            token = client.exchange_code("google", "cid", "secret", "code", "state", "http://localhost:8000/cb")

        self.assertEqual(token, "token")
        self.assertIsNotNone(opener.request)
        # 변수 의미: token POST 요청 본문 파라미터다.
        body = parse_qs(opener.request.data.decode("utf-8"))
        self.assertEqual(body["redirect_uri"], ["http://localhost:8000/cb"])
        self.assertNotIn("state", body)

    def test_exchange_code_rejects_non_bearer_token(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: token_type이 Bearer가 아니면 거부하는지 확인한다.
        호출 예시: self.test_exchange_code_rejects_non_bearer_token()
        """
        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"access_token": "token", "token_type": "mac"})):
            with self.assertRaises(ValueError):
                client.exchange_code("google", "cid", "secret", "code", "state", "http://localhost:8000/cb")

    def test_profiles_require_provider_identifier(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: provider 프로필의 필수 식별자가 없으면 실패하는지 확인한다.
        호출 예시: self.test_profiles_require_provider_identifier()
        """
        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"response": {"email": "a@b.com"}})):
            with self.assertRaises(ValueError):
                client.fetch_profile("naver", "token")

        with patch.object(client, "urlopen", return_value=FakeHttpResponse({"sub": None, "email": "g@example.com"})):
            with self.assertRaises(ValueError):
                client.fetch_profile("google", "token")


if __name__ == "__main__":
    unittest.main()
