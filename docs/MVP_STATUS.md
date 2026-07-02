# 모험가의 수첩 MVP 구현 현황

이 문서는 현재 저장소에 실제로 구현되어 있는 범위와 다음 구현 작업을 추적한다. 목표 아키텍처, 데이터 정책, 네트워크 구조, 확장 설계는 `PROJECT_DESIGN.md`에서 관리한다.

## 1. 현재 구현 요약

현재 저장소는 기존 정적 모바일 웹 프로토타입과 baseline 분리 구현을 함께 가진다. 기존 루트 HTML 화면은 제출용 목업 흐름을 보존하고, 새 baseline 구현은 `apps/user-web`, `services/web-gateway`, `services/app-api` 아래에서 설계서의 확장 이전 구조를 실제 실행 가능한 형태로 구현한다.

baseline 구현은 사용자 PWA, 웹 게이트웨이, Python 앱 API, 로컬 PostgreSQL 저장소, Redis 30분 TTL 캐시를 포함한다. 한국관광공사 TourAPI 키가 없으면 대전 fallback 장소 후보로 흐름을 검증하고, 키가 있으면 앱 서버가 TourAPI를 호출한다. OpenAPI 원본 응답 전체는 영구 DB에 저장하지 않고, 추천 계산에 필요한 최소 필드만 유저 단위 Redis 캐시에 30분 동안 보관한다.

현재 구현은 다음 요소로 구성된다.

- 기존 정적 HTML 화면
- 공통 CSS 스타일
- 목업 데이터 기반 화면 렌더링
- NAVER Dynamic Map 연동
- NAVER Geocoding 및 Reverse Geocoding 서버 프록시
- 지도 API 설정이 없거나 실패할 때 사용하는 목업 지도 fallback
- 사용자 모바일 웹/PWA baseline
- 웹 게이트웨이 baseline
- Python 앱 API baseline
- PostgreSQL 관계형 저장소 baseline
- 유저 단위 30분 TourAPI Redis 임시 캐시
- demo-social 로그인, 필수 동의·만 14세 확인 기록, stateless Bearer 토큰
- 웹 게이트웨이 gzip 압축과 보안 헤더
- NCP baseline 토폴로지 매니페스트
- PostgreSQL 백업 스크립트
- 템플릿 기반 `ReusableQuest` 생성과 재사용
- `UserQuestInstance` 사용자별 퀘스트 상태
- GPS 반경 기반 퀘스트 완료 처리
- XP, 레벨, 뱃지, 수첩 기록 갱신 트랜잭션
- 꿈돌이 도감 해금 상태 조회

## 2. 구현된 화면

### 2.1 홈 화면

- 파일: `index.html`
- 사용자 레벨, XP, 현재 위치 후보, 획득 뱃지, 주변 퀘스트 수, 보상 수를 표시한다.
- 오늘의 추천 퀘스트를 목업 데이터 기반으로 표시한다.

### 2.2 지도 화면

- 파일: `map.html`
- NAVER Dynamic Map을 사용해 현재 위치와 퀘스트 장소 마커를 표시한다.
- 브라우저 위치 권한을 사용해 현재 위치를 확인할 수 있다.
- 주소 검색과 좌표 입력을 통해 지도 중심을 이동할 수 있다.
- NAVER Maps 설정이 없거나 SDK 로드에 실패하면 목업 지도 UI로 fallback한다.

### 2.3 퀘스트 화면

- 파일: `quests.html`
- 방문형, 이동형, 소비형, 테마형, 활동형 퀘스트를 필터링해 보여준다.
- 현재 데이터는 `assets/js/mock-data.js`의 목업 퀘스트 배열을 사용한다.

### 2.4 탐험 노트 화면

- 파일: `notes.html`
- 완료한 퀘스트와 활동 기록을 수첩 형태로 보여준다.
- 현재 데이터는 목업 활동 기록을 사용한다.

### 2.5 뱃지 화면

- 파일: `badges.html`
- 획득한 뱃지와 잠긴 뱃지, 수첩 스탬프를 표시한다.
- 현재 데이터는 목업 뱃지 정의와 사용자 획득 상태를 사용한다.

## 3. 구현된 서버 기능

