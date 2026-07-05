# 앱 서버(qbook-app) 기동 런북

작성일: 2026-07-03 · 실행자: 사용자 · 검토자: Claude
관련 문서: `docs/superpowers/specs/2026-07-03-ncp-baseline-deployment-design.md` §7, `docs/Test_Cloud_Structure.md`

## 목표

qbook-app(10.0.20.100)에서 앱 API를 systemd로 상시 기동하고,
`브라우저 → Public ALB → qbook-web(게이트웨이) → Private LB → qbook-app → Cloud DB(PostgreSQL/Redis)` 전체 경로를 연결한다.

## 완료 기준

- [ ] qbook-app에서 `curl http://127.0.0.1:8100/api/health` 응답의 `database.ok`와 `cache.ok`가 모두 `true`
- [ ] Private LB 타깃 그룹에서 qbook-app 상태 UP
- [ ] 외부 브라우저에서 `https://www.travel-qbook.co.kr` 접속 → "동의하고 시작" → 지도·추천·뱃지·수첩·꿈돌이 화면 동작
- [ ] 폰에서 위치 권한 허용 후 현재 위치 기반 추천 확인

## 전제 상태 (이미 완료)

- 웹 서버(qbook-web) 게이트웨이 systemd 기동, Public ALB 경유 HTTPS(www) 서빙 동작
- Cloud DB for PostgreSQL(qbook-db, 10.0.100.6), Cloud DB for Redis(qbook-cache) 생성됨
- Private LB(qbook-private-lb, 10.0.250.6)와 앱 타깃 그룹 생성됨
- 코드 사실: 앱 API는 첫 기동 시 `repository.initialize()`가 **스키마 생성과 기준 데이터 seed를 자동 수행**한다. 수동 psql 마이그레이션이 필요 없다.

---

## Phase 0 — NCP 콘솔 준비 (서버 접속 전)

### 0-1. Cloud DB for PostgreSQL 접속 정보

콘솔 → Cloud DB for PostgreSQL → qbook-db:

1. **Private 도메인**(또는 10.0.100.6)과 포트(기본 5432)를 메모한다.
2. **DB User 생성**: 사용자 이름 예 `questbook`, 비밀번호 지정.
   생성 화면의 **Client IP(접근 제어)에 `10.0.20.0/24`** 를 넣는다(앱 서브넷만 허용).
3. **Database 생성**: 이름 예 `questbook`, 소유자는 위 사용자.
4. 메모할 값: `호스트`, `포트`, `DB 이름`, `사용자`, `비밀번호` (비밀번호는 문서에 적지 말 것).

### 0-2. Cloud DB for Redis 접속 정보

콘솔 → Cloud DB for Redis → qbook-cache:

1. **접속 도메인(Private)과 포트(기본 6379)** 를 메모한다.
2. 비밀번호(액세스 제어) 설정 여부를 확인한다. 미설정이면 URL은 `redis://<도메인>:6379/0` 형식이면 된다.

### 0-3. ACG 규칙

| ACG | 방향 | 프로토콜/포트 | 대상 | 이유 |
| :-- | :-- | :-- | :-- | :-- |
| qbook-app-acg | 인바운드 | TCP 8100 | 10.0.250.0/24 | Private LB → 앱 API |
| qbook-app-acg | 인바운드 | TCP 22 | 10.0.30.100/32 | bastion SSH |
| qbook-app-acg | 아웃바운드 | TCP 5432 | 10.0.100.0/24 | PostgreSQL |
| qbook-app-acg | 아웃바운드 | TCP 6379 | 10.0.100.0/24 | Redis |
| qbook-app-acg | 아웃바운드 | TCP 80, 443 | 0.0.0.0/0 | uv 설치, TourAPI, NAVER/Gemini API |
| cloud-postgresql-2cyi74 | 인바운드 | TCP 5432 | 10.0.20.0/24 | 앱 서브넷 → DB |
| cloud-cache-2cyidt | 인바운드 | TCP 6379 | 10.0.20.0/24 | 앱 서브넷 → Redis |

주의(웹 서버에서 겪은 실수 재발 방지): 인바운드 소스 IP를 저장 후 한 번 더 눈으로 확인한다.
default ACG를 빼기 전에 새 ACG를 먼저 붙이고, SSH 세션 하나를 살려둔 채 전환한다.

