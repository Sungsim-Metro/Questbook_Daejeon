# Questbook 앱 API 설정 검증 규칙을 확인한다.
from __future__ import annotations

import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.settings import AppSettings, DEFAULT_JWT_SECRET


class AppSettingsTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 앱 설정 검증 결과.
    역할: OAuth와 배포 환경에서 약한 JWT 서명 키가 차단되는지 확인한다.
    호출 예시: uv run pytest tests/test_settings.py
    """

    def _settings_from_env(self, env: dict[str, str]) -> AppSettings:
        """
        입력: 테스트 환경 변수 딕셔너리.
        출력: 환경 변수로 구성한 AppSettings.
        역할: 실제 .env 파일을 읽지 않고 설정 규칙을 검증한다.
        호출 예시: settings = self._settings_from_env({"QUESTBOOK_JWT_SECRET": "x"})
        """
        with (
            patch.dict(os.environ, env, clear=True),
            patch("questbook_api.settings.load_dotenv_file", return_value={}),
        ):
            return AppSettings.from_env()

    def test_local_demo_allows_default_jwt_secret(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 로컬 데모 개발은 기본 JWT 서명 키로도 기동 가능한지 확인한다.
        호출 예시: self.test_local_demo_allows_default_jwt_secret()
        """
        # 변수 의미: 로컬 데모 설정이다.
        settings = self._settings_from_env({"QUESTBOOK_APP_API_HOST": "127.0.0.1"})

        self.assertEqual(settings.jwt_secret, DEFAULT_JWT_SECRET)

    def test_oauth_requires_strong_jwt_secret(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OAuth provider가 설정된 상태에서 약한 JWT 서명 키를 거부하는지 확인한다.
        호출 예시: self.test_oauth_requires_strong_jwt_secret()
        """
        with self.assertRaises(ValueError):
            self._settings_from_env({
                "QUESTBOOK_APP_API_HOST": "127.0.0.1",
                "GOOGLE_OAUTH_CLIENT_ID": "google-client",
                "GOOGLE_OAUTH_CLIENT_SECRET": "google-secret",
                "QUESTBOOK_JWT_SECRET": "change_this_local_dev_secret_before_deploy",
            })

    def test_nonlocal_host_requires_strong_jwt_secret_even_for_demo(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: demo-social만 쓰더라도 비로컬 바인드에서는 약한 JWT 서명 키를 거부하는지 확인한다.
        호출 예시: self.test_nonlocal_host_requires_strong_jwt_secret_even_for_demo()
        """
        with self.assertRaises(ValueError):
            self._settings_from_env({"QUESTBOOK_APP_API_HOST": "0.0.0.0", "QUESTBOOK_JWT_SECRET": DEFAULT_JWT_SECRET})

    def test_strong_jwt_secret_allows_oauth(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 강한 JWT 서명 키가 있으면 OAuth provider 설정이 허용되는지 확인한다.
        호출 예시: self.test_strong_jwt_secret_allows_oauth()
        """
        # 변수 의미: 테스트용 강한 JWT 서명 키다.
        strong_secret = "x" * 48
        # 변수 의미: OAuth가 설정된 앱 설정이다.
        settings = self._settings_from_env({
            "QUESTBOOK_APP_API_HOST": "0.0.0.0",
            "GOOGLE_OAUTH_CLIENT_ID": "google-client",
            "GOOGLE_OAUTH_CLIENT_SECRET": "google-secret",
            "QUESTBOOK_JWT_SECRET": strong_secret,
        })

        self.assertEqual(settings.jwt_secret, strong_secret)


if __name__ == "__main__":
    unittest.main()
