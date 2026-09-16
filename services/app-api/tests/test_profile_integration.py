# 인증 사용자 프로필, 닉네임, 대표 꿈돌이 저장 계약을 검증한다.
from __future__ import annotations

import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
from threading import Thread
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))
# 변수 의미: 공용 테스트 데이터 서비스 헬퍼 경로다.
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

import data_services

from questbook_api.application.baseline_service import BaselineQuestbookService
from questbook_api.domain.auth.tokens import create_access_token
from questbook_api.infrastructure.cache import TourPlaceRedisCache
from questbook_api.infrastructure.repository import QuestbookRepository, make_id, now_iso
from questbook_api.integrations.tourapi.client import TourApiClient
from questbook_api.server import AppState, create_handler
from questbook_api.settings import AppSettings


# 변수 의미: 테스트 Bearer token에 사용하는 비운영 서명 키다.
TEST_JWT_SECRET = "profile-integration-test-secret-only"


def build_test_settings(database_url: str) -> AppSettings:
    """
    입력: 테스트 PostgreSQL 접속 URL.
    출력: 외부 연동이 비활성화된 앱 설정.
    역할: 프로필 HTTP 라우트를 실제 핸들러로 검증한다.
    호출 예시: settings = build_test_settings(database_url)
    """
    return AppSettings(
        host="127.0.0.1",
        port=0,
        database_url=database_url,
        redis_url=data_services.TEST_REDIS_URL,
        cache_ttl_seconds=1800,
        tourapi_service_key="",
        naver_maps_key_id="",
        naver_maps_key="",
        gemini_api_key="",
        jwt_secret=TEST_JWT_SECRET,
        public_base_url="http://localhost:8000",
        naver_oauth_client_id="",
        naver_oauth_client_secret="",
        google_oauth_client_id="",
        google_oauth_client_secret="",
    )


def request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, object] | None = None,
    token: str = "",
) -> tuple[int, dict[str, object]]:
    """
    입력: URL, HTTP 메서드, 선택적 JSON 본문과 Bearer token.
    출력: HTTP 상태 코드와 JSON 응답.
    역할: 성공과 검증 실패 응답을 같은 방식으로 읽는다.
    호출 예시: status, payload = request_json(url, token=token)
    """
    # 변수 의미: 요청에 넣을 HTTP 헤더다.
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # 변수 의미: JSON 요청 본문 바이트다.
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    # 변수 의미: 실제 테스트 HTTP 요청이다.
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.code, json.loads(error.read().decode("utf-8"))


