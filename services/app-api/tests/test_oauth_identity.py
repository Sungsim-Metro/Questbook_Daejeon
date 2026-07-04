# Questbook OAuth 사용자 식별(find-or-create)을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))
# 변수 의미: 테스트 헬퍼 모듈이 있는 디렉토리 경로다.
TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR))

import data_services

from questbook_api.infrastructure.repository import QuestbookRepository


@unittest.skipUnless(data_services.SERVICES_AVAILABLE, "local PostgreSQL/Redis not available")
class OAuthIdentityTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: OAuth identity 저장소 검증 결과.
    역할: 같은 provider 신원이 같은 baseline 사용자로 유지되는지 확인한다.
    호출 예시: uv run pytest tests/test_oauth_identity.py
    """

    def setUp(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 PostgreSQL 스키마를 초기화한다.
        호출 예시: self.setUp()
        """
        # 변수 의미: 테스트 DB 접속 URL이다.
        self.database_url = data_services.ensure_test_database()
        data_services.reset_database(self.database_url)
        # 변수 의미: 테스트 대상 저장소다.
        self.repository = QuestbookRepository(self.database_url)
        self.repository.initialize()

    def tearDown(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 저장소 연결을 닫는다.
        호출 예시: self.tearDown()
        """
        self.repository.close()

    def test_same_identity_returns_same_user(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 같은 provider 사용자 ID 재로그인이 같은 사용자 ID를 반환하는지 확인한다.
        호출 예시: self.test_same_identity_returns_same_user()
        """
        # 변수 의미: 첫 로그인으로 만든 사용자 ID다.
        first = self.repository.find_or_create_identity("naver", "naver-1", "탐험가", "a@b.com")
        # 변수 의미: 같은 provider 신원으로 재로그인한 사용자 ID다.
        second = self.repository.find_or_create_identity("naver", "naver-1", "탐험가2", "a2@b.com")

        self.assertEqual(first, second)
        self.assertEqual(self.repository.find_user_id_by_identity("naver", "naver-1"), first)

    def test_different_identity_creates_new_user(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: provider 또는 provider 사용자 ID가 다르면 별도 사용자가 생성되는지 확인한다.
        호출 예시: self.test_different_identity_creates_new_user()
        """
        # 변수 의미: 네이버 신원으로 만든 사용자 ID다.
        naver_user_id = self.repository.find_or_create_identity("naver", "naver-1", None, None)
        # 변수 의미: 구글 신원으로 만든 사용자 ID다.
        google_user_id = self.repository.find_or_create_identity("google", "google-1", None, None)

        self.assertNotEqual(naver_user_id, google_user_id)
        self.assertIsNone(self.repository.find_user_id_by_identity("naver", "missing"))


if __name__ == "__main__":
    unittest.main()
