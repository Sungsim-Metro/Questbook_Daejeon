# Questbook baseline 앱 API와 웹 게이트웨이 HTTP 흐름을 검증한다.
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import Request, urlopen


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
# 변수 의미: 앱 API src 경로다.
APP_API_SRC = REPOSITORY_ROOT / "services" / "app-api" / "src"
# 변수 의미: 웹 게이트웨이 실행 파일 경로다.
GATEWAY_SCRIPT = REPOSITORY_ROOT / "services" / "web-gateway" / "gateway.py"


def find_free_port() -> int:
    """
    입력: 없음.
    출력: 현재 로컬에서 비어 있는 TCP 포트.
    역할: smoke 테스트 실행 시 포트 충돌을 줄인다.
    호출 예시: port = find_free_port()
    """
    # 변수 의미: 임시로 바인드할 소켓이다.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def fetch_json(
    url: str,
    method: str = "GET",
    payload: dict[str, object] | None = None,
    access_token: str | None = None,
) -> dict[str, object]:
    """
    입력: URL, HTTP 메서드, 선택적 JSON 요청 본문.
    출력: JSON 응답 딕셔너리.
    역할: 표준 라이브러리만으로 smoke API를 호출한다.
    호출 예시: payload = fetch_json(\"http://127.0.0.1:8000/api/health\")
    """
    # 변수 의미: JSON 요청 본문 바이트다.
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    # 변수 의미: HTTP 요청 헤더다.
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    # 변수 의미: HTTP 요청 객체다.
    request = Request(url, data=body, headers=headers, method=method)
    with urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_json(url: str, timeout_seconds: float = 8.0) -> dict[str, object]:
    """
    입력: 확인할 URL과 제한 시간.
    출력: JSON 응답 딕셔너리.
    역할: 서버가 뜰 때까지 짧게 재시도한다.
    호출 예시: health = wait_for_json(app_url)
    """
    # 변수 의미: 재시도 종료 시각이다.
    deadline = time.monotonic() + timeout_seconds
    # 변수 의미: 마지막 예외 객체다.
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            return fetch_json(url)
        except Exception as error:
            last_error = error
            time.sleep(0.2)
    raise RuntimeError(f"server did not become ready: {url}") from last_error


def terminate_process(process: subprocess.Popen[bytes]) -> None:
    """
    입력: 종료할 서버 프로세스.
    출력: 없음.
    역할: smoke 테스트가 띄운 서버를 정리한다.
    호출 예시: terminate_process(process)
    """
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


class BaselineHttpSmokeTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: baseline HTTP smoke 검증 결과.
    역할: 웹 게이트웨이와 앱 API가 분리된 상태로 같은-origin API 흐름을 처리하는지 확인한다.
    호출 예시: python -m unittest discover tests/smoke
    """

    @classmethod
    def setUpClass(cls) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 앱 API와 웹 게이트웨이를 시작한다.
        호출 예시: BaselineHttpSmokeTest.setUpClass()
        """
        # 변수 의미: 테스트 임시 디렉토리다.
        cls.temp_dir = tempfile.TemporaryDirectory()
        # 변수 의미: 테스트 앱 API 포트다.
        cls.app_port = find_free_port()
        # 변수 의미: 테스트 웹 게이트웨이 포트다.
        cls.web_port = find_free_port()
        # 변수 의미: 테스트용 SQLite DB 경로다.
        cls.database_path = Path(cls.temp_dir.name) / "baseline-smoke.sqlite3"
        # 변수 의미: 서버 프로세스가 사용할 환경 변수다.
        cls.environment = os.environ.copy()
        # 변수 의미: 기존 PYTHONPATH 값이다.
        existing_pythonpath = cls.environment.get("PYTHONPATH", "")
        cls.environment["PYTHONPATH"] = (
            f"{APP_API_SRC}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else str(APP_API_SRC)
        )
        cls.environment["QUESTBOOK_DATABASE_PATH"] = str(cls.database_path)
        cls.environment["QUESTBOOK_APP_API_HOST"] = "127.0.0.1"
        cls.environment["QUESTBOOK_APP_API_PORT"] = str(cls.app_port)
        cls.environment["QUESTBOOK_APP_API_BASE_URL"] = f"http://127.0.0.1:{cls.app_port}"
        cls.environment["QUESTBOOK_WEB_HOST"] = "127.0.0.1"
        cls.environment["QUESTBOOK_WEB_PORT"] = str(cls.web_port)

        # 변수 의미: 앱 API 서버 프로세스다.
        cls.app_process = subprocess.Popen(
            [sys.executable, "-m", "questbook_api.server"],
            cwd=REPOSITORY_ROOT,
            env=cls.environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_json(f"http://127.0.0.1:{cls.app_port}/api/health")
        # 변수 의미: 웹 게이트웨이 서버 프로세스다.
        cls.gateway_process = subprocess.Popen(
            [sys.executable, str(GATEWAY_SCRIPT)],
            cwd=REPOSITORY_ROOT,
            env=cls.environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_json(f"http://127.0.0.1:{cls.web_port}/api/health")
        # 변수 의미: demo-social 로그인 응답이다.
        login_payload = fetch_json(
            f"http://127.0.0.1:{cls.web_port}/api/auth/demo-login",
            method="POST",
            payload={
                "providerUserId": "demo-user",
                "displayName": "꼬마 탐험가",
                "ageConfirmed": True,
                "privacyConsent": True,
                "locationConsent": True,
            },
        )
        cls.access_token = str(login_payload["accessToken"])

    @classmethod
    def tearDownClass(cls) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 테스트용 서버 프로세스와 임시 디렉토리를 정리한다.
        호출 예시: BaselineHttpSmokeTest.tearDownClass()
        """
        terminate_process(cls.gateway_process)
        terminate_process(cls.app_process)
        cls.temp_dir.cleanup()

    def test_gateway_serves_pwa_and_proxies_api(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 웹 게이트웨이가 PWA 정적 파일과 API 프록시를 모두 제공하는지 확인한다.
        호출 예시: python -m unittest ...BaselineHttpSmokeTest.test_gateway_serves_pwa_and_proxies_api
        """
        with urlopen(f"http://127.0.0.1:{self.web_port}/", timeout=10) as response:
            # 변수 의미: 정적 HTML 응답 본문이다.
            html = response.read().decode("utf-8")
        self.assertIn("모험가의 수첩", html)

        # 변수 의미: 게이트웨이 경유 헬스체크 응답이다.
        health = fetch_json(f"http://127.0.0.1:{self.web_port}/api/health")
        self.assertEqual(health["status"], "ok")
        self.assertTrue(health["database"]["ok"])

        # 변수 의미: 인증된 사용자 응답이다.
        user_payload = fetch_json(f"http://127.0.0.1:{self.web_port}/api/me", access_token=self.access_token)
        self.assertTrue(user_payload["user"]["consent"]["ready"])

        with self.assertRaises(HTTPError) as error_context:
            fetch_json(f"http://127.0.0.1:{self.web_port}/api/me")
        self.assertEqual(error_context.exception.code, 401)

    def test_recommend_accept_and_complete_flow(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 추천, 수락, 완료, 뱃지, 수첩 갱신 흐름을 HTTP 경로로 검증한다.
        호출 예시: python -m unittest ...BaselineHttpSmokeTest.test_recommend_accept_and_complete_flow
        """
        # 변수 의미: 추천 API 쿼리 문자열이다.
        query = urlencode({"lat": "36.327", "lng": "127.427", "category": "market"})
        # 변수 의미: 추천 API 응답이다.
        recommendation_payload = fetch_json(
            f"http://127.0.0.1:{self.web_port}/api/recommendations?{query}",
            access_token=self.access_token,
        )
        self.assertIn("관광정보 제공", recommendation_payload["attribution"])
        self.assertEqual(recommendation_payload["cache"]["ttlSeconds"], 1800)

        # 변수 의미: 첫 번째 추천 항목이다.
        first_recommendation = recommendation_payload["recommendations"][0]
        # 변수 의미: 사용자별 퀘스트 인스턴스 ID다.
        instance_id = first_recommendation["quest"]["instanceId"]
        # 변수 의미: 추천 장소 정보다.
        place = first_recommendation["place"]

        # 변수 의미: 퀘스트 수락 응답이다.
        accept_payload = fetch_json(
            f"http://127.0.0.1:{self.web_port}/api/quests/{instance_id}/accept",
            method="POST",
            payload={},
            access_token=self.access_token,
        )
        self.assertEqual(accept_payload["status"], "accepted")

        # 변수 의미: 퀘스트 완료 응답이다.
        complete_payload = fetch_json(
            f"http://127.0.0.1:{self.web_port}/api/quests/{instance_id}/complete",
            method="POST",
            payload={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "accuracyMeters": 20,
                "photoAttached": True,
                "ocrText": place["title"],
                "checklistComplete": True,
            },
            access_token=self.access_token,
        )
        self.assertTrue(complete_payload["ok"])
        self.assertGreaterEqual(complete_payload["completion"]["earnedXp"], 1)

        # 변수 의미: 완료 후 뱃지 응답이다.
        badges_payload = fetch_json(f"http://127.0.0.1:{self.web_port}/api/badges", access_token=self.access_token)
        self.assertTrue(any(badge["categoryCode"] == "market" and badge["earned"] for badge in badges_payload["badges"]))

        # 변수 의미: 완료 후 수첩 응답이다.
        notes_payload = fetch_json(f"http://127.0.0.1:{self.web_port}/api/notes", access_token=self.access_token)
        self.assertGreaterEqual(len(notes_payload["notes"]), 1)


if __name__ == "__main__":
    unittest.main()
