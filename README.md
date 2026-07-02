# Questbook_Dajeon

대전을 탐험하며 뱃지를 모으고, 뱃지 성향에 따라 꿈돌이 도감을 해금하는 위치 기반 관광 퀘스트 게임

## 문서 구조

- `docs/PROJECT_DESIGN.md`: 목표 기능, 데이터 정책, 시스템 아키텍처, 네트워크 구조, 확장 설계
- `docs/MVP_STATUS.md`: 현재 구현 현황, 미구현 기능, 다음 구현 작업
- `docs/Design.md`: 원본 요구사항 메모

## 샘플 이미지

*메인 화면 예시 1*
![메인 화면 예시 1](images/index1.jpeg)
*메인 화면 예시 2*
![메인 화면 예시 2](images/index2.jpeg)
*지도 화면 예시*
![지도 화면 예시](images/map.jpeg)

## 주요 기능

설치 가능한 모바일 웹(PWA)으로 제작된 웹 애플리케이션이며, MVP는 설치와 기본 오프라인 캐싱을 제공하고 웹 푸시·풀 오프라인은 향후 확장한다.
한국관광공사 OpenAPI와 GPS, 사진 등을 이용하여 아래의 기능을 제공

### 1. 대전 관광 퀘스트 제공

OpenAPI 관광지 데이터를 기반으로 방문형, 이동형, 활동형, 소비형, 테마형 퀘스트를 제공한다.
사용자는 현재 위치와 관심 테마에 따라 주변 퀘스트를 확인하고 원하는 것을 선택해 수행할 수 있다.
한밭수목원 방문, 국립중앙과학관 탐방, 원도심 걷기, 타슈를 이용한 이동, 지역 빵집 방문, 전통시장 소비 인증 등 대전 특화 퀘스트를 제공한다.

### 2. 퀘스트 인증 및 뱃지 발급

관광지 반경 10~50m 도달 시 GPS 기반으로 1차 인증하고, MVP의 사진 인증은 사진 존재와 완료 시각·위치창을 확인하는 경량 검증으로 둔다.
소비형은 OCR로 상호명만 추출해 기대 장소와 대조하며, 금액·카드·승인번호 등 민감 영수증 필드는 저장하지 않는다.
퀘스트 완료 시 모험 수첩에 도장이 찍히고 활동 유형에 따라 뱃지를 획득한다.
뱃지는 단순 보상이 아닌 관광 행동 데이터 태그로 활용되며, 타슈 라이더, 빵지순례자, 사이언스 익스플로러, 대전 워커 등 관광 성향을 반영한 종류로 구성된다.
뱃지 단계는 `docs/PROJECT_DESIGN.md` §4.7의 수집형 꿈돌이 도감 해금 조건으로 사용된다.

### 3. 나만의 모험 수첩 기능

완료한 퀘스트, 방문 장소, 획득 뱃지, 이동 기록을 개인화 기록장 형태로 시각화한다.
뱃지와 퀘스트 결과는 시스템 생성 카드(닉네임·장소·뱃지·꿈돌이)로 저장 및 공유할 수 있다.
원본 사진은 비공개로 본인 수첩에 보관한다.

### 4. 위치기반 맞춤 퀘스트 추천 기능

MVP에서는 뱃지 획득 이력을 기반으로 관광 성향에 맞는 퀘스트를 개인화 추천한다.
연관 관광지 API와 집중률 API를 활용한 혼잡 분산 추천은 향후 고도화 기능으로 두며, 실교통량·내비게이션 데이터 연계가 필요하다.

### 5. 리워드 및 지역상권 연계

일정 퀘스트 달성 또는 특정 테마 뱃지 획득 시 지역상점 할인 쿠폰, 관광기념품, 체험권 등 리워드를 제공한다.
MVP 단계에서는 뱃지, 모험 수첩, 꿈돌이 도감 같은 비금전 보상 중심으로 운영하고, 실금전 리워드는 이후 대전 지역상점, 전통시장, 지역 축제와 연계해 확장한다.