기존 `server.py`는 Python 표준 라이브러리 기반 로컬 개발 서버이며 루트 정적 MVP와 NAVER Maps 프록시를 제공한다.

구현된 기능은 다음과 같다.

- 정적 HTML, CSS, JavaScript, 이미지 파일 제공
- `/api/naver-map/config`에서 NAVER Maps 설정 상태 제공
- `/api/naver-map/status`에서 NAVER Maps 설정 상태 제공
- `/api/naver-map/geocode`에서 NAVER Geocoding API 프록시
- `/api/naver-map/reverse-geocode`에서 NAVER Reverse Geocoding API 프록시
- 브라우저에는 NAVER Maps API Key ID만 전달
- NAVER REST API Key는 서버에서만 사용

baseline 분리 서버는 다음 파일로 구성된다.

- `services/web-gateway/gateway.py`: 사용자 PWA 정적 파일 제공, 보안 헤더, `/api` 프록시
- `services/app-api/src/questbook_api/server.py`: 앱 API HTTP 서버
- `services/app-api/src/questbook_api/application/baseline_service.py`: 추천, 퀘스트 수락, 완료 유스케이스
- `services/app-api/src/questbook_api/domain/auth/tokens.py`: stateless access token 발급과 검증
- `services/app-api/src/questbook_api/infrastructure/repository.py`: PostgreSQL 스키마, seed, 트랜잭션
- `services/app-api/src/questbook_api/infrastructure/cache.py`: 유저 단위 30분 Redis 캐시
- `services/app-api/src/questbook_api/integrations/tourapi/client.py`: TourAPI 호출과 fallback
- `infra/nginx/questbook-baseline.conf`: 운영 웹 서버 baseline 설정 예시
- `infra/ncp/baseline-topology.yaml`: NCP VPC/subnet baseline 토폴로지
- `scripts/backup_postgres.py`: 로컬 PostgreSQL baseline 백업 스크립트

## 4. 현재 파일 구조

```text
.
├─ index.html
├─ map.html
├─ quests.html
├─ notes.html
├─ badges.html
├─ 모험가의_수첩_3단_목업.html
├─ server.py
├─ README.md
├─ .env.example
├─ docs/
│  ├─ Design.md
│  ├─ IMPLEMENTATION_STRUCTURE.md
│  ├─ MVP_STATUS.md
│  └─ PROJECT_DESIGN.md
├─ apps/
│  └─ user-web/
│     ├─ public/
│     │  ├─ index.html
│     │  ├─ manifest.webmanifest
│     │  └─ service-worker.js
│     └─ src/
│        ├─ app.js
│        └─ styles.css
├─ services/
│  ├─ web-gateway/
│  │  └─ gateway.py
│  └─ app-api/
│     ├─ pyproject.toml
│     ├─ src/questbook_api/
│     └─ tests/
├─ contracts/
│  └─ openapi/baseline-api.yaml
├─ database/
│  ├─ migrations/001_baseline_schema.sql
│  └─ seeds/baseline_reference_data.md
├─ scripts/
│  ├─ backup_postgres.py
│  ├─ check_local_data_services.py
│  └─ run_baseline.py
├─ tests/
│  └─ smoke/test_baseline_http.py
├─ images/
│  ├─ index1.jpeg
│  ├─ index2.jpeg
│  └─ map.jpeg
└─ assets/
   ├─ css/
   │  ├─ base.css
   │  ├─ components.css
   │  └─ pages.css
   └─ js/
      ├─ main.js
      ├─ map.js
      ├─ mock-data.js
      └─ ui.js
```

## 5. 현재 데이터 상태

기존 루트 정적 MVP 화면 데이터는 `assets/js/mock-data.js`에서 제공한다.

- 목업 사용자: 닉네임, 레벨, XP, 완료 퀘스트 수, 보상 수
- 목업 위치: 대전 중앙로 좌표
- 목업 뱃지: 자연, 과학, 원도심, 지역 상권, 이동형, 야경 기록
- 목업 장소: 한밭수목원, 국립중앙과학관, 은행동 스카이로드, 성심당 본점, 타슈 중앙로 거점, 보문산 전망대
- 목업 퀘스트: 방문형, 이동형, 소비형, 테마형, 활동형
- 목업 수첩 기록: 완료 기록과 추천 대기 기록

