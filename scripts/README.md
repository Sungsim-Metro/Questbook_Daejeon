# 스크립트 디렉토리

개발, 검수, 배포 보조 스크립트를 보관한다. 스크립트는 비밀 값을 출력하지 않아야 하며, `.env` 파일 내용을 그대로 표시하지 않는다.

- `run_baseline.py`: 사용자 PWA, 웹 게이트웨이, 앱 API를 함께 실행한다.
- `backup_sqlite.py`: PostgreSQL 전환 전 로컬 SQLite baseline DB를 백업한다.
- `check_local_data_services.py`: 로컬 PostgreSQL과 Redis 연결 가능 여부를 점검한다.
