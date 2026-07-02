# Questbook baseline SQLite 데이터베이스 백업 파일을 생성한다.
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import shutil


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def get_database_path() -> Path:
    """
    입력: 없음.
    출력: 백업할 SQLite 데이터베이스 경로.
    역할: 환경 변수 또는 baseline 기본 경로에서 DB 위치를 결정한다.
    호출 예시: database_path = get_database_path()
    """
    # 변수 의미: 환경 변수에 설정된 데이터베이스 경로다.
    configured_path = os.environ.get("QUESTBOOK_DATABASE_PATH")
    if configured_path:
        return Path(configured_path).expanduser()
    return REPOSITORY_ROOT / ".questbook" / "baseline.sqlite3"


def create_backup(database_path: Path, backup_dir: Path) -> Path:
    """
    입력: 원본 DB 경로와 백업 디렉토리.
    출력: 생성된 백업 파일 경로.
    역할: baseline SQLite DB를 날짜 기반 파일명으로 복사한다.
    호출 예시: backup_path = create_backup(database_path, Path(\"backups\"))
    """
    if not database_path.exists():
        raise FileNotFoundError(f"database not found: {database_path}")

    backup_dir.mkdir(parents=True, exist_ok=True)
    # 변수 의미: 백업 파일명에 사용할 UTC timestamp다.
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # 변수 의미: 백업 대상 파일 경로다.
    backup_path = backup_dir / f"questbook-baseline-{timestamp}.sqlite3"
    shutil.copy2(database_path, backup_path)
    return backup_path


def main() -> int:
    """
    입력: 없음.
    출력: 프로세스 종료 코드.
    역할: baseline DB 백업을 생성하고 경로를 출력한다.
    호출 예시: python3 scripts/backup_sqlite.py
    """
    # 변수 의미: 백업할 데이터베이스 경로다.
    database_path = get_database_path()
    # 변수 의미: 백업 파일을 저장할 디렉토리다.
    backup_dir = Path(os.environ.get("QUESTBOOK_BACKUP_DIR", str(REPOSITORY_ROOT / ".questbook" / "backups"))).expanduser()
    # 변수 의미: 생성된 백업 파일 경로다.
    backup_path = create_backup(database_path, backup_dir)
    print(backup_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
