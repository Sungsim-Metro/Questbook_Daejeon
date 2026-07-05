# 구현 준비 디렉토리 구조

이 문서는 `docs/PROJECT_DESIGN.md`를 실제 코드로 옮기기 위한 새 구현 구조를 정의한다. 기존 루트의 정적 MVP 파일(`index.html`, `map.html`, `quests.html`, `notes.html`, `badges.html`, `server.py`, `assets/`, `images/`)은 참조용 프로토타입으로 그대로 유지한다.

## 기본 원칙

- 새 구현은 기존 파일을 이동하거나 덮어쓰지 않고 병렬 구조에서 시작한다.
- 사용자 화면, 파트너 화면, 관리자 화면은 `apps/` 아래에서 분리한다.
- 정적 파일 제공과 API 프록시는 `services/web-gateway/`에서 담당한다.
- 추천, 퀘스트, 인증, 뱃지, 수첩, 리워드 도메인은 `services/app-api/`의 Python 앱 서버에서 담당한다.
- 한국관광공사 OpenAPI 원본 응답 전체는 영구 저장하지 않는다.
- OpenAPI 응답은 사용자, 위치 권역, 카테고리 기준의 Redis 30분 임시 캐시에만 둔다.
- 사진 증빙 원본은 PostgreSQL이 아니라 NCP Object Storage 비공개 버킷에 두고 DB에는 객체 키만 남긴다.
- API Key, access token, secret 값은 코드와 저장소에 넣지 않는다.
- 운영 데이터베이스는 PostgreSQL, 서버 캐시는 Redis로 확정한다.
- baseline 스키마는 PostgreSQL 마이그레이션과 앱 API 내장 초기화 SQL이 같은 정의를 사용한다.

## 디렉토리 역할

```text
apps/
  user-web/          사용자 모바일 웹/PWA
  partner-web/       향후 지역 상점 파트너 포털
  admin-web/         향후 운영 관리자 화면

services/
  web-gateway/       정적 파일 제공, HTTPS 보안 헤더, /api 프록시
  app-api/           Python 앱 서버와 비즈니스 로직

contracts/
  openapi/           웹-앱 서버 간 HTTP API 계약
  events/            향후 비동기 이벤트 계약

database/
  migrations/        PostgreSQL 마이그레이션
  seeds/             카테고리, 뱃지, 꿈돌이 같은 기준 데이터

infra/
  local/             로컬 개발 실행 구성
  ncp/               NCP VPC, subnet, 서버, DB 배포 구성
  nginx/             웹 게이트웨이 또는 프록시 설정

tests/
  smoke/             실행 가능 여부와 헬스체크
  integration/       API, PostgreSQL, Redis, 외부 API 대역 테스트
  e2e/               사용자 흐름 검증

scripts/             개발, 검수, 배포 보조 스크립트
```

## 앱 서버 내부 경계

`services/app-api/src/questbook_api/`는 설계서의 모델과 API 흐름을 아래 경계로 나눈다.

| 디렉토리 | 책임 |
| --- | --- |
| `api/` | HTTP 라우트, 요청/응답 스키마, 인증된 사용자 컨텍스트 |
| `application/` | 추천, 퀘스트 생성, 퀘스트 완료 같은 유스케이스 오케스트레이션 |
| `domain/auth/` | 소셜 로그인 계정, JWT 세션, 요청 인가 규칙 |
| `domain/users/` | `User`, `Preference`, `LevelProgress` |
| `domain/places/` | `TourPlaceCache`, 위치 권역, TourAPI 최소 필드 |
| `domain/quests/` | `ReusableQuest`, `UserQuestInstance`, `QuestCompletion`, 퀘스트 템플릿 |
| `domain/rewards/` | `BadgeDefinition`, `UserBadge`, `RewardOffer`, `UserReward`, `RewardRedemption` |
| `domain/notes/` | `AdventureNote`, 공유 카드 참조 |
| `domain/partners/` | `PartnerStore`, `PartnerAccount` |
| `domain/ggumdori/` | `GgumdoriVariant`, `UserGgumdori`, `GgumdoriSelection` |
| `integrations/` | 한국관광공사 OpenAPI, NAVER Maps REST API, Gemini API, OAuth 제공자, Object Storage |
| `infrastructure/` | PostgreSQL, 마이그레이션 연결, Redis, 파일 저장소, 트랜잭션 |
| `observability/` | 로그, 헬스체크, 지표, 외부 API 실패 진단 |

## 구현 순서

1. `services/app-api`에 헬스체크와 설정 로딩을 먼저 추가한다.
2. `contracts/openapi`에 추천, 퀘스트 생성, 퀘스트 완료 API 계약을 정의한다.
3. 한국관광공사 OpenAPI 클라이언트와 Redis 30분 유저 단위 임시 캐시를 구현한다.
4. `ReusableQuest`와 `UserQuestInstance`를 분리해 목업 퀘스트를 실제 추천 후보로 교체할 준비를 한다.
5. `apps/user-web`에 현재 루트 정적 MVP를 옮겨 심을 때는 한 번에 이동하지 않고 화면 단위로 복제 후 검증한다.
6. `database/migrations`에 사용자, 선호도, 퀘스트, 뱃지, 수첩 기준 PostgreSQL 스키마를 추가한다.
7. PostgreSQL repository와 Redis 캐시를 기준으로 추천, 완료, 기록 흐름을 검증한다.
8. 파트너와 리워드 기능은 MVP 이후 확장 단계로 남기되, 디렉토리와 모델 경계는 유지한다.

## 검수 기준

- 기존 루트 프로토타입 파일이 이동되거나 삭제되지 않아야 한다.
- 새 구현은 브라우저에서 secret 값을 직접 사용하지 않아야 한다.
- OpenAPI 원본 응답 전체를 PostgreSQL 마이그레이션 또는 seed 데이터에 넣지 않아야 한다.
- `services/app-api`의 테스트는 `uv` 기반 Python 3.11 환경에서 실행할 수 있어야 한다.
- 화면에 OpenAPI 데이터가 표시되는 단계부터 공공누리 출처표시를 포함해야 한다.
