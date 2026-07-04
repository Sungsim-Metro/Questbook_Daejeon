# Questbook OAuth start/callback HTTP 라우트를 검증한다.
from __future__ import annotations

from dataclasses import dataclass, field
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import re
import sys
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote, urlparse
from urllib.request import Request, urlopen


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.domain.auth.tokens import verify_access_token
from questbook_api.server import AppState, create_handler
from questbook_api.settings import AppSettings


@dataclass
class FakeOAuthStateStore:
    """
    입력: 없음.
    출력: OAuth state 저장소 fake 객체.
    역할: 실제 Redis 없이 state 발급과 단회 소비를 검증한다.
    호출 예시: state_store = FakeOAuthStateStore()
    """

    # 변수 의미: 발급한 state의 저장 payload다.
    payloads: dict[str, dict[str, object]] = field(default_factory=dict)
    # 변수 의미: 발급한 앱 토큰 교환 코드의 저장 payload다.
    login_codes: dict[str, dict[str, object]] = field(default_factory=dict)

    def issue(
        self,
        provider: str,
        redirect_uri: str,
        consent: dict[str, bool],
        browser_nonce: str = "",
    ) -> str:
        """
        입력: provider, redirect_uri, 동의 정보, 브라우저 nonce.
        출력: 테스트 state 문자열.
        역할: 콜백 테스트에서 소비할 state payload를 저장한다.
        호출 예시: state = store.issue("naver", redirect_uri, consent, browser_nonce)
        """
        # 변수 의미: 테스트용 고정 state 값이다.
        issued_state = f"state-{len(self.payloads) + 1}"
        self.payloads[issued_state] = {
            "provider": provider,
            "redirect_uri": redirect_uri,
            "consent": consent,
            "browser_nonce": browser_nonce,
        }
        return issued_state

    def consume(self, state: str) -> dict[str, object] | None:
        """
        입력: 콜백 state 문자열.
        출력: 저장했던 payload 또는 None.
        역할: 실제 저장소처럼 state를 한 번만 소비한다.
        호출 예시: payload = store.consume("state-1")
        """
        return self.payloads.pop(state, None)

    def issue_login_code(self, user_id: str, provider: str, browser_nonce: str) -> str:
        """
        입력: 사용자 ID, provider 이름, 브라우저 nonce.
        출력: 테스트용 단회 토큰 교환 코드.
        역할: callback 성공 후 프런트가 redeem할 코드를 저장한다.
        호출 예시: code = store.issue_login_code("usr", "naver", nonce)
        """
        # 변수 의미: 테스트용 고정 login code 값이다.
        login_code = f"login-code-{len(self.login_codes) + 1}"
        self.login_codes[login_code] = {"user_id": user_id, "provider": provider, "browser_nonce": browser_nonce}
        return login_code

    def consume_login_code(self, login_code: str) -> dict[str, object] | None:
        """
        입력: 토큰 교환 코드.
        출력: 저장했던 사용자 정보 payload 또는 None.
        역할: 실제 저장소처럼 login code를 한 번만 소비한다.
        호출 예시: payload = store.consume_login_code("login-code-1")
        """
        return self.login_codes.pop(login_code, None)


class FailingRedeemOAuthStateStore(FakeOAuthStateStore):
    """
    입력: 없음.
    출력: redeem 소비 중 실패하는 OAuth state 저장소 fake 객체.
    역할: Redis 장애가 HTTP 503으로 매핑되는지 확인한다.
    호출 예시: state_store = FailingRedeemOAuthStateStore()
    """

    def consume_login_code(self, _login_code: str) -> dict[str, object] | None:
        """
        입력: 토큰 교환 코드.
        출력: 없음.
        역할: Redis 장애 상황의 state 저장소 예외를 흉내 낸다.
        호출 예시: state_store.consume_login_code("code")
        """
        from questbook_api.infrastructure.oauth_state import OAuthStateError

        raise OAuthStateError("oauth_state_unavailable")


