# 비밀 닉네임으로 격리 테스트 계정에 전환하는 규칙을 검증한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.server import TEST_ACCOUNT_USER_ID, is_test_account_nickname  # noqa: E402


class TestAccountNicknameTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 비밀 닉네임 판정 검증 결과.
    역할: .env에 값이 있을 때만, 정확히 같은 값일 때만 전환하는지 확인한다.
    호출 예시: uv run --project services/app-api pytest services/app-api/tests/test_test_account.py
    """

    def test_disabled_when_secret_is_empty(self) -> None:
        """
        입력: 비어 있는 비밀 값.
        출력: 없음.
        역할: .env에 값을 넣지 않으면 어떤 닉네임으로도 전환되지 않는지 확인한다.
        호출 예시: self.test_disabled_when_secret_is_empty()
        """
        for candidate in ["", "test1", " "]:
            with self.subTest(candidate=candidate):
                self.assertFalse(is_test_account_nickname(candidate, ""))

    def test_matches_only_exact_value_ignoring_outer_spaces(self) -> None:
        """
        입력: 같은 값, 앞뒤 공백, 대소문자·일부만 같은 값.
        출력: 없음.
        역할: 입력칸 앞뒤 공백만 허용하고, 그 외에는 정확히 같아야 전환하는지 확인한다.
        호출 예시: self.test_matches_only_exact_value_ignoring_outer_spaces()
        """
        secret = "qb-open-sesame"
        self.assertTrue(is_test_account_nickname("qb-open-sesame", secret))
        self.assertTrue(is_test_account_nickname("  qb-open-sesame ", secret))
        for candidate in ["QB-OPEN-SESAME", "qb-open", "qb-open-sesame!", "test1"]:
            with self.subTest(candidate=candidate):
                self.assertFalse(is_test_account_nickname(candidate, secret))

    def test_rejects_non_string_input(self) -> None:
        """
        입력: 문자열이 아닌 닉네임 값.
        출력: 없음.
        역할: 잘못된 요청 본문이 예외 없이 일반 닉네임 처리로 넘어가는지 확인한다.
        호출 예시: self.test_rejects_non_string_input()
        """
        for candidate in [None, 123, ["qb-open-sesame"]]:
            with self.subTest(candidate=candidate):
                self.assertFalse(is_test_account_nickname(candidate, "qb-open-sesame"))

    def test_test_account_is_separate_from_shared_demo_account(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트 계정이 모든 체험 사용자가 공유하는 demo-user와 다른 계정인지 확인한다.
        호출 예시: self.test_test_account_is_separate_from_shared_demo_account()
        """
        self.assertNotEqual(TEST_ACCOUNT_USER_ID, "demo-user")


if __name__ == "__main__":
    unittest.main()