baseline 분리 구현은 현재 PostgreSQL에 사용자, 선호도, 레벨, 뱃지, 공용 퀘스트, 사용자별 퀘스트 인스턴스, 완료 기록, 수첩 기록, 꿈돌이 해금 상태를 저장한다. TourAPI 장소 후보는 영구 저장하지 않고, 앱 서버의 Redis 캐시에 유저 단위 30분 TTL로 보관한다.

## 6. 현재 미구현 범위

다음 기능은 baseline 이후 확장 또는 운영 단계로 남아 있다.

- 네이버·구글 OAuth/OIDC 소셜 로그인 실연동
- refresh 토큰 처리와 실제 provider token 보관 정책
- HTTPS 운영 인증서와 HSTS 운영 적용
- 정식 개인정보 처리방침 게시와 동의 철회 UI
- 회원 탈퇴 시 데이터 파기 자동화
- 사진 인증 파일 업로드, EXIF 제거, 영수증 OCR 상호명 대조
- Gemini 기반 퀘스트 문구 다양화
- 지역 상권 리워드 발급
- 파트너 포털과 쿠폰 사용 처리
- NCP VPC, 로드 밸런서, 관리형 PostgreSQL, Redis 실배포
- 외부 API 호출 쿼터 대시보드와 운영 알람
- 운영 모니터링·알람, DB 자동 백업·복구 리허설, CI/CD
- 시스템 생성 공유 카드

## 7. 다음 구현 작업

### 7.1 baseline 운영화

- demo-social 로그인 경계를 네이버·구글 OAuth/OIDC provider로 교체한다.
- refresh 토큰 갱신과 동의 철회 흐름을 추가한다.
- HTTPS 운영 설정과 HSTS를 배포 환경에 적용한다.

### 7.2 TourAPI 운영 안정화

- 실제 TourAPI 키로 호출량과 응답 필드를 검수한다.
- 외부 API 복원력 정책을 운영 지표와 알람으로 확장한다.
- 호출 쿼터와 fallback 전환 상태를 운영 대시보드로 남긴다.

### 7.3 Gemini 연동

- Gemini는 퀘스트 문구 다양화와 추가 후보 생성을 위한 보조 수단으로 사용한다.
- AI 생성 결과를 그대로 노출하지 않고 검증 정책을 통과한 결과만 저장한다.
- Gemini 장애 시 템플릿 기반 퀘스트만 제공하는 fallback을 유지한다.

### 7.4 지역 상권 리워드 연계

- `PartnerStore`, `PartnerAccount`, `RewardOffer`, `UserReward`, `RewardRedemption` 모델을 구현한다.
- 퀘스트 완료, 뱃지 획득, 레벨 상승 조건에 따라 리워드를 발급한다.
- 사용자 앱에서 QR 코드 또는 사용 코드를 표시한다.
- 파트너 포털에서 쿠폰 검증과 사용 처리를 할 수 있게 한다.
- 중복 사용 방지는 PostgreSQL 트랜잭션으로 처리한다.
- 파트너 화면에는 쿠폰 사용에 필요한 최소 정보만 노출한다.

## 8. 검수 기준

- 로컬 실행 명령으로 정적 화면과 지도 페이지가 열린다.
- NAVER Maps API Key가 없을 때 목업 지도 fallback이 동작한다.
- NAVER REST API Key가 브라우저에 노출되지 않는다.
- Docker Compose로 PostgreSQL과 Redis를 기동한 뒤 baseline이 실행된다.
- baseline 실행 명령으로 사용자 PWA와 앱 API가 함께 열린다.
- `/api/health`가 웹 게이트웨이 경유로 정상 응답한다.
- `/api/auth/demo-login`이 만 14세 이상 확인, 개인정보 동의, 위치정보 동의 후 Bearer token을 발급한다.
- `/api/recommendations`는 유저 단위 30분 캐시 상태와 공공누리 출처표시를 반환한다.
- `/api/quests/{instanceId}/complete`는 완료 성공 시 XP, 뱃지, 수첩 기록을 함께 갱신한다.
- 현재 구현 현황은 이 문서에 반영하고, 목표 설계 변경은 `PROJECT_DESIGN.md`에 반영한다.
- 새 기능을 구현할 때는 목업 데이터 의존 범위가 줄어드는지 확인한다.