### 0-4. 앱 서브넷 라우트 테이블

qbook-app-subnet(10.0.20.0/24)이 **연결된 라우트 테이블**에 `0.0.0.0/0 → qbook-api-natgt` 경로가 있는지 확인, 없으면 추가.
(웹 서버 때와 동일: NAT의 서브넷이 아니라 **출발지 서브넷의 테이블**에 넣는다.)

### 0-5. NAVER Maps 애플리케이션에 서비스 URL 등록

콘솔 → AI·NAVER API(Maps) → 해당 Application → Web Dynamic Map 서비스 환경에
`https://www.travel-qbook.co.kr` 을 **Web 서비스 URL로 등록**한다.
등록하지 않으면 브라우저에서 지도 로드가 인증 오류로 실패한다.

### 0-6. Object Storage 사진 증빙 버킷 준비

콘솔 → Object Storage:

1. 사진 증빙 전용 비공개 버킷을 생성한다. 예: `qbook-evidence-prod`
2. 한국 리전이면 endpoint는 `https://kr.object.ncloudstorage.com`, region은 `kr-standard`를 사용한다.
3. 운영은 Object Storage에 필요한 권한만 가진 Sub Account API Key 사용을 권장한다.
4. 버킷 CORS에는 `https://www.travel-qbook.co.kr`과 필요한 로컬 테스트 origin만 허용한다.

상세 절차와 CORS XML 예시는 `docs/object-storage-setup.md`를 따른다.

---

## Phase 1 — 서버 기본 준비 (SSH)

```bash
# 데스크탑에서 bastion 경유 접속
ssh -J ubuntu@223.130.132.111 ubuntu@10.0.20.100
```

```bash
# 1) NAT 아웃바운드 확인 (HTTP 200 계열이면 정상)
curl -s -o /dev/null -w '%{http_code}\n' https://github.com

# 2) uv 설치
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
uv --version

# 3) 저장소 클론 (웹 서버에서 쓴 것과 같은 방식/자격증명 사용)
sudo mkdir -p /opt/Questbook_Daejeon
sudo chown ubuntu:ubuntu /opt/Questbook_Daejeon
git clone https://github.com/Sungsim-Metro/Questbook_Dajeon.git /opt/Questbook_Daejeon

# 4) 의존성 설치 (uv.lock 기반, .venv 생성)
cd /opt/Questbook_Daejeon/services/app-api
uv sync

# 5) 경로 해석 sanity check — 반드시 /opt/Questbook_Daejeon/.env 가 출력되어야 함
.venv/bin/python -c "from questbook_api.settings import ROOT_DOTENV_PATH; print(ROOT_DOTENV_PATH)"
```

5번 출력이 `.venv` 내부 경로로 나오면 editable 설치가 안 된 것이므로 중단하고 보고한다.

## Phase 2 — .env 작성과 스모크 테스트

```bash
# JWT 서명 키 생성 (출력값을 아래 .env에 사용)
python3 -c "import secrets; print(secrets.token_urlsafe(48))"

nano /opt/Questbook_Daejeon/.env
```

`.env` 내용 (꺾쇠 부분을 실제 값으로 교체, 이 파일은 서버에만 존재하고 절대 커밋하지 않는다):

```ini
QUESTBOOK_APP_API_HOST=0.0.0.0
QUESTBOOK_APP_API_PORT=8100
QUESTBOOK_DATABASE_URL=postgresql://<DB_USER>:<DB_PASSWORD>@<PG_PRIVATE_DOMAIN>:5432/<DB_NAME>
QUESTBOOK_REDIS_URL=redis://<REDIS_PRIVATE_DOMAIN>:6379/0
QUESTBOOK_CACHE_TTL_SECONDS=1800
QUESTBOOK_JWT_SECRET=<위에서 생성한 랜덤 값>
TOURAPI_SERVICE_KEY=<한국관광공사 키, 없으면 빈 값(대전 fallback 데이터로 동작)>
NAVER_MAPS_API_KEY_ID=<Maps Key ID>
NAVER_MAPS_API_KEY=<Maps 비밀 키>
GEMINI_API_KEY=
NCP_OBJECT_STORAGE_ENDPOINT_URL=https://kr.object.ncloudstorage.com
NCP_OBJECT_STORAGE_REGION_NAME=kr-standard
NCP_OBJECT_STORAGE_BUCKET_NAME=<Object Storage 버킷 이름>
NCP_OBJECT_STORAGE_ACCESS_KEY=<Object Storage Access Key ID>
NCP_OBJECT_STORAGE_SECRET_KEY=<Object Storage Secret Key>
NCP_OBJECT_STORAGE_PRESIGNED_URL_TTL_SECONDS=600
NCP_OBJECT_STORAGE_MAX_UPLOAD_BYTES=10485760
NCP_OBJECT_STORAGE_ADDRESSING_STYLE=path
```

