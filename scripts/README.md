# 스크립트 디렉토리

개발, 검수, 배포 보조 스크립트를 보관한다. 스크립트는 비밀 값을 출력하지 않아야 하며, `.env` 파일 내용을 그대로 표시하지 않는다.

- `run_baseline.py`: 사용자 PWA, 웹 게이트웨이, 앱 API를 함께 실행한다.
- `backup_postgres.py`: 로컬 PostgreSQL baseline DB를 `pg_dump --format=custom` 형식으로 백업한다.
- `check_local_data_services.py`: 로컬 PostgreSQL과 Redis 연결 가능 여부를 점검한다.
- `check_object_storage.py`: NCP Object Storage 버킷 접근 가능 여부를 비밀 값 출력 없이 점검한다.
- `sync_ncp_secret_env.py`: NCP Secret Manager의 ACTIVE 값을 운영 dotenv에 반영하고 systemd 서비스를 재시작한다.

백업 전제: `docker compose -f infra/local/postgres-redis.compose.yaml up -d`로 로컬 PostgreSQL/Redis compose 스택을 먼저 실행한다.

백업 명령:

```bash
uv run python scripts/backup_postgres.py
```

복원 명령은 비밀번호가 포함된 URL을 명령 인자로 넘기지 않는 방식을 우선한다. 아래 명령은 로컬 compose 기본 비밀번호 예시다. 운영 또는 개인 비밀번호는 쉘 히스토리에 남지 않도록 `.pgpass`나 세션 전용 환경 변수를 사용한다.

```bash
PGPASSWORD=questbook_local_password pg_restore --clean --host 127.0.0.1 --port 5432 --username questbook --dbname questbook .questbook/backups/<file>.dump
```

로컬에 `pg_dump`가 없으면 컨테이너 안에서 백업한 뒤 파일을 복사한다.

```bash
docker exec questbook-postgres pg_dump --format=custom --username questbook --dbname questbook --file=/tmp/questbook.dump
docker cp questbook-postgres:/tmp/questbook.dump .questbook/backups/questbook.dump
```

## NCP Secret Manager 동기화

qbook-app 운영 서버에서 Secret Manager 값을 `/opt/Questbook_Daejeon/.env`에 반영하고 앱 API를 재시작한다.
`NCP_API_ACCESS_KEY`와 `NCP_API_SECRET_KEY`는 앱에서 쓰는 Object Storage 키가 아니라 Secret Manager API를 조회할 Sub Account API 키다.
신규 Secret은 기본적으로 KMS 리전 격리 키 엔드포인트(`https://ocapi-kr.ncloud.com/secretmanager`)를 사용한다.
업데이트 이전 전역 키 연동 Secret이면 `--endpoint https://secretmanager.apigw.ntruss.com`를 추가한다.

```bash
cd /opt/Questbook_Daejeon
export NCP_SECRET_MANAGER_SECRET_ID=<Secret Manager secretId>
export NCP_API_ACCESS_KEY=<Secret Manager 조회 권한이 있는 Access Key>
read -rsp "NCP API Secret Key: " NCP_API_SECRET_KEY
echo
export NCP_API_SECRET_KEY

python3 scripts/sync_ncp_secret_env.py
python3 scripts/sync_ncp_secret_env.py \
  --write \
  --restart-service questbook-api \
  --health-url http://127.0.0.1:8100/api/health

unset NCP_API_SECRET_KEY
```

첫 번째 명령은 dry-run으로 갱신될 key 목록만 확인한다. 두 번째 명령이 실제 `.env` 갱신, 기존 파일 백업, 서비스 재시작, 헬스체크를 수행한다.
