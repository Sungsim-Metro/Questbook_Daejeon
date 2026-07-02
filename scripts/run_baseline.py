# Questbook baseline 앱 API와 웹 게이트웨이를 함께 실행한다.
from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import time


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
# 변수 의미: 앱 API 소스 경로다.
APP_API_SRC = REPOSITORY_ROOT / "services" / "app-api" / "src"
# 변수 의미: 웹 게이트웨이 실행 파일 경로다.
GATEWAY_SCRIPT = REPOSITORY_ROOT / "services" / "web-gateway" / "gateway.py"


def build_environment() -> dict[str, str]:
    """
    입력: 없음.
    출력: baseline 실행용 환경 변수 딕셔너리.
    역할: 앱 API 패키지를 찾을 수 있도록 PYTHONPATH와 기본 포트를 설정한다.
    호출 예시: env = build_environment()
    """
    # 변수 의미: 현재 프로세스 환경 변수 복사본이다.
    environment = os.environ.copy()
    # 변수 의미: 기존 PYTHONPATH 값이다.
    existing_pythonpath = environment.get("PYTHONPATH", "")
    # 변수 의미: 앱 API src를 포함한 PYTHONPATH 값이다.
    environment["PYTHONPATH"] = f"{APP_API_SRC}{os.pathsep}{existing_pythonpath}" if existing_pythonpath else str(APP_API_SRC)
    environment.setdefault("QUESTBOOK_APP_API_HOST", "127.0.0.1")
    environment.setdefault("QUESTBOOK_APP_API_PORT", "8100")
    environment.setdefault("QUESTBOOK_APP_API_BASE_URL", "http://127.0.0.1:8100")
    environment.setdefault("QUESTBOOK_WEB_HOST", "0.0.0.0")
    environment.setdefault("QUESTBOOK_WEB_PORT", "8000")
    return environment


def terminate_process(process: subprocess.Popen[bytes]) -> None:
    """
    입력: 종료할 subprocess 객체.
    출력: 없음.
    역할: 실행 중인 서버 프로세스를 안전하게 종료한다.
    호출 예시: terminate_process(app_process)
    """
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    """
    입력: 없음.
    출력: 프로세스 종료 코드.
    역할: 앱 API와 웹 게이트웨이를 순서대로 띄우고 종료 신호를 함께 처리한다.
    호출 예시: python scripts/run_baseline.py
    """
    # 변수 의미: baseline 실행 환경 변수다.
    environment = build_environment()
    # 변수 의미: 앱 API 서버 프로세스다.
    app_process = subprocess.Popen([sys.executable, "-m", "questbook_api.server"], cwd=REPOSITORY_ROOT, env=environment)
    time.sleep(0.8)
    if app_process.poll() is not None:
        return app_process.returncode or 1

    # 변수 의미: 웹 게이트웨이 서버 프로세스다.
    gateway_process = subprocess.Popen([sys.executable, str(GATEWAY_SCRIPT)], cwd=REPOSITORY_ROOT, env=environment)

    def handle_signal(_signum: int, _frame: object) -> None:
        """
        입력: 신호 번호와 프레임 객체.
        출력: 없음.
        역할: Ctrl+C 또는 종료 신호를 받으면 두 서버를 함께 종료한다.
        호출 예시: signal.signal(signal.SIGINT, handle_signal)
        """
        terminate_process(gateway_process)
        terminate_process(app_process)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        while app_process.poll() is None and gateway_process.poll() is None:
            time.sleep(0.5)
    finally:
        terminate_process(gateway_process)
        terminate_process(app_process)
    return app_process.returncode or gateway_process.returncode or 0


if __name__ == "__main__":
    raise SystemExit(main())