꺾쇠 자리 값의 의미와 콘솔에서 찾는 곳:

| 자리 | 의미 | 콘솔 위치 |
| :-- | :-- | :-- |
| `<PG_PRIVATE_DOMAIN>` | PostgreSQL 서버의 VPC 내부 DNS 이름 (10.0.100.6으로 풀림) | Cloud DB for PostgreSQL → qbook-db 상세 → "Private 도메인" (없으면 10.0.100.6 사용 가능) |
| `<DB_NAME>` | PostgreSQL **안의** 데이터베이스 이름. 서비스 이름(qbook-db)·서버 이름(qbook-postgre-*)이 **아님** | qbook-db → Database 관리 탭 (서버 생성 시 입력한 기본 DB가 이미 있을 수 있음) |
| `<DB_USER>` / `<DB_PASSWORD>` | PostgreSQL 사용자와 비밀번호 | qbook-db → DB User 관리 탭 (비밀번호 재설정 가능). 비밀번호에 `@ : / #` 사용 금지(URL 깨짐) |
| `<REDIS_PRIVATE_DOMAIN>` | Redis의 VPC 내부 DNS 이름. URL 끝 `/0`은 논리 DB 0번(기본값) | Cloud DB for Redis → qbook-cache 상세 → "Private 도메인" |
| `<Object Storage 버킷 이름>` | 사진 증빙 원본을 저장할 비공개 버킷 | Object Storage → Bucket |
| `<Object Storage Access Key ID>` / `<Object Storage Secret Key>` | S3 호환 API 인증에 사용할 키 | Sub Account 또는 계정 보안 설정의 API 인증 키 |

```bash
chmod 600 /opt/Questbook_Daejeon/.env

# 포그라운드 스모크 실행 (첫 기동에서 스키마 생성 + seed 수행)
cd /opt/Questbook_Daejeon/services/app-api
uv run questbook-api
```

다른 SSH 세션에서:

```bash
curl -s http://127.0.0.1:8100/api/health | python3 -m json.tool
```

`database.ok: true`, `cache.ok: true` 확인 후 포그라운드 프로세스를 **Ctrl+C로 종료**한다
(systemd 등록 전에 반드시 종료 — 포트 충돌 방지, 웹 서버 때 겪은 문제).

Object Storage 연결도 함께 점검한다.

```bash
cd /opt/Questbook_Daejeon/services/app-api
uv run python ../../scripts/check_object_storage.py
```

### Phase 2-1 — Secret Manager 값을 .env로 동기화

Secret Manager에 운영 key-value를 이미 등록했다면, 이후에는 `.env`를 직접 편집하지 않고 배포 시 Secret Manager ACTIVE 값을 내려받아 `/opt/Questbook_Daejeon/.env`를 갱신한다.

전제:

- Secret Manager 값은 JSON 객체 형태다. 예: `{"QUESTBOOK_JWT_SECRET":"...","QUESTBOOK_DATABASE_URL":"..."}`
- qbook-app에서 Secret Manager API를 호출할 수 있도록 NAT 또는 아웃바운드 443 경로가 열려 있다.
- `NCP_API_ACCESS_KEY`와 `NCP_API_SECRET_KEY`는 앱의 Object Storage 키가 아니라 Secret Manager 조회 권한이 있는 Sub Account API 키다.
- 신규 Secret은 기본적으로 KMS 리전 격리 키 엔드포인트(`https://ocapi-kr.ncloud.com/secretmanager`)를 사용한다. 업데이트 이전 전역 키 연동 Secret이면 `--endpoint https://secretmanager.apigw.ntruss.com`를 추가한다.

