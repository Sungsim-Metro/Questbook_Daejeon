# Questbook PostgreSQL 데이터베이스를 pg_dump로 백업한다.
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlparse

# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
# 변수 의미: 백업 파일 저장 디렉토리다.
BACKUP_DIR = REPOSITORY_ROOT / ".questbook" / "backups"
# 변수 의미: 기본 PostgreSQL 접속 URL이다.
DEFAULT_DATABASE_URL = "postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook"


def pg_env_from_url(database_url: str) -> dict[str, str]:
    """
    입력: PostgreSQL 접속 URL.
    출력: pg_dump에 전달할 PG* 환경 변수.
    역할: 비밀번호가 담긴 URL을 프로세스 인자에 노출하지 않는다.
    호출 예시: env = pg_env_from_url(database_url)
    """
    # 변수 의미: 파싱된 PostgreSQL URL이다.
    parsed_url = urlparse(database_url)
    # 변수 의미: 현재 프로세스 환경을 복사한 pg_dump 환경이다.
    environment = os.environ.copy()
    environment.update(
        {
            "PGHOST": parsed_url.hostname or "127.0.0.1",
            "PGPORT": str(parsed_url.port or 5432),
            "PGDATABASE": parsed_url.path.lstrip("/") or "questbook",
        }
    )
    if parsed_url.username:
        environment["PGUSER"] = unquote(parsed_url.username)
    if parsed_url.password:
        environment["PGPASSWORD"] = unquote(parsed_url.password)
    return environment


def main() -> int:
    """
    입력: 없음(환경 변수 QUESTBOOK_DATABASE_URL 사용).
    출력: 프로세스 종료 코드.
    역할: 타임스탬프가 붙은 pg_dump 백업 파일을 만든다.
    호출 예시: uv run python scripts/backup_postgres.py
    """
    # 변수 의미: 백업 대상 접속 URL이다.
    database_url = os.environ.get("QUESTBOOK_DATABASE_URL", DEFAULT_DATABASE_URL)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    # 변수 의미: 백업 파일 이름에 쓰는 UTC 타임스탬프다.
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # 변수 의미: 백업 파일 경로다.
    backup_path = BACKUP_DIR / f"questbook-{timestamp}.dump"
    # 변수 의미: pg_dump 실행 결과다.
    result = subprocess.run(
        ["pg_dump", "--format=custom", f"--file={backup_path}"],
        check=False,
        env=pg_env_from_url(database_url),
    )
    if result.returncode != 0:
        print("pg_dump failed; check that PostgreSQL is running and pg_dump is installed", file=sys.stderr)
        return result.returncode
    print(f"backup written to {backup_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