@dataclass
class FakeRepository:
    """
    입력: 없음.
    출력: OAuth callback에 필요한 저장소 fake 객체.
    역할: 실제 PostgreSQL 없이 사용자 식별과 동의 저장 호출을 기록한다.
    호출 예시: repository = FakeRepository()
    """

    # 변수 의미: OAuth identity로 찾거나 만든 사용자 ID다.
    user_id: str = "usr_oauth"
    # 변수 의미: 마지막 identity 조회/생성 호출 인자다.
    identity_call: tuple[str, str, str | None, str | None] | None = None
    # 변수 의미: 마지막 동의 저장 호출 인자다.
    consent_call: dict[str, object] | None = None

    def find_or_create_identity(
        self,
        provider: str,
        provider_user_id: str,
        display_name: str | None,
        email: str | None,
    ) -> str:
        """
        입력: provider 신원과 프로필 정보.
        출력: 테스트 사용자 ID.
        역할: callback이 provider 신원으로 사용자를 식별하는지 기록한다.
        호출 예시: user_id = repository.find_or_create_identity("naver", "id", "name", "email")
        """
        self.identity_call = (provider, provider_user_id, display_name, email)
        return self.user_id

    def record_user_consent(
        self,
        user_id: str,
        age_confirmed: bool,
        privacy_consent: bool,
        location_consent: bool,
        consent_version: str,
    ) -> dict[str, object]:
        """
        입력: 사용자 ID와 동의 3항목, 동의 버전.
        출력: 저장된 동의 테스트 payload.
        역할: callback 성공 후 동의가 기록되는지 확인한다.
        호출 예시: consent = repository.record_user_consent("usr", True, True, True, "baseline-2026-07")
        """
        self.consent_call = {
            "user_id": user_id,
            "age_confirmed": age_confirmed,
            "privacy_consent": privacy_consent,
            "location_consent": location_consent,
            "consent_version": consent_version,
        }
        return self.consent_call


def build_test_settings() -> AppSettings:
    """
    입력: 없음.
    출력: OAuth 라우트 테스트용 AppSettings.
    역할: 실제 secret 없이 provider configured 상태를 만든다.
    호출 예시: settings = build_test_settings()
    """
    return AppSettings(
        host="127.0.0.1",
        port=0,
        database_url="postgresql://unused",
        redis_url="redis://unused",
        cache_ttl_seconds=1800,
        tourapi_service_key="",
        naver_maps_key_id="",
        naver_maps_key="",
        gemini_api_key="",
        jwt_secret="test-secret",
        public_base_url="http://localhost:8000",
        naver_oauth_client_id="naver-client",
        naver_oauth_client_secret="naver-secret",
        google_oauth_client_id="google-client",
        google_oauth_client_secret="google-secret",
    )


def fetch_raw(url: str, method: str = "GET", payload: dict[str, object] | None = None) -> tuple[int, str, str]:
    """
    입력: URL, HTTP 메서드, 선택적 JSON 본문.
    출력: HTTP 상태 코드, Content-Type, 응답 본문 문자열.
    역할: 테스트 HTTP 서버에 요청을 보낸다.
    호출 예시: status, content_type, body = fetch_raw(url)
    """
    # 변수 의미: JSON 요청 본문 바이트다.
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    # 변수 의미: HTTP 요청 헤더다.
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    # 변수 의미: HTTP 요청 객체다.
    request = Request(url, data=body, headers=headers, method=method)
    with urlopen(request, timeout=5) as response:
        return response.status, response.headers.get("Content-Type", ""), response.read().decode("utf-8")


def fetch_headers(url: str) -> dict[str, str]:
    """
    입력: URL.
    출력: HTTP 응답 헤더 딕셔너리.
    역할: OAuth callback 응답에 CORS 헤더가 붙지 않는지 확인한다.
    호출 예시: headers = fetch_headers(self.url("/api/auth/google/callback?..."))
    """
    # 변수 의미: HTTP GET 요청 객체다.
    request = Request(url, method="GET")
    with urlopen(request, timeout=5) as response:
        response.read()
        return dict(response.headers.items())


class OAuthRouteTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: OAuth HTTP 라우트 검증 결과.
    역할: start JSON 응답, callback HTML 브리지, state 오류 처리를 확인한다.
    호출 예시: uv run pytest tests/test_oauth_routes.py
    """

    def setUp(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: fake 의존성을 주입한 HTTP 서버를 시작한다.
        호출 예시: self.setUp()
        """
        # 변수 의미: 테스트용 OAuth state 저장소다.
        self.oauth_state = FakeOAuthStateStore()
        # 변수 의미: 테스트용 저장소다.
        self.repository = FakeRepository()
        # 변수 의미: 핸들러가 캡처할 테스트 앱 상태다.
        self.app_state = AppState(
            settings=build_test_settings(),
            repository=self.repository,
            cache=object(),
            service=object(),
            oauth_state=self.oauth_state,
        )
        # 변수 의미: 테스트 HTTP 서버다.
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(self.app_state))
        # 변수 의미: 테스트 HTTP 서버를 실행하는 스레드다.
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트 HTTP 서버를 종료한다.
        호출 예시: self.tearDown()
        """
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def url(self, path: str) -> str:
        """
        입력: 요청 경로.
        출력: 테스트 서버 전체 URL.
        역할: 테스트 서버의 임의 포트를 붙인다.
        호출 예시: url = self.url("/api/auth/providers")
        """
        # 변수 의미: 테스트 서버가 바인드한 포트다.
        port = int(self.server.server_address[1])
        return f"http://127.0.0.1:{port}{path}"

    def test_providers_reflect_oauth_configuration(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: provider 설정 여부가 응답에 반영되는지 확인한다.
        호출 예시: self.test_providers_reflect_oauth_configuration()
        """
        # 변수 의미: provider 목록 응답 본문이다.
        status, _content_type, body = fetch_raw(self.url("/api/auth/providers"))
        # 변수 의미: JSON으로 파싱한 provider 목록 응답이다.
        payload = json.loads(body)

        self.assertEqual(status, 200)
        self.assertEqual({item["id"]: item["configured"] for item in payload["providers"]}, {
            "demo-social": True,
            "naver": True,
            "google": True,
        })

    def test_start_returns_authorize_url_and_stores_state(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OAuth start가 동의를 검증하고 인가 URL을 반환하는지 확인한다.
        호출 예시: self.test_start_returns_authorize_url_and_stores_state()
        """
        # 변수 의미: OAuth start 응답 본문이다.
        _status, _content_type, body = fetch_raw(
            self.url("/api/auth/naver/start"),
            method="POST",
            payload={
                "ageConfirmed": True,
                "privacyConsent": True,
                "locationConsent": True,
                "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456",
            },
        )
        # 변수 의미: JSON으로 파싱한 OAuth start 응답이다.
        payload = json.loads(body)
        # 변수 의미: 인가 URL 쿼리 파라미터다.
        query = parse_qs(urlparse(payload["authorizeUrl"]).query)

        self.assertEqual(query["client_id"], ["naver-client"])
        self.assertEqual(query["state"], ["state-1"])
        self.assertEqual(query["redirect_uri"], ["http://localhost:8000/api/auth/naver/callback"])
        self.assertIn("state-1", self.oauth_state.payloads)
        self.assertEqual(self.oauth_state.payloads["state-1"]["browser_nonce"], "nonce-abcdefghijklmnopqrstuvwxyz123456")

    def test_start_rejects_missing_consent(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 동의가 빠진 start 요청이 400으로 거부되는지 확인한다.
        호출 예시: self.test_start_rejects_missing_consent()
        """
        with self.assertRaises(HTTPError) as context:
            fetch_raw(
                self.url("/api/auth/google/start"),
                method="POST",
                payload={"ageConfirmed": True, "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456"},
            )

        self.assertEqual(context.exception.code, 400)

    def test_start_rejects_missing_oauth_nonce(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 브라우저 nonce 없는 start 요청이 400으로 거부되는지 확인한다.
        호출 예시: self.test_start_rejects_missing_oauth_nonce()
        """
        with self.assertRaises(HTTPError) as context:
            fetch_raw(
                self.url("/api/auth/google/start"),
                method="POST",
                payload={"ageConfirmed": True, "privacyConsent": True, "locationConsent": True},
            )

        self.assertEqual(context.exception.code, 400)

    def test_callback_success_returns_token_bridge(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: callback 성공 시 사용자 식별, 동의 저장, 토큰 fragment 브리지를 확인한다.
        호출 예시: self.test_callback_success_returns_token_bridge()
        """
        fetch_raw(
            self.url("/api/auth/naver/start"),
            method="POST",
            payload={
                "ageConfirmed": True,
                "privacyConsent": True,
                "locationConsent": True,
                "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456",
            },
        )

        with (
            patch("questbook_api.server.oauth_client.exchange_code", return_value="provider-token"),
            patch(
                "questbook_api.server.oauth_client.fetch_profile",
                return_value={"provider_user_id": "naver-1", "email": "a@b.com", "display_name": "탐험가"},
            ),
        ):
            # 변수 의미: OAuth callback HTML 응답이다.
            status, content_type, body = fetch_raw(self.url("/api/auth/naver/callback?code=code-1&state=state-1"))

        # 변수 의미: HTML 브리지에서 추출한 단회 OAuth code다.
        code_match = re.search(r"/#oauth_code=([^\"']+)", body)
        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        self.assertNotIn("accessToken", body)
        self.assertNotIn("usr_oauth", body)
        self.assertIsNotNone(code_match)
        assert code_match is not None
        # 변수 의미: callback에서 발급한 단회 token 교환 코드다.
        oauth_code = unquote(code_match.group(1))
        # 변수 의미: token 교환 API 응답이다.
        _redeem_status, _redeem_content_type, redeem_body = fetch_raw(
            self.url("/api/auth/oauth-code/redeem"),
            method="POST",
            payload={"oauthCode": oauth_code, "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456"},
        )
        # 변수 의미: JSON으로 파싱한 token 교환 응답이다.
        redeem_payload = json.loads(redeem_body)
        # 변수 의미: 검증된 앱 JWT payload다.
        token_payload = verify_access_token(redeem_payload["accessToken"], "test-secret")

        self.assertEqual(token_payload["sub"], "usr_oauth")
        self.assertEqual(token_payload["provider"], "naver")
        self.assertEqual(self.repository.identity_call, ("naver", "naver-1", "탐험가", "a@b.com"))
        self.assertEqual(self.repository.consent_call, {
            "user_id": "usr_oauth",
            "age_confirmed": True,
            "privacy_consent": True,
            "location_consent": True,
            "consent_version": "baseline-2026-07",
        })
        self.assertNotIn("Access-Control-Allow-Origin", fetch_headers(self.url("/api/auth/google/callback?code=code-1&state=bad-state")))
        with self.assertRaises(HTTPError) as context:
            fetch_raw(
                self.url("/api/auth/oauth-code/redeem"),
                method="POST",
                payload={"oauthCode": oauth_code, "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456"},
            )
        self.assertEqual(context.exception.code, 400)

    def test_redeem_rejects_wrong_nonce(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: token 교환 코드가 맞아도 브라우저 nonce가 틀리면 거부되는지 확인한다.
        호출 예시: self.test_redeem_rejects_wrong_nonce()
        """
        # 변수 의미: 테스트용 token 교환 코드다.
        oauth_code = self.oauth_state.issue_login_code("usr_oauth", "google", "nonce-abcdefghijklmnopqrstuvwxyz123456")

        with self.assertRaises(HTTPError) as context:
            fetch_raw(
                self.url("/api/auth/oauth-code/redeem"),
                method="POST",
                payload={"oauthCode": oauth_code, "oauthNonce": "nonce-wrongabcdefghijklmnopqrstuvwxyz"},
            )

        self.assertEqual(context.exception.code, 400)

    def test_redeem_store_failure_returns_503(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: token 교환 코드 소비 중 저장소 장애가 503으로 반환되는지 확인한다.
        호출 예시: self.test_redeem_store_failure_returns_503()
        """
        self.app_state = AppState(
            settings=build_test_settings(),
            repository=self.repository,
            cache=object(),
            service=object(),
            oauth_state=FailingRedeemOAuthStateStore(),
        )
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(self.app_state))
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        with self.assertRaises(HTTPError) as context:
            fetch_raw(
                self.url("/api/auth/oauth-code/redeem"),
                method="POST",
                payload={"oauthCode": "code", "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456"},
            )

        self.assertEqual(context.exception.code, 503)

    def test_callback_invalid_state_returns_error_bridge(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: state 검증 실패가 HTML 오류 브리지로 돌아오는지 확인한다.
        호출 예시: self.test_callback_invalid_state_returns_error_bridge()
        """
        # 변수 의미: 잘못된 state callback 응답이다.
        status, content_type, body = fetch_raw(self.url("/api/auth/google/callback?code=code-1&state=bad-state"))

        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        self.assertIn("/#oauth_error=invalid_state", body)

    def test_callback_provider_error_consumes_state_once(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: provider 취소/거부 callback도 state를 단회 소비하는지 확인한다.
        호출 예시: self.test_callback_provider_error_consumes_state_once()
        """
        fetch_raw(
            self.url("/api/auth/google/start"),
            method="POST",
            payload={
                "ageConfirmed": True,
                "privacyConsent": True,
                "locationConsent": True,
                "oauthNonce": "nonce-abcdefghijklmnopqrstuvwxyz123456",
            },
        )

        # 변수 의미: provider 오류 callback 응답이다.
        status, _content_type, body = fetch_raw(self.url("/api/auth/google/callback?error=access_denied&state=state-1"))

        self.assertEqual(status, 200)
        self.assertIn("/#oauth_error=provider_denied", body)
        self.assertNotIn("state-1", self.oauth_state.payloads)


if __name__ == "__main__":
    unittest.main()