첫 적용은 qbook-app에서 dry-run으로 key 목록을 확인한 뒤 실제 반영한다.

```bash
cd /opt/Questbook_Daejeon

export NCP_SECRET_MANAGER_SECRET_ID=<Secret Manager secretId>
export NCP_API_ACCESS_KEY=<Secret Manager 조회 권한 Access Key>
read -rsp "NCP API Secret Key: " NCP_API_SECRET_KEY
echo
export NCP_API_SECRET_KEY

# dry-run: 비밀 값은 출력하지 않고 갱신될 key 이름만 확인한다.
python3 scripts/sync_ncp_secret_env.py

# 실제 반영: .env 백업 생성 → .env 갱신 → 앱 API 재시작 → 헬스체크
python3 scripts/sync_ncp_secret_env.py \
  --write \
  --restart-service questbook-api \
  --health-url http://127.0.0.1:8100/api/health

unset NCP_API_SECRET_KEY
```

정상 출력 예시는 다음과 같다.

```text
Secret Manager에서 12개 key를 읽었습니다: NAVER_MAPS_API_KEY, ...
dotenv 파일을 갱신했습니다: /opt/Questbook_Daejeon/.env
기존 dotenv 백업을 생성했습니다: /opt/Questbook_Daejeon/.env.20260705183000.bak
systemd 서비스를 재시작했습니다: questbook-api
헬스체크가 성공했습니다: http://127.0.0.1:8100/api/health
```

반복 배포가 필요하면 `/root/.questbook-secret-manager.env` 같은 root 전용 파일에 bootstrap API 키만 보관하고 배포 전에 source한다. 이 파일은 앱 `.env`와 별개이며 저장소에 커밋하지 않는다.

```bash
install -m 600 /dev/null /root/.questbook-secret-manager.env
nano /root/.questbook-secret-manager.env
```

```dotenv
NCP_SECRET_MANAGER_SECRET_ID=<Secret Manager secretId>
NCP_API_ACCESS_KEY=<Secret Manager 조회 권한 Access Key>
NCP_API_SECRET_KEY=<Secret Manager 조회 권한 Secret Key>
```

이후 배포 명령:

```bash
cd /opt/Questbook_Daejeon
set -a
. /root/.questbook-secret-manager.env
set +a
python3 scripts/sync_ncp_secret_env.py --write --restart-service questbook-api --health-url http://127.0.0.1:8100/api/health
unset NCP_API_SECRET_KEY
```

## Phase 3 — systemd 서비스 등록

```bash
sudo tee /etc/systemd/system/questbook-api.service > /dev/null <<'EOF'
[Unit]
Description=Questbook app API (baseline)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/opt/Questbook_Daejeon/services/app-api/.venv/bin/questbook-api
WorkingDirectory=/opt/Questbook_Daejeon
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now questbook-api
systemctl status questbook-api --no-pager
curl -s http://127.0.0.1:8100/api/health | python3 -m json.tool
```

## Phase 4 — Private LB 타깃 그룹 연결

콘솔 → Load Balancer → 앱용 타깃 그룹:

1. 프로토콜/포트: **HTTP 8100**, 타깃: qbook-app
2. 헬스체크: 프로토콜 HTTP, 포트 8100, 경로 `/api/health`, **메서드 GET**
   (앱 API도 HEAD를 지원하지 않으므로 HEAD면 501 → DOWN)
3. Private LB 리스너: HTTP **8100** → 위 타깃 그룹
4. 타깃 상태 **UP** 확인

## Phase 5 — 웹 서버 연동과 E2E 검증

qbook-web(10.0.10.100)에 SSH 접속:

```bash
# 웹 게이트웨이가 앱 API를 Private LB로 프록시하도록 설정
echo 'QUESTBOOK_APP_API_BASE_URL=http://10.0.250.6:8100' >> /opt/Questbook_Daejeon/.env

# 게이트웨이는 요청마다 .env를 다시 읽으므로 재시작 없이 반영됨. 즉시 확인:
curl -s http://127.0.0.1:8000/api/health | python3 -m json.tool
```

콘솔에 Private LB **도메인**이 표시되면 IP(10.0.250.6) 대신 도메인 사용을 권장한다(LB 내부 IP 변경에 안전).

외부(데스크탑/폰)에서:

1. `https://www.travel-qbook.co.kr` 접속 → 동의 3항목 체크 → "동의하고 시작"
2. 지도 로드(NAVER Dynamic Map), 추천 목록 표시 확인
3. 뱃지·수첩·꿈돌이 탭 확인, 퀘스트 수락→완료 1회 시도
4. 폰: 위치 권한 허용 → 현재 위치 기반 추천, PWA 설치 배너 확인

## 트러블슈팅

| 증상 | 원인 후보 | 확인/조치 |
| :-- | :-- | :-- |
| 헬스체크 DOWN인데 서버는 기동 중 | 헬스체크 메서드가 HEAD | 메서드 GET, 경로 `/api/health`, 포트 8100 재확인 |
| `database.ok: false` | DB ACG, DB User의 Client IP, 호스트/비밀번호 오타 | qbook-app에서 `timeout 3 bash -c '</dev/tcp/<PG_HOST>/5432' && echo open` |
| `cache.ok: false` | Redis ACG, 엔드포인트 오타 | `timeout 3 bash -c '</dev/tcp/<REDIS_HOST>/6379' && echo open` |
| TourAPI 호출 실패, 추천이 fallback만 | 앱 서브넷 라우트에 NAT 경로 없음 | Phase 0-4 재확인. 키가 비어 있으면 fallback이 정상 동작임 |
| 웹에서 `/api`가 502 `app_api_unavailable` | web ACG 아웃바운드 8100, Private LB 리스너/타깃 | qbook-web에서 `curl http://10.0.250.6:8100/api/health` |
| 지도가 안 뜸 | Maps 앱에 서비스 URL 미등록, KEY_ID 누락 | Phase 0-5, `.env`의 NAVER_MAPS_API_KEY_ID |
| systemd 기동 실패 반복 | 경로 오타, .env 형식 오류 | `journalctl -u questbook-api -n 50 --no-pager` |
| Phase 1 sanity check에서 `ModuleNotFoundError: questbook_api` | `pyproject.toml`에 `[build-system]`이 없어 uv가 virtual 프로젝트로 취급(패키지·콘솔 스크립트 미설치) | 최신 main pull 후 `uv sync` 재실행. 2026-07-03 `uv_build` 백엔드 추가로 해결됨 |

## 완료 후 기록

- `docs/Test_Cloud_Structure.md`에 최종 ACG 규칙, DB/Redis 엔드포인트(비밀번호 제외), 서비스 유닛 이름을 기록
- 스펙 §7 상태 갱신, 이 런북의 완료 기준 체크

## 배운 점 (NCP VPC 특이사항)

- **VPC 환경의 로드밸런서에는 ACG가 없다.** 서버와 달리 LB는 ACG 부착 대상이 아니며, LB로 들어오는 트래픽의 접근 제어는 **LB가 속한 서브넷의 Network ACL**이 담당한다. 그래서 "접근 제어는 ACG로 통일, NACL은 기본 허용" 원칙에서 **LB만은 예외** — NACL이 실질 방어선이다.
- 이번 장애: NACL을 기본값으로 되돌리다 중간에 멈춘 상태가 Private LB로의 TCP 연결을 막았다. NACL 정리 후 연결 성립.
- **ALB 503(empty body)** 은 "그 순간 라우팅할 건강한 타깃이 없음"을 뜻한다. 헬스체크가 막 UP으로 전환된 직후엔 NCP ALB의 라우팅 동기화까지 수십 초~1분 지연이 있으니 잠시 후 재시도한다. (반면 TCP connect 타임아웃은 NACL/방화벽 문제다.)
- 앱 API 헬스체크 경로는 **`/api/health`** (앱에는 `/` 라우트가 없어 404 → DOWN). 웹 TG의 `/`와 다르다.

## 진행 상태

- [x] Phase 0 콘솔 준비
- [x] Phase 1 서버 기본 준비 (pyproject.toml에 uv_build 백엔드 추가로 해결)
- [x] Phase 2 .env + 스모크 (database.ok/cache.ok 모두 true)
- [x] Phase 3 systemd (questbook-api.service active)
- [x] Phase 4 Private LB UP (헬스체크 경로 /api/health, NACL 복구)
- [x] Phase 5 E2E 검증 (모바일·데스크톱 브라우저에서 지도까지 동작)