## 로컬 실행 및 네이버 지도 설정

현재 저장소에는 두 실행 경로가 있다.

- 기존 정적 MVP: 루트의 `index.html`, `map.html`, `quests.html`, `notes.html`, `badges.html`, `server.py`
- baseline 분리 구현: `apps/user-web`, `services/web-gateway`, `services/app-api`

baseline 분리 구현은 설계서의 확장 이전 구조에 맞춰 사용자 PWA, 웹 게이트웨이, Python 앱 API, 저장소, 캐시 계층을 분리한다. 현재 로컬 baseline은 SQLite와 앱 서버 인메모리 캐시로 실행되지만, 목표 운영 데이터베이스는 PostgreSQL, 서버 캐시는 Redis로 확정한다.

```bash
python3 scripts/run_baseline.py
```

실행 후 같은 PC에서는 `http://127.0.0.1:8000/`로 접속한다. 앱 API는 기본적으로 `http://127.0.0.1:8100`에서 실행되고, 웹 게이트웨이가 `/api` 요청을 앱 API로 프록시한다. 첫 화면에서는 demo-social 로그인과 만 14세 이상 확인, 개인정보·위치정보 수집·이용 동의 후 Bearer token을 받아 API를 호출한다.

baseline 검수 명령은 다음과 같다.

```bash
PYTHONPATH=services/app-api/src python3 -m unittest discover services/app-api/tests
python3 -m unittest discover tests/smoke
node --check apps/user-web/src/app.js
node --check apps/user-web/public/service-worker.js
```

PostgreSQL과 Redis 로컬 개발 서비스는 Docker Compose로 준비한다. 현재 앱 로직은 아직 SQLite와 인메모리 캐시를 사용하지만, 다음 마이그레이션 작업을 위해 같은 서버에서 PostgreSQL과 Redis 접속 가능 여부를 먼저 확인할 수 있다.

```bash
docker compose -f infra/local/postgres-redis.compose.yaml up -d
uv run --project services/app-api python scripts/check_local_data_services.py
```

운영 baseline 보조 파일은 다음 위치에 있다.

- `infra/nginx/questbook-baseline.conf`: 정적 PWA 제공, gzip 압축, 보안 헤더, `/api` 프록시 예시
- `infra/ncp/baseline-topology.yaml`: 설계서의 NCP VPC/subnet baseline 토폴로지
- `scripts/backup_sqlite.py`: PostgreSQL 전환 전 로컬 baseline SQLite 백업 스크립트

기존 정적 MVP의 지도 페이지는 NAVER Maps Dynamic Map을 사용한다. 브라우저에는 `NAVER_MAPS_API_KEY_ID`만 전달하고, `NAVER_MAPS_API_KEY`는 로컬 서버의 Geocoding, Reverse Geocoding 프록시에서만 사용한다.

```bash
cp .env.example .env
uv run python server.py
```

`.env`에 다음 값을 입력한 뒤 `http://100.87.116.106:8000/index.html`로 접속한다. 같은 PC에서는 `http://127.0.0.1:8000/`도 사용할 수 있다.

```dotenv
NAVER_MAPS_API_KEY_ID=your_key_id
NAVER_MAPS_API_KEY=your_api_key
QUESTBOOK_HOST=0.0.0.0
QUESTBOOK_PORT=8000
QUESTBOOK_PUBLIC_URL=http://100.87.116.106:8000
```

NAVER Cloud Platform 콘솔에서 Maps 애플리케이션의 Web 서비스 URL 또는 Referer 허용 목록에 Tailscale 주소 `http://100.87.116.106:8000` (단순 예시), 로컬 주소 `http://127.0.0.1:8000`, 배포 도메인을 등록해야 Dynamic Map이 정상 로드된다. 키가 비어 있거나 도메인 설정이 맞지 않으면 지도 페이지는 기존 목업 지도로 fallback된다.
