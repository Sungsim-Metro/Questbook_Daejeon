# NCP Object Storage 버킷 연결 상태를 점검한다.
from __future__ import annotations

from pathlib import Path
import sys


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
# 변수 의미: 앱 API 소스 경로다.
APP_API_SRC = REPOSITORY_ROOT / "services" / "app-api" / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.object_storage.client import ObjectStorageClient
from questbook_api.settings import AppSettings


def main() -> int:
    """
    입력: 없음.
    출력: 프로세스 종료 코드.
    역할: `.env`의 NCP Object Storage 설정으로 버킷 접근 가능 여부를 확인한다.
    호출 예시: uv run python scripts/check_object_storage.py
    """
    # 변수 의미: 환경 변수에서 구성한 앱 설정이다.
    settings = AppSettings.from_env()
    # 변수 의미: Object Storage 점검 클라이언트다.
    client = ObjectStorageClient(settings)
    # 변수 의미: 비밀 값을 제외한 설정 상태다.
    status = client.status()

    print(f"endpoint: {status['endpointUrl']}")
    print(f"region: {status['regionName']}")
    print(f"bucket: {status['bucketName'] or '(not configured)'}")

    if not status["configured"]:
        print("FAIL - Object Storage 필수 환경 변수가 비어 있습니다.")
        print("missing: " + ", ".join(status["missingEnv"]))
        return 1

    # 변수 의미: Object Storage bucket head 요청 결과다.
    result = client.check_bucket()
    if result["ok"]:
        print(f"OK - Object Storage 버킷 접근 가능: {result['bucketName']}")
        return 0

    print(f"FAIL - Object Storage 버킷 접근 실패: {result['reason']}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