@unittest.skipUnless(data_services.SERVICES_AVAILABLE, "test PostgreSQL/Redis not available")
class ProfileIntegrationTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 인증 프로필 쓰기와 재조회 계약 검증 결과.
    역할: main UI가 서버 상태를 단일 진실 소스로 사용할 수 있게 한다.
    호출 예시: uv run pytest services/app-api/tests/test_profile_integration.py
    """

    def setUp(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트 DB와 Redis를 초기화하고 실제 HTTP 핸들러를 시작한다.
        호출 예시: self.setUp()
        """
        # 변수 의미: 운영과 분리되고 이름이 검증된 테스트 DB URL이다.
        self.database_url = data_services.ensure_test_database()
        data_services.reset_database(self.database_url)
        data_services.reset_redis(data_services.TEST_REDIS_URL)
        # 변수 의미: 프로필 상태를 실제로 저장할 테스트 저장소다.
        self.repository = QuestbookRepository(self.database_url)
        self.repository.initialize()
        self.repository.ensure_user("alice")
        self.repository.ensure_user("bob")
        self.repository.ensure_user("demo-user")
        self.repository.link_user_account("demo-user", "demo-social", "demo-user", "꼬마 탐험가", None)
        # 변수 의미: 추천 호출 없이 서비스 객체를 구성하기 위한 테스트 캐시다.
        self.cache = TourPlaceRedisCache(data_services.TEST_REDIS_URL, default_ttl_seconds=1800)
        # 변수 의미: 프로필 유스케이스를 제공하는 실제 서비스다.
        self.service = BaselineQuestbookService(self.repository, self.cache, TourApiClient(""))
        # 변수 의미: 프로필 라우트가 사용할 테스트 앱 상태다.
        self.app_state = AppState(
            settings=build_test_settings(self.database_url),
            repository=self.repository,
            cache=self.cache,
            service=self.service,
            oauth_state=object(),
        )
        # 변수 의미: 임의 로컬 포트에서 실행하는 테스트 HTTP 서버다.
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(self.app_state))
        # 변수 의미: HTTP 서버 이벤트 루프를 실행하는 백그라운드 스레드다.
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트 HTTP 서버와 DB 연결을 정리한다.
        호출 예시: self.tearDown()
        """
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.repository.close()

    def url(self, path: str) -> str:
        """
        입력: API 경로.
        출력: 임의 포트를 포함한 테스트 URL.
        역할: 프로필 라우트 요청 주소를 만든다.
        호출 예시: url = self.url("/api/me")
        """
        # 변수 의미: 테스트 서버에 할당된 포트다.
        port = int(self.server.server_address[1])
        return f"http://127.0.0.1:{port}{path}"

    def token(self, user_id: str, provider: str = "demo-social") -> str:
        """
        입력: 사용자 ID와 로그인 provider.
        출력: 테스트용 서명 Bearer token.
        역할: 인증된 사용자별 API 요청을 만든다.
        호출 예시: token = self.token("alice")
        """
        return create_access_token(user_id, provider, TEST_JWT_SECRET)

    def test_get_me_preserves_existing_summary_and_exposes_social_profile(self) -> None:
        """
        입력: 네이버 OAuth 계정이 연결된 사용자.
        출력: 기존 중첩 필드와 추가 프로필 필드를 함께 가진 응답.
        역할: 프로필 확장 중 기존 홈·추천 계약이 사라지는 회귀를 막는다.
        호출 예시: self.test_get_me_preserves_existing_summary_and_exposes_social_profile()
        """
        self.repository.link_user_account("alice", "naver", "naver-alice", "앨리스", "alice@example.com")

        # 변수 의미: OAuth 사용자로 인증한 현재 사용자 응답이다.
        status, response = request_json(self.url("/api/me"), token=self.token("alice", "naver"))
        # 변수 의미: API가 반환한 사용자 프로필이다.
        user = response["user"]

        self.assertEqual(status, 200)
        self.assertEqual(user["id"], "alice")
        self.assertIn("level", user)
        self.assertIn("preference", user)
        self.assertIn("stats", user)
        self.assertIn("consent", user)
        self.assertEqual(user["accountType"], "social")
        self.assertEqual(user["provider"], "naver")
        self.assertEqual(user["email"], "alice@example.com")
        self.assertEqual(user["selectedGgumdoriId"], "ggumdori_default_1")
        self.assertEqual(user["rewardPolicy"], "category_xp")

    def test_demo_user_is_reported_as_demo_account(self) -> None:
        """
        입력: 공유 demo-social 사용자.
        출력: 독립 게스트라고 주장하지 않는 demo 프로필.
        역할: 이번 범위에 없는 독립 게스트 계정으로 UI가 오인하는 회귀를 막는다.
        호출 예시: self.test_demo_user_is_reported_as_demo_account()
        """
        # 변수 의미: demo 사용자로 인증한 현재 사용자 응답이다.
        status, response = request_json(self.url("/api/me"), token=self.token("demo-user"))
        # 변수 의미: API가 반환한 demo 프로필이다.
        user = response["user"]

        self.assertEqual(status, 200)
        self.assertEqual(user["accountType"], "demo")
        self.assertEqual(user["provider"], "demo-social")
        self.assertIsNone(user["email"])

    def test_nickname_endpoint_validates_and_persists_per_user(self) -> None:
        """
        입력: 공백이 포함된 유효 닉네임과 잘못된 닉네임 후보.
        출력: 최대 20자 검증, 사용자 격리와 새 연결 재조회 결과.
        역할: 로컬 화면만 바뀌거나 다른 사용자의 닉네임이 바뀌는 회귀를 막는다.
        호출 예시: self.test_nickname_endpoint_validates_and_persists_per_user()
        """
        # 변수 의미: 저장해야 할 공백 제거 닉네임이다.
        status, response = request_json(
            self.url("/api/me/nickname"), method="POST",
            payload={"nickname": "  대전 산책가  "}, token=self.token("alice"),
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["user"]["nickname"], "대전 산책가")
        self.assertEqual(self.repository.get_user("bob")["nickname"], "꼬마 탐험가")

        # 변수 의미: 각각 다른 검증 분기를 확인할 잘못된 요청들이다.
        invalid_payloads = [
            {}, {"nickname": None}, {"nickname": "   "}, {"nickname": "가" * 21},
        ]
        for invalid_payload in invalid_payloads:
            with self.subTest(payload=invalid_payload):
                invalid_status, invalid_response = request_json(
                    self.url("/api/me/nickname"), method="POST",
                    payload=invalid_payload, token=self.token("alice"),
                )
                self.assertEqual(invalid_status, 400)
                self.assertEqual(invalid_response["error"], "bad_request")

        # 변수 의미: 프로세스 재시작과 같은 별도 DB 연결이다.
        reopened = QuestbookRepository(self.database_url)
        try:
            self.assertEqual(reopened.get_user("alice")["nickname"], "대전 산책가")
        finally:
            reopened.close()

    def test_ggumdori_endpoint_requires_ownership_and_persists_per_user(self) -> None:
        """
        입력: 한 사용자만 해금한 legacy 꿈돌이 variant.
        출력: 보유자 선택 성공, 미보유자 거부, 사용자 격리와 재조회 결과.
        역할: 로컬 상태 조작만으로 잠긴 꿈돌이를 대표로 선택하는 회귀를 막는다.
        호출 예시: self.test_ggumdori_endpoint_requires_ownership_and_persists_per_user()
        """
        with self.repository._connection.transaction():
            self.repository._connection.execute(
                """INSERT INTO user_ggumdori(id, user_id, variant_id, unlocked_at)
                   VALUES (%s, %s, %s, %s)""",
                (make_id("ug"), "alice", "ggumdori_science_1", now_iso()),
            )

        # 변수 의미: 보유 사용자의 대표 꿈돌이 저장 응답이다.
        status, response = request_json(
            self.url("/api/me/ggumdori"), method="POST",
            payload={"selectedGgumdoriId": "ggumdori_science_1"}, token=self.token("alice"),
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["selectedGgumdoriId"], "ggumdori_science_1")

        # 변수 의미: 같은 variant를 보유하지 않은 다른 사용자의 응답이다.
        denied_status, denied_response = request_json(
            self.url("/api/me/ggumdori"), method="POST",
            payload={"selectedGgumdoriId": "ggumdori_science_1"}, token=self.token("bob"),
        )
        self.assertEqual(denied_status, 400)
        self.assertEqual(denied_response["error"], "bad_request")
        self.assertEqual(self.repository.get_user("bob")["selectedGgumdoriId"], "ggumdori_default_1")

        # 변수 의미: 대표 선택 영속성을 확인할 별도 DB 연결이다.
        reopened = QuestbookRepository(self.database_url)
        try:
            self.assertEqual(reopened.get_user("alice")["selectedGgumdoriId"], "ggumdori_science_1")
        finally:
            reopened.close()

    def test_profile_writes_require_bearer_authentication(self) -> None:
        """
        입력: Bearer token이 없는 프로필 쓰기 요청.
        출력: 두 라우트 모두 401 응답.
        역할: 다른 사용자의 프로필을 인증 없이 변경하는 회귀를 막는다.
        호출 예시: self.test_profile_writes_require_bearer_authentication()
        """
        # 변수 의미: 인증 없이 호출할 프로필 경로와 요청 본문이다.
        requests = [
            ("/api/me/nickname", {"nickname": "침입자"}),
            ("/api/me/ggumdori", {"selectedGgumdoriId": "ggumdori_default_1"}),
        ]
        for path, payload in requests:
            with self.subTest(path=path):
                status, response = request_json(self.url(path), method="POST", payload=payload)
                self.assertEqual(status, 401)
                self.assertEqual(response["error"], "unauthorized")
